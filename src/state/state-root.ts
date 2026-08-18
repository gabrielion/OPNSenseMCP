// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  type Stats
} from 'node:fs';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { targetDirectoryPath } from './target-identity.js';

export interface StateRootEnvironment {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDir: string;
}

const UNSUPPORTED = 'Durable state is not supported on this platform';
const BAD_OVERRIDE = 'OPNSENSE_MCP_STATE_DIR must be a normalized absolute path';

export function resolveStateRootPath(
  override: string | undefined,
  environment: StateRootEnvironment
): string {
  // The platform gate comes first so Windows fails closed even with a configured override.
  if (environment.platform !== 'darwin' && environment.platform !== 'linux') {
    throw new Error(UNSUPPORTED);
  }
  if (override !== undefined) {
    // resolve() rather than normalize(): normalize() keeps a trailing separator, so it would
    // accept '/tmp/state/' as its own normal form. resolve() collapses every non-canonical
    // spelling ('..', doubled separators, trailing separator) that would later make the
    // resolved path differ from the path the integrity checks are asked about. It is only
    // reached for absolute overrides, so process.cwd() never participates.
    if (!isAbsolute(override) || resolve(override) !== override) {
      throw new Error(BAD_OVERRIDE);
    }
    return override;
  }
  if (environment.platform === 'darwin') {
    return join(environment.homeDir, 'Library', 'Application Support', 'opnsense-mcp', 'state');
  }
  const xdgStateHome = environment.env.XDG_STATE_HOME;
  if (xdgStateHome !== undefined && isAbsolute(xdgStateHome)) {
    return join(xdgStateHome, 'opnsense-mcp');
  }
  return join(environment.homeDir, '.local', 'state', 'opnsense-mcp');
}

const NOFOLLOW = (constants.O_NOFOLLOW as number | undefined) ?? 0;
const O_DIRECTORY = (constants.O_DIRECTORY as number | undefined) ?? 0;
const DIRECTORY_INTEGRITY = 'State directory failed its integrity checks';

function createPrivateDirectory(path: string): void {
  try {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  } catch {
    throw new Error(DIRECTORY_INTEGRITY);
  }
}

function canonicalPathOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    throw new Error(DIRECTORY_INTEGRITY);
  }
}

export function ensurePrivateDirectory(path: string): void {
  createPrivateDirectory(path);
  if (canonicalPathOf(path) !== path) throw new Error(DIRECTORY_INTEGRITY);
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | O_DIRECTORY | NOFOLLOW);
  } catch {
    throw new Error(DIRECTORY_INTEGRITY);
  }
  try {
    const stats = fstatSync(fd);
    if (
      !stats.isDirectory() ||
      stats.uid !== process.getuid?.() ||
      (stats.mode & 0o777) !== 0o700
    ) {
      throw new Error(DIRECTORY_INTEGRITY);
    }
  } finally {
    closeSync(fd);
  }
}

function directoryComponents(path: string): readonly string[] {
  const root = parse(path).root;
  const suffix = relative(root, path);
  if (suffix === '') return [root];
  return [
    root,
    ...suffix.split(sep).map((_part, index, parts) => join(root, ...parts.slice(0, index + 1)))
  ];
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function requireSafeComponent(stats: Stats, userId: number): void {
  if (stats.isSymbolicLink()) {
    // lstat, so this is the link itself and not what it points at. A root-owned one is the
    // platform's own layout — macOS spells tmpdir() and /tmp through /var and /private — and only
    // root could have planted it, which is a privilege that already outranks everything here. Any
    // other owner is a redirect of exactly the kind this walk exists to refuse.
    if (stats.uid !== 0) throw new Error(DIRECTORY_INTEGRITY);
    return;
  }
  if (!stats.isDirectory() || (stats.uid !== 0 && stats.uid !== userId)) {
    throw new Error(DIRECTORY_INTEGRITY);
  }
  // Group- or other-writable means somebody else can plant the next component. The one exception
  // is a root-owned sticky directory — /tmp, /var/tmp, /dev/shm — where the kernel already forbids
  // renaming or removing an entry you do not own, and where anything an outsider could still
  // create is caught by the ownership check every component of this walk carries.
  const writableByOthers = (stats.mode & 0o022) !== 0;
  const stickyPublicDirectory = stats.uid === 0 && (stats.mode & 0o1000) !== 0;
  if (writableByOthers && !stickyPublicDirectory) throw new Error(DIRECTORY_INTEGRITY);
}

/**
 * Refuses a state root whose path runs through a directory this account does not control. Walks
 * from the filesystem root down and stops at the first component that does not exist yet: a path
 * cannot have an existing child under a missing parent, and `createPrivateDirectory` is about to
 * create the rest 0700 under a parent this walk has already accepted.
 */
function requireSafeAncestry(path: string): void {
  const userId = process.getuid?.();
  if (userId === undefined) throw new Error(DIRECTORY_INTEGRITY);
  for (const component of directoryComponents(path)) {
    let stats: Stats;
    try {
      stats = lstatSync(component);
    } catch (error) {
      if (isMissing(error)) return;
      throw new Error(DIRECTORY_INTEGRITY);
    }
    requireSafeComponent(stats, userId);
  }
}

export interface StateRoot {
  readonly path: string;
  readonly targetsPath: string;
}

export function openStateRoot(path: string): StateRoot {
  ensurePrivateDirectory(path);
  const targetsPath = join(path, 'targets');
  ensurePrivateDirectory(targetsPath);
  return Object.freeze({ path, targetsPath });
}

export function openResolvedStateRoot(
  override: string | undefined,
  environment: StateRootEnvironment
): StateRoot {
  const resolved = resolveStateRootPath(override, environment);
  // A configured or defaulted root may be spelled through a symlinked ancestor that the operator
  // cannot control (macOS resolves tmpdir() and /var through /private), and realpathSync needs the
  // directory to exist, so create first with the same 0700 discipline, then canonicalize. The
  // checks in `ensurePrivateDirectory` are checks of the leaf — the resolved directory's own type,
  // owner and mode — so canonicalizing moved the accepted directory in one direction: a symlinked
  // ancestor used to fail closed on `canonicalPathOf(path) !== path`, then resolved instead, which
  // put durable state wherever a same-uid ancestor redirect pointed. Slice 2b decided that delta
  // rather than accepting it: the walk below refuses it (docs/project-status.md, "Unsafe-ancestor
  // validation"). It runs twice because the two runs answer different questions. Over the SPELLED
  // path a symlink is still visible, and a same-uid one — the redirect — is refused there and
  // nowhere else. Over the CANONICAL path the components are the ones the writes actually land in,
  // which is the only place the far side of a tolerated root-owned symlink gets checked. That
  // second run has no test of its own and cannot get one: the two paths differ only when a
  // tolerated symlink sits between them, and planting a root-owned symlink needs root. Neither run
  // makes this atomic either — a redirect planted between a check and the use that follows it is
  // out of reach from here, and the leaf's own `O_NOFOLLOW` open is what answers for that.
  requireSafeAncestry(resolved);
  createPrivateDirectory(resolved);
  const canonical = canonicalPathOf(resolved);
  requireSafeAncestry(canonical);
  return openStateRoot(canonical);
}

export function ensureTargetDirectory(root: StateRoot, targetId: string): string {
  const path = targetDirectoryPath(root.path, targetId);
  ensurePrivateDirectory(path);
  return path;
}

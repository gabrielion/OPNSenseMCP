// SPDX-License-Identifier: AGPL-3.0-or-later
import { closeSync, constants, fstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
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
  // directory to exist, so create first with the same 0700 discipline, then canonicalize. Every
  // integrity check still runs, unchanged, against the canonical path: this widens the accepted
  // spelling, not the accepted directory.
  createPrivateDirectory(resolved);
  return openStateRoot(canonicalPathOf(resolved));
}

export function ensureTargetDirectory(root: StateRoot, targetId: string): string {
  const path = targetDirectoryPath(root.path, targetId);
  ensurePrivateDirectory(path);
  return path;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import { lstatSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, parse, relative, sep } from 'node:path';

export const PRIVATE_FIXTURE_BASE_NAME = '.opnsense-mcp-fixtures';

function directoryComponents(path) {
  const root = parse(path).root;
  const suffix = relative(root, path);
  if (suffix === '') return [root];
  return [
    root,
    ...suffix.split(sep).map((_part, index, parts) => join(root, ...parts.slice(0, index + 1)))
  ];
}

/**
 * Fails closed when any ancestor is group/other-writable or foreign-owned. Fixtures must never
 * depend on the global sticky temporary directory, which the production secure writer correctly
 * refuses.
 */
export function assertPrivateAncestors(path) {
  if (typeof process.getuid !== 'function') {
    throw new Error('Private fixture roots require a POSIX host');
  }
  const userId = process.getuid();
  for (const component of directoryComponents(path)) {
    const stats = lstatSync(component);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      (stats.uid !== 0 && stats.uid !== userId) ||
      (stats.mode & 0o022) !== 0
    ) {
      throw new Error(`Unsafe fixture ancestor: ${component}`);
    }
  }
}

const outstandingRoots = new Set();

export async function createPrivateFixtureRoot(prefix) {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(prefix)) throw new Error('Invalid fixture prefix');
  const base = join(homedir(), PRIVATE_FIXTURE_BASE_NAME);
  await mkdir(base, { mode: 0o700, recursive: true });
  const root = await realpath(await mkdtemp(join(base, `${prefix}-`)));
  assertPrivateAncestors(root);
  outstandingRoots.add(root);
  return root;
}

export async function removePrivateFixtureRoot(root) {
  const base = join(homedir(), PRIVATE_FIXTURE_BASE_NAME);
  if (!root.startsWith(`${base}${sep}`)) throw new Error('Refusing to remove a foreign path');
  await rm(root, { force: true, recursive: true });
  outstandingRoots.delete(root);
}

/**
 * A hard test timeout skips the `finally` that would normally remove a fixture root, so a suite
 * teardown hook removes whatever is still outstanding. Returns the roots it had to reclaim.
 */
export async function removeOutstandingPrivateFixtureRoots() {
  const reclaimed = [...outstandingRoots];
  for (const root of reclaimed) await removePrivateFixtureRoot(root);
  return reclaimed;
}

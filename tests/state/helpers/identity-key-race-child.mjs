// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs one ensureIdentityKey attempt against the state root given in argv[2], after waiting for
// the wall-clock barrier in argv[3] so all children start together. Prints exactly one line:
// "ok <hex-key>" or "fail <message>" — and every message ensureIdentityKey produces is the same
// static sentence, so a failing line never carries a path or an errno. The compiled state module
// is imported from argv[4]: Node type-stripping cannot resolve the source tree's internal `.js`
// specifiers, so the race test compiles src into a private scratch directory and passes its path.
import { pathToFileURL } from 'node:url';

async function main() {
  const rootPath = process.argv[2];
  const barrierMs = Number(process.argv[3]);
  const modulePath = process.argv[4];
  if (rootPath === undefined || modulePath === undefined || !Number.isFinite(barrierMs)) {
    process.stdout.write('fail bad-arguments\n');
    process.exitCode = 1;
    return;
  }
  // Import before the barrier so module loading never eats a child's share of the start window.
  const { ensureIdentityKey, openStateRoot } = await import(pathToFileURL(modulePath).href);
  while (Date.now() < barrierMs) {
    // busy-wait a few ms so all children cross the barrier as close together as possible
  }
  try {
    const key = ensureIdentityKey(openStateRoot(rootPath));
    process.stdout.write(`ok ${Buffer.from(key).toString('hex')}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    process.stdout.write(`fail ${message}\n`);
    // Not process.exit(1): stdout to a pipe is asynchronous on darwin and the line would be lost.
    process.exitCode = 1;
  }
}

await main();

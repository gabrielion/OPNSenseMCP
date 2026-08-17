// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs one ensureIdentityKey attempt against the state root given in argv[2], after waiting for
// the wall-clock barrier in argv[3] so all children start together. Prints exactly one line:
// "ok <hex-key>" or "fail <static-message-only>". Imports dist/ because Node type-stripping
// cannot resolve the source tree's internal .js specifiers; the race test rebuilds dist first.
import { ensureIdentityKey, openStateRoot } from '../../../dist/state/index.js';

const rootPath = process.argv[2];
const barrierMs = Number(process.argv[3]);
if (rootPath === undefined || !Number.isFinite(barrierMs)) {
  process.stdout.write('fail bad-arguments\n');
  process.exit(1);
}
while (Date.now() < barrierMs) {
  // busy-wait a few ms so all children cross the barrier as close together as possible
}
try {
  const key = ensureIdentityKey(openStateRoot(rootPath));
  process.stdout.write(`ok ${Buffer.from(key).toString('hex')}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown';
  process.stdout.write(`fail ${message}\n`);
  process.exit(1);
}

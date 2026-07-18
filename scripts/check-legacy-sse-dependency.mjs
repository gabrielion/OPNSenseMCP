// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';

const PACKAGE_NAME = '@modelcontextprotocol/sdk';
const APPROVED_VERSION = '1.29.0';
const APPROVED_INTEGRITY =
  'sha512-zo37mZA9hJWpULgkRpowewez1y6ML5GsXJPY8FI0tBBCd77HEvza4jDqRKOXgHNn867PVGCyTdzqpz0izu5ZjQ==';
const LOCK_PATH = 'node_modules/@modelcontextprotocol/sdk';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const packageDocument = JSON.parse(await readFile('package.json', 'utf8'));
const lockDocument = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert(
  packageDocument.dependencies?.[PACKAGE_NAME] === APPROVED_VERSION,
  'Legacy SSE dependency must be an exact production pin'
);
assert(
  lockDocument.packages?.['']?.dependencies?.[PACKAGE_NAME] === APPROVED_VERSION,
  'Legacy SSE root lock pin must be exact'
);
const sdkNodes = Object.entries(lockDocument.packages).filter(([path]) =>
  /(?:^|\/)node_modules\/@modelcontextprotocol\/sdk$/u.test(path)
);
assert(
  sdkNodes.length === 1 && sdkNodes[0]?.[0] === LOCK_PATH,
  'Legacy SSE lock must contain one root SDK node'
);
const locked = sdkNodes[0]?.[1];
assert(locked?.version === APPROVED_VERSION, 'Legacy SSE lock version drifted');
assert(locked?.integrity === APPROVED_INTEGRITY, 'Legacy SSE lock integrity drifted');
assert(locked?.dev === undefined, 'Legacy SSE SDK must be production-reachable');

const response = await fetch('https://registry.npmjs.org/@modelcontextprotocol%2Fsdk');
assert(response.ok, `Registry request failed with HTTP ${String(response.status)}`);
const metadata = await response.json();
assert(
  JSON.stringify(metadata['dist-tags']) === JSON.stringify({ latest: APPROVED_VERSION }),
  'Legacy SSE registry dist-tags drifted'
);
const approved = metadata.versions?.[APPROVED_VERSION];
assert(approved?.version === APPROVED_VERSION, 'Approved registry version is missing');
assert(approved?.dist?.integrity === APPROVED_INTEGRITY, 'Approved registry integrity drifted');
assert(approved?.engines?.node === '>=18', 'Approved registry Node engine drifted');
assert(
  !Object.hasOwn(metadata, 'deprecated') && !Object.hasOwn(approved, 'deprecated'),
  'Approved registry package is deprecated'
);
process.stdout.write('Legacy SSE dependency contract is current\n');

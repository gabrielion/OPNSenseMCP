// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

// The product version is hand-synced across every surface that states it: the CLI banner, the two
// `server_status` literals, both transport handshakes, and the two scripts that assert it back off
// a running server. The 0.1.1 bump proved the drift class is real — a task brief listed eight
// sites and grep plus control experiments found five more — and a site that keeps the old version
// does not fail anything by itself, it just tells an operator the wrong thing. So the release
// version is derived from package.json here and every site is required to carry it.
//
// Sealed evidence and the client-identity pins are deliberately excluded. Those record what some
// past run actually observed, or what a third-party client actually sends; re-pinning them to the
// current version would erase exactly the difference they exist to expose.
const PRODUCT_VERSION_SITES = [
  'src/main.ts',
  'src/capabilities/foundation/server-status.ts',
  'src/server/build-server.ts',
  'src/http/legacy-sse.ts',
  'scripts/run-conformance.mjs',
  'scripts/vm/product1b-live.mjs'
] as const;

const SERVER_STATUS = 'src/capabilities/foundation/server-status.ts';

async function releaseVersion(): Promise<string> {
  const document = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
  // An empty or absent version would make every containment assertion below trivially true, so
  // the derived value is checked before anything is derived from it.
  expect(document.version).toMatch(/^\d+\.\d+\.\d+/u);
  return document.version;
}

describe('product version drift', () => {
  it('carries the package version into every hand-synced product site', async () => {
    const version = await releaseVersion();

    for (const file of PRODUCT_VERSION_SITES) {
      expect(await readFile(file, 'utf8'), file).toContain(version);
    }
  });

  // `server_status` states the version twice: once as the `z.literal` in the response schema and
  // once as the value the handler returns against it. A containment check cannot see one of the
  // two drift — the other still satisfies it — so this file is counted rather than searched.
  it('keeps both server_status version literals in step', async () => {
    const version = await releaseVersion();
    const content = await readFile(SERVER_STATUS, 'utf8');

    expect(content.split(version).length - 1, SERVER_STATUS).toBeGreaterThanOrEqual(2);
  });
});

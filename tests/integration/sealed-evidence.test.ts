// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runBoundedCommand, type CommandResult } from '../support/installed-package-harness.js';
import {
  createPrivateFixtureRoot,
  removeOutstandingPrivateFixtureRoots,
  removePrivateFixtureRoot
} from '../support/private-fixture-root.js';
import { prepareInstalledPackage } from '../../scripts/testing/prepare-installed-package.mjs';
import { PACKAGE_TEST_TIMEOUT_MS } from './installed-package-budget.js';

const COMMAND_CLEANUP_TIMEOUT_MS = 2_000;

const preparationRunner = (
  command: string,
  argumentsList: readonly string[],
  options: {
    readonly cwd: string;
    readonly environment: Readonly<Record<string, string>>;
    readonly timeoutMs: number;
  }
): Promise<CommandResult> =>
  runBoundedCommand(
    { command, arguments: [...argumentsList] },
    {
      cwd: options.cwd,
      environment: { ...options.environment },
      input: '',
      timeoutMs: options.timeoutMs,
      cleanupTimeoutMs: COMMAND_CLEANUP_TIMEOUT_MS
    }
  );

afterAll(async () => {
  expect(await removeOutstandingPrivateFixtureRoots()).toEqual([]);
});

describe('sealed OpenCode evidence', () => {
  it(
    'still describes the package this tree builds',
    async () => {
      const evidence = JSON.parse(
        await readFile('tests/fixtures/opencode.product1a.json', 'utf8')
      ) as { readonly package?: { readonly tarSha256?: unknown } };
      const workRoot = await createPrivateFixtureRoot('sealed-evidence');
      try {
        const prepared = await prepareInstalledPackage({
          repositoryRoot: resolve('.'),
          workRoot,
          run: preparationRunner
        });
        try {
          // A mismatch means the packaged content changed since the evidence was sealed. The only
          // legitimate remedy is to re-run the real producer, `npm run smoke:opencode`, which needs
          // the OpenCode client and a model. Never hand-edit the evidence file.
          expect(evidence.package?.tarSha256).toBe(prepared.archiveTarSha256);
        } finally {
          await prepared.cleanup();
        }
      } finally {
        await removePrivateFixtureRoot(workRoot);
      }
    },
    PACKAGE_TEST_TIMEOUT_MS
  );
});

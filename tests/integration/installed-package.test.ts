// SPDX-License-Identifier: AGPL-3.0-or-later
import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  runBoundedCommand,
  type CommandInvocation,
  type CommandResult
} from '../support/installed-package-harness.js';
import { startSyntheticOPNsenseTarget } from '../support/https-opnsense-mock.js';
import {
  createPrivateFixtureRoot,
  removeOutstandingPrivateFixtureRoots,
  removePrivateFixtureRoot
} from '../support/private-fixture-root.js';
import {
  prepareInstalledPackage,
  type PreparedInstalledPackage
} from '../../scripts/testing/prepare-installed-package.mjs';
import { PACKAGE_TEST_TIMEOUT_MS } from './installed-package-budget.js';

const MCP_COMMAND_TIMEOUT_MS = 3_000;
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
  // A leaked root means some path (including a hard test timeout) skipped its own cleanup.
  expect(await removeOutstandingPrivateFixtureRoots()).toEqual([]);
});

async function withInstalledPackage(
  assertion: (installed: PreparedInstalledPackage, workRoot: string) => Promise<void>
): Promise<void> {
  const workRoot = await createPrivateFixtureRoot('mcp-package-installation');
  let prepared: PreparedInstalledPackage | undefined;
  try {
    prepared = await prepareInstalledPackage({
      repositoryRoot: resolve('.'),
      workRoot,
      run: preparationRunner
    });
    await assertion(prepared, workRoot);
  } finally {
    if (prepared !== undefined) await prepared.cleanup();
    await removePrivateFixtureRoot(workRoot);
  }
}

function runInstalledCommand(
  installedCommand: CommandInvocation,
  readOnly: string,
  input: string,
  opnsenseConfigFile?: string
): Promise<CommandResult> {
  return runBoundedCommand(installedCommand, {
    cwd: resolve('.'),
    environment: {
      PATH: process.env.PATH ?? '',
      READ_ONLY: readOnly,
      MCP_REQUEST_STATE_SECRET: 'INSTALLED_PACKAGE_SENTINEL_0123456789',
      ...(opnsenseConfigFile === undefined ? {} : { OPNSENSE_CONFIG_FILE: opnsenseConfigFile })
    },
    input,
    timeoutMs: MCP_COMMAND_TIMEOUT_MS,
    cleanupTimeoutMs: COMMAND_CLEANUP_TIMEOUT_MS
  });
}

function protocolLines(stdout: string): Record<string, unknown>[] {
  return stdout
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('installed npm executable', () => {
  it(
    'builds a clean package copy before packing and installs a shebang-bearing bin target',
    () =>
      withInstalledPackage(async ({ installedTarget }) => {
        const emitted = await readFile(installedTarget);
        const prefix = Buffer.from(
          '#!/usr/bin/env node\n// SPDX-License-Identifier: AGPL-3.0-or-later\n',
          'utf8'
        );
        expect(emitted.subarray(0, prefix.length)).toEqual(prefix);
      }),
    PACKAGE_TEST_TIMEOUT_MS
  );

  it(
    'executes the closed Product 1A read surface from an installed tarball and cleans every fixture',
    async () => {
      const apiKey = 'product1a-package-key';
      const apiSecret = 'PRODUCT_1A_PACKAGE_SECRET_SENTINEL';
      const target = await startSyntheticOPNsenseTarget((request) => {
        if (request.path === '/api/core/system/status') {
          return {
            body: JSON.stringify({
              metadata: { system: { status: 'ok' } },
              subsystems: {},
              ignored: 'not-public'
            })
          };
        }
        return {
          body: JSON.stringify({
            total: 1,
            rowCount: 10,
            current: 1,
            rows: [
              {
                id: 'svc-1',
                name: 'dnsmasq',
                description: 'DNS forwarder',
                running: 1,
                locked: 0,
                ignored: 'not-public'
              }
            ]
          })
        };
      });
      const fixtureRoot = await createPrivateFixtureRoot('mcp-product1a-fixture');
      const caFile = join(fixtureRoot, 'ca.pem');
      const configFile = join(fixtureRoot, 'opnsense.json');
      const evidence = JSON.parse(
        await readFile('tests/fixtures/opencode.product1a.json', 'utf8')
      ) as {
        readonly package?: {
          readonly name?: unknown;
          readonly version?: unknown;
          readonly tarSha256?: unknown;
        };
      };
      let consumerPath: string | undefined;
      let packageWorkRoot: string | undefined;
      await writeFile(caFile, target.ca, { mode: 0o600 });
      await writeFile(
        configFile,
        `${JSON.stringify({ url: target.url, apiKey, apiSecret, caFile })}\n`,
        { mode: 0o600 }
      );
      try {
        await withInstalledPackage(
          async (
            { archiveTarSha256, installedCommand, consumerRoot, packageName, packageVersion },
            workRoot
          ) => {
            consumerPath = consumerRoot;
            packageWorkRoot = workRoot;
            // Every commit must keep the sealed evidence STRUCTURALLY bound to this package: same
            // name, same version, a well-formed portable digest. Whether that digest still equals
            // the current build is a RELEASE question, not a per-commit one — re-sealing requires
            // the real OpenCode producer and an external model, so `npm run evidence:check` owns
            // the equality (see tests/integration/sealed-evidence.test.ts).
            expect(evidence.package?.name).toBe(packageName);
            expect(evidence.package?.version).toBe(packageVersion);
            expect(evidence.package?.tarSha256).toMatch(/^[a-f0-9]{64}$/u);
            expect(archiveTarSha256).toMatch(/^[a-f0-9]{64}$/u);
            const negative = await runInstalledCommand(installedCommand, 'invalid', '');
            const requests = [
              {
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                  protocolVersion: '2025-11-25',
                  capabilities: {},
                  clientInfo: { name: 'installed-package-test', version: '0.1.0' }
                }
              },
              { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
              { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
              {
                jsonrpc: '2.0',
                id: 3,
                method: 'tools/call',
                params: {
                  name: 'opn_describe',
                  arguments: { resource: 'system.status' }
                }
              },
              {
                jsonrpc: '2.0',
                id: 4,
                method: 'tools/call',
                params: { name: 'opn_get', arguments: { resource: 'system.status' } }
              },
              {
                jsonrpc: '2.0',
                id: 5,
                method: 'tools/call',
                params: {
                  name: 'opn_list',
                  arguments: {
                    resource: 'core.services',
                    page: 1,
                    pageSize: 10,
                    query: ''
                  }
                }
              }
            ];
            const positive = await runInstalledCommand(
              installedCommand,
              'true',
              `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`,
              configFile
            );
            const responses = protocolLines(positive.stdout);

            expect(negative.code).not.toBe(0);
            expect(negative.signal).toBeNull();
            expect(negative.stdout).toBe('');
            expect(negative.stderr).toBe('Error\n');
            expect(positive).toMatchObject({ code: 0, signal: null, stderr: '' });
            expect(responses.every((response) => response.jsonrpc === '2.0')).toBe(true);
            expect(
              responses
                .map(({ id }) => id)
                .filter((id): id is number => typeof id === 'number')
                .sort((left, right) => left - right)
            ).toEqual([1, 2, 3, 4, 5]);
            expect(responses.find((response) => response.id === 1)).toMatchObject({
              result: { protocolVersion: '2025-11-25' }
            });
            expect(responses.find((response) => response.id === 2)).toMatchObject({
              result: {
                tools: [
                  { name: 'server_status', annotations: { readOnlyHint: true } },
                  { name: 'opn_describe', annotations: { readOnlyHint: true } },
                  { name: 'opn_get', annotations: { readOnlyHint: true } },
                  { name: 'opn_list', annotations: { readOnlyHint: true } }
                ]
              }
            });
            expect(responses.find((response) => response.id === 3)).toMatchObject({
              result: {
                structuredContent: {
                  mode: 'resource',
                  resource: { key: 'system.status', operations: [{ name: 'get', effect: 'read' }] }
                }
              }
            });
            expect(responses.find((response) => response.id === 4)).toMatchObject({
              result: { structuredContent: { item: { status: 'ok' } } }
            });
            expect(responses.find((response) => response.id === 5)).toMatchObject({
              result: {
                structuredContent: {
                  page: 1,
                  pageSize: 10,
                  total: 1,
                  items: [
                    {
                      id: 'svc-1',
                      name: 'dnsmasq',
                      description: 'DNS forwarder',
                      status: 'running'
                    }
                  ]
                }
              }
            });
            expect(target.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
              'GET /api/core/system/status',
              'POST /api/core/service/search'
            ]);
            expect(target.requests[1]?.body).toBe(
              JSON.stringify({ current: 1, rowCount: 10, sort: {}, searchPhrase: '' })
            );
            expect(positive.stdout).not.toContain('INSTALLED_PACKAGE_SENTINEL_0123456789');
            expect(positive.stdout).not.toContain(apiKey);
            expect(positive.stdout).not.toContain(apiSecret);
            expect(positive.stderr).not.toContain(apiKey);
            expect(positive.stderr).not.toContain(apiSecret);
          }
        );
      } finally {
        await target.close();
        await removePrivateFixtureRoot(fixtureRoot);
      }
      if (consumerPath === undefined || packageWorkRoot === undefined) {
        throw new Error('Package fixture was not created');
      }
      // The whole preparation root must be gone, not just the consumer subtree: the packed
      // archive, the registry tarballs and its staging directory all live beside it.
      await expect(access(consumerPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(packageWorkRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(fixtureRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    },
    PACKAGE_TEST_TIMEOUT_MS
  );
});

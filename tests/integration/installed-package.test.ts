// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMMAND_SUPERVISOR_STARTUP_TIMEOUT_MS,
  localArchiveInstallArguments,
  packageHarnessPlatform,
  runBoundedCommand,
  type CommandInvocation,
  type CommandResult
} from '../support/installed-package-harness.js';
import { startSyntheticOPNsenseTarget } from '../support/https-opnsense-mock.js';

const PACKAGE_INPUTS = [
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE',
  'src',
  'scripts',
  'tsconfig.json',
  'tsconfig.build.json'
] as const;
const PACK_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 30_000;
const MCP_COMMAND_TIMEOUT_MS = 3_000;
const COMMAND_CLEANUP_TIMEOUT_MS = 2_000;
const PACKAGE_TEST_TIMEOUT_MS = 90_000;
// Four 2s supervisor startups + pack/install cleanup + two MCP cleanup budgets = 82s < 90s.
const WORST_CASE_PACKAGE_TEST_MS =
  4 * COMMAND_SUPERVISOR_STARTUP_TIMEOUT_MS +
  PACK_TIMEOUT_MS +
  COMMAND_CLEANUP_TIMEOUT_MS +
  INSTALL_TIMEOUT_MS +
  COMMAND_CLEANUP_TIMEOUT_MS +
  2 * (MCP_COMMAND_TIMEOUT_MS + COMMAND_CLEANUP_TIMEOUT_MS);
if (WORST_CASE_PACKAGE_TEST_MS >= PACKAGE_TEST_TIMEOUT_MS) {
  throw new Error('Installed-package outer timeout does not own every child budget');
}

interface InstalledPackage {
  readonly archiveSha256: string;
  readonly command: CommandInvocation;
  readonly target: string;
}

function requireSuccessfulCommand(result: CommandResult, label: string): void {
  if (result.code !== 0 || result.signal !== null) throw new Error(`${label} failed`);
}

async function withInstalledPackage(
  assertion: (installed: InstalledPackage, packageCopy: string) => Promise<void>
): Promise<void> {
  const repository = resolve('.');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'mcp-package-installation-'));
  try {
    const packageCopy = join(temporaryRoot, 'package');
    const consumer = join(temporaryRoot, 'consumer');
    await Promise.all([mkdir(packageCopy), mkdir(consumer)]);
    await Promise.all(
      PACKAGE_INPUTS.map((input) =>
        cp(join(repository, input), join(packageCopy, input), { recursive: true })
      )
    );
    const manifest = JSON.parse(await readFile(join(packageCopy, 'package.json'), 'utf8')) as {
      readonly name?: unknown;
    };
    if (typeof manifest.name !== 'string') throw new Error('Package name is unavailable');
    const npmCli = process.env.npm_execpath;
    if (npmCli === undefined) throw new Error('npm CLI path is unavailable');
    const harness = packageHarnessPlatform({
      platform: process.platform,
      consumer,
      packageName: manifest.name,
      nodeExecutable: process.execPath,
      npmCli,
      windowsSystemRoot: process.env.SystemRoot
    });
    await symlink(
      join(repository, 'node_modules'),
      join(packageCopy, 'node_modules'),
      harness.dependencyLinkType
    );
    await expect(readFile(join(packageCopy, 'dist/main.js'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    });

    const packed = await runBoundedCommand(
      {
        command: harness.npm.command,
        arguments: [...harness.npm.arguments, 'pack', '--json']
      },
      {
        cwd: packageCopy,
        environment: process.env,
        input: '',
        timeoutMs: PACK_TIMEOUT_MS,
        cleanupTimeoutMs: COMMAND_CLEANUP_TIMEOUT_MS
      }
    );
    requireSuccessfulCommand(packed, 'npm pack');
    const archives = (await readdir(packageCopy)).filter((entry) => entry.endsWith('.tgz'));
    expect(archives).toHaveLength(1);
    const archiveName = archives[0];
    if (archiveName === undefined) throw new Error('npm pack did not produce an archive');
    const archive = join(packageCopy, archiveName);
    const archiveSha256 = createHash('sha256')
      .update(await readFile(archive))
      .digest('hex');

    await writeFile(
      join(consumer, 'package.json'),
      `${JSON.stringify({ private: true }, null, 2)}\n`,
      'utf8'
    );
    const installed = await runBoundedCommand(
      {
        command: harness.npm.command,
        arguments: [...harness.npm.arguments, ...localArchiveInstallArguments(archive)]
      },
      {
        cwd: consumer,
        environment: process.env,
        input: '',
        timeoutMs: INSTALL_TIMEOUT_MS,
        cleanupTimeoutMs: COMMAND_CLEANUP_TIMEOUT_MS
      }
    );
    requireSuccessfulCommand(installed, 'npm install');

    await assertion(
      { archiveSha256, command: harness.installedCommand, target: harness.installedTarget },
      packageCopy
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
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
      withInstalledPackage(async ({ target }) => {
        const emitted = await readFile(target);
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
          return { body: JSON.stringify({ status: 'ok', ignored: 'not-public' }) };
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
                status: 'running',
                ignored: 'not-public'
              }
            ]
          })
        };
      });
      const fixtureRoot = await mkdtemp(join(tmpdir(), 'mcp-product1a-fixture-'));
      const caFile = join(fixtureRoot, 'ca.pem');
      const configFile = join(fixtureRoot, 'opnsense.json');
      const evidence = JSON.parse(
        await readFile('tests/fixtures/opencode.product1a.json', 'utf8')
      ) as { readonly package?: { readonly sha256?: unknown } };
      let packageRoot: string | undefined;
      await writeFile(caFile, target.ca, { mode: 0o600 });
      await writeFile(
        configFile,
        `${JSON.stringify({ url: target.url, apiKey, apiSecret, caFile })}\n`,
        { mode: 0o600 }
      );
      try {
        await withInstalledPackage(async ({ archiveSha256, command }, packageCopy) => {
          packageRoot = dirname(packageCopy);
          expect(evidence.package?.sha256).toBe(archiveSha256);
          const negative = await runInstalledCommand(command, 'invalid', '');
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
            command,
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
        });
      } finally {
        await target.close();
        await rm(fixtureRoot, { recursive: true, force: true });
      }
      if (packageRoot === undefined) throw new Error('Package fixture was not created');
      await expect(access(packageRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(fixtureRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    },
    PACKAGE_TEST_TIMEOUT_MS
  );
});

// SPDX-License-Identifier: AGPL-3.0-or-later
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  localArchiveInstallArguments,
  packageHarnessPlatform,
  runBoundedCommand,
  type CommandInvocation,
  type CommandResult
} from '../support/installed-package-harness.js';

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

interface InstalledPackage {
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
      commandShell: process.env.ComSpec
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
        timeoutMs: 60_000,
        timeoutLabel: 'npm pack'
      }
    );
    requireSuccessfulCommand(packed, 'npm pack');
    const archives = (await readdir(packageCopy)).filter((entry) => entry.endsWith('.tgz'));
    expect(archives).toHaveLength(1);
    const archiveName = archives[0];
    if (archiveName === undefined) throw new Error('npm pack did not produce an archive');
    const archive = join(packageCopy, archiveName);

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
        timeoutMs: 60_000,
        timeoutLabel: 'npm install'
      }
    );
    requireSuccessfulCommand(installed, 'npm install');

    await assertion(
      { command: harness.installedCommand, target: harness.installedTarget },
      packageCopy
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

function runInstalledCommand(
  installedCommand: CommandInvocation,
  readOnly: string,
  input: string
): Promise<CommandResult> {
  return runBoundedCommand(installedCommand, {
    cwd: resolve('.'),
    environment: {
      PATH: process.env.PATH ?? '',
      READ_ONLY: readOnly,
      MCP_REQUEST_STATE_SECRET: 'INSTALLED_PACKAGE_SENTINEL_0123456789'
    },
    input,
    timeoutMs: 3_000,
    timeoutLabel: 'installed package command'
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
        expect(await readFile(target, 'utf8')).toMatch(
          /^#!\/usr\/bin\/env node\n\/\/ SPDX-License-Identifier: AGPL-3\.0-or-later\n/u
        );
      }),
    90_000
  );

  it(
    'rejects invalid configuration and completes the 2025 protocol through the installed bin',
    () =>
      withInstalledPackage(async ({ command }) => {
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
            params: { name: 'server_status', arguments: {} }
          }
        ];
        const positive = await runInstalledCommand(
          command,
          'true',
          `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`
        );
        const responses = protocolLines(positive.stdout);

        expect(negative.code).not.toBe(0);
        expect(negative.signal).toBeNull();
        expect(negative.stdout).toBe('');
        expect(negative.stderr).toBe('Error\n');
        expect(positive).toMatchObject({ code: 0, signal: null, stderr: '' });
        expect(responses.every((response) => response.jsonrpc === '2.0')).toBe(true);
        expect(responses.find((response) => response.id === 1)).toMatchObject({
          result: { protocolVersion: '2025-11-25' }
        });
        expect(responses.find((response) => response.id === 2)).toMatchObject({
          result: { tools: [{ name: 'server_status' }] }
        });
        expect(responses.find((response) => response.id === 3)).toHaveProperty('result');
        expect(positive.stdout).not.toContain('INSTALLED_PACKAGE_SENTINEL_0123456789');
      }),
    90_000
  );
});

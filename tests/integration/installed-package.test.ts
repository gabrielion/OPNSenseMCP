// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFile, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
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

interface CommandResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

async function withInstalledPackage(
  assertion: (installedBin: string, packageCopy: string) => Promise<void>
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
    await symlink(join(repository, 'node_modules'), join(packageCopy, 'node_modules'), 'dir');
    await expect(readFile(join(packageCopy, 'dist/main.js'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    });

    await execFileAsync('npm', ['pack', '--json'], {
      cwd: packageCopy,
      env: process.env
    });
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
    await execFileAsync(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--no-package-lock',
        '--no-save',
        archive
      ],
      { cwd: consumer, env: process.env }
    );

    await assertion(join(consumer, 'node_modules/.bin/opnsense-mcp'), packageCopy);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

function runInstalledCommand(
  installedBin: string,
  readOnly: string,
  input: string
): Promise<CommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(installedBin, [], {
      cwd: resolve('.'),
      env: {
        PATH: process.env.PATH ?? '',
        READ_ONLY: readOnly,
        MCP_REQUEST_STATE_SECRET: 'INSTALLED_PACKAGE_SENTINEL_0123456789'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const deadline = setTimeout(() => {
      child.kill('SIGKILL');
      rejectCommand(new Error('Installed package command did not exit promptly'));
    }, 3_000);
    deadline.unref();
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.stdin.on('error', () => undefined);
    child.once('error', (error) => {
      clearTimeout(deadline);
      rejectCommand(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(deadline);
      resolveCommand({ code, signal, stdout, stderr });
    });
    child.stdin.end(input);
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
      withInstalledPackage(async (installedBin) => {
        expect(await readFile(installedBin, 'utf8')).toMatch(/^#!\/usr\/bin\/env node\n/u);
      }),
    60_000
  );

  it(
    'rejects invalid configuration and completes the 2025 protocol through the installed bin',
    () =>
      withInstalledPackage(async (installedBin) => {
        const negative = await runInstalledCommand(installedBin, 'invalid', '');
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
          installedBin,
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
    60_000
  );
});

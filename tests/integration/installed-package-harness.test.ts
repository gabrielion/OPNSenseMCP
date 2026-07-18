// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  localArchiveInstallArguments,
  ownedTreeTerminationPlan,
  packageHarnessPlatform,
  runBoundedCommand,
  terminateOwnedProcessTree
} from '../support/installed-package-harness.js';

function errnoCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function validateFixturePid(value: string | number): number {
  const pid = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) {
    throw new Error('Fixture did not provide a safe owned process identifier');
  }
  return pid;
}

async function waitForFixturePid(path: string, signal: AbortSignal): Promise<number> {
  while (!signal.aborted) {
    try {
      return validateFixturePid(await readFile(path, 'utf8'));
    } catch (error) {
      const code = errnoCode(error);
      if (code !== undefined && code !== 'ENOENT') throw error;
    }
    await new Promise<void>((resolveWait) => {
      const timer = setTimeout(resolveWait, 10);
      timer.unref();
    });
  }
  throw new Error('Fixture readiness wait aborted');
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errnoCode(error) === 'ESRCH') return false;
    throw error;
  }
}

async function cleanupFixtureTree(parentPid: number | undefined): Promise<void> {
  if (parentPid === undefined) return;
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort();
  }, 2_000);
  deadline.unref();
  try {
    await terminateOwnedProcessTree(process.platform, parentPid, controller.signal);
  } catch (error) {
    if (errnoCode(error) !== 'ESRCH') throw error;
  } finally {
    clearTimeout(deadline);
  }
}

describe('installed-package harness portability', () => {
  it('makes the local archive install offline and lifecycle-script free', () => {
    expect(localArchiveInstallArguments('/tmp/package.tgz')).toEqual([
      'install',
      '--ignore-scripts',
      '--offline',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      '--no-save',
      '/tmp/package.tgz'
    ]);
  });

  it('projects npm, dependency links, package targets, and bin shims for Unix', () => {
    const consumer = '/tmp/consumer';
    const harness = packageHarnessPlatform({
      platform: 'darwin',
      consumer,
      packageName: '@gabrielion/opnsense-mcp',
      nodeExecutable: '/runtime/node',
      npmCli: '/runtime/npm-cli.js',
      commandShell: undefined
    });

    expect(harness).toEqual({
      dependencyLinkType: 'dir',
      npm: { command: '/runtime/node', arguments: ['/runtime/npm-cli.js'] },
      installedShim: posix.join(consumer, 'node_modules/.bin/opnsense-mcp'),
      installedTarget: posix.join(consumer, 'node_modules/@gabrielion/opnsense-mcp/dist/main.js'),
      installedCommand: {
        command: posix.join(consumer, 'node_modules/.bin/opnsense-mcp'),
        arguments: []
      }
    });
  });

  it('uses an unprivileged junction and cmd shim through the Windows command shell', () => {
    const consumer = 'C:\\Temp\\consumer';
    const harness = packageHarnessPlatform({
      platform: 'win32',
      consumer,
      packageName: '@gabrielion/opnsense-mcp',
      nodeExecutable: 'C:\\node\\node.exe',
      npmCli: 'C:\\node\\npm-cli.js',
      commandShell: 'C:\\Windows\\System32\\cmd.exe'
    });

    expect(harness.dependencyLinkType).toBe('junction');
    expect(harness.npm).toEqual({
      command: 'C:\\node\\node.exe',
      arguments: ['C:\\node\\npm-cli.js']
    });
    expect(harness.installedShim).toBe(win32.join(consumer, 'node_modules/.bin/opnsense-mcp.cmd'));
    expect(harness.installedTarget).toBe(
      win32.join(consumer, 'node_modules/@gabrielion/opnsense-mcp/dist/main.js')
    );
    expect(harness.installedCommand).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      arguments: ['/d', '/s', '/c', `"${harness.installedShim}"`]
    });
  });

  it('derives only validated owned POSIX groups and shell-free Windows taskkill plans', () => {
    expect(ownedTreeTerminationPlan('darwin', 4321, 1234)).toEqual({
      kind: 'posix-group',
      group: -4321
    });
    expect(ownedTreeTerminationPlan('win32', 4321, 1234)).toEqual({
      kind: 'windows-taskkill',
      command: 'taskkill.exe',
      arguments: ['/pid', '4321', '/t', '/f'],
      shell: false
    });
    for (const unsafe of [undefined, Number.NaN, -1, 0, 1, 1234]) {
      expect(() => ownedTreeTerminationPlan('linux', unsafe, 1234)).toThrow(
        'Invalid owned process identifier'
      );
    }
  });

  it('does not start a Windows tree killer after its cleanup deadline has expired', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(terminateOwnedProcessTree('win32', 4321, controller.signal)).rejects.toThrow(
      'Process tree termination aborted'
    );
  });

  it('kills a real parent and descendant before rejecting the command timeout', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'mcp-owned-tree-'));
    const pidFile = join(temporaryRoot, 'descendant.pid');
    let parentPid: number | undefined;
    let descendantPid: number | undefined;
    const fixture = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      'writeFileSync(process.argv[1], String(child.pid));',
      'setInterval(() => {}, 1000);'
    ].join('');
    try {
      const timeout = await runBoundedCommand(
        { command: process.execPath, arguments: ['-e', fixture, pidFile] },
        {
          cwd: process.cwd(),
          environment: process.env,
          input: '',
          timeoutMs: 50,
          cleanupTimeoutMs: 5_000
        },
        {
          terminateOwnedTree: async (pid, signal) => {
            parentPid = validateFixturePid(pid);
            descendantPid = await waitForFixturePid(pidFile, signal);
            await terminateOwnedProcessTree(process.platform, parentPid, signal);
          }
        }
      ).catch((error: unknown) => error);
      expect(descendantPid).toBeDefined();
      if (descendantPid === undefined) {
        throw new Error('Fixture did not publish its descendant identifier');
      }
      expect(processIsAlive(descendantPid)).toBe(false);
      expect(timeout).toMatchObject({ message: 'Command timed out' });
    } finally {
      if (descendantPid === undefined || processIsAlive(descendantPid)) {
        await cleanupFixtureTree(parentPid);
      }
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 10_000);

  it('uses a fixed bounded cleanup failure when tree termination never settles', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'mcp-owned-tree-fallback-'));
    let parentPid: number | undefined;
    try {
      await expect(
        runBoundedCommand(
          { command: process.execPath, arguments: ['-e', 'setInterval(() => {}, 1000)'] },
          {
            cwd: process.cwd(),
            environment: process.env,
            input: '',
            timeoutMs: 50,
            cleanupTimeoutMs: 50
          },
          {
            terminateOwnedTree: (pid) => {
              parentPid = validateFixturePid(pid);
              return new Promise(() => undefined);
            }
          }
        )
      ).rejects.toThrow('Command cleanup timed out');
    } finally {
      await cleanupFixtureTree(parentPid);
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 5_000);

  it('rejects only after a timed-out real child has emitted close', async () => {
    let closed = false;
    await expect(
      runBoundedCommand(
        { command: process.execPath, arguments: ['-e', 'setInterval(() => {}, 1000)'] },
        {
          cwd: process.cwd(),
          environment: process.env,
          input: '',
          timeoutMs: 50,
          cleanupTimeoutMs: 2_000,
          onClose: () => {
            closed = true;
          }
        }
      )
    ).rejects.toThrow('Command timed out');
    expect(closed).toBe(true);
  });
});

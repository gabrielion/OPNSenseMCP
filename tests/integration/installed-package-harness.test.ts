// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  localArchiveInstallArguments,
  ownedTreeTerminationPlan,
  packageHarnessPlatform,
  runBoundedCommand
} from '../support/installed-package-harness.js';

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

  it('kills a real parent and descendant before rejecting the command timeout', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'mcp-owned-tree-'));
    const pidFile = join(temporaryRoot, 'descendant.pid');
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
          timeoutMs: 100,
          cleanupTimeoutMs: 2_000
        }
      ).catch((error: unknown) => error);
      const parsedDescendantPid = Number(await readFile(pidFile, 'utf8'));
      descendantPid = parsedDescendantPid;
      expect(Number.isSafeInteger(parsedDescendantPid)).toBe(true);
      expect(() => process.kill(parsedDescendantPid, 0)).toThrow(/ESRCH/u);
      expect(timeout).toMatchObject({ message: 'Command timed out' });
    } finally {
      if (descendantPid !== undefined) {
        try {
          process.kill(descendantPid, 'SIGKILL');
        } catch {
          // The GREEN path has already reaped the descendant.
        }
      }
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 5_000);

  it('uses a fixed bounded cleanup failure when tree termination never settles', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'mcp-owned-tree-fallback-'));
    const pidFile = join(temporaryRoot, 'parent.pid');
    let parentPid: number | undefined;
    const fixture = [
      "const { writeFileSync } = require('node:fs');",
      'writeFileSync(process.argv[1], String(process.pid));',
      'setInterval(() => {}, 1000);'
    ].join('');
    try {
      await expect(
        runBoundedCommand(
          { command: process.execPath, arguments: ['-e', fixture, pidFile] },
          {
            cwd: process.cwd(),
            environment: process.env,
            input: '',
            timeoutMs: 50,
            cleanupTimeoutMs: 50
          },
          { terminateOwnedTree: () => new Promise(() => undefined) }
        )
      ).rejects.toThrow('Command cleanup timed out');
      parentPid = Number(await readFile(pidFile, 'utf8'));
    } finally {
      if (parentPid !== undefined) {
        try {
          process.kill(-parentPid, 'SIGKILL');
        } catch {
          try {
            process.kill(parentPid, 'SIGKILL');
          } catch {
            // The fixture is already gone.
          }
        }
      }
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

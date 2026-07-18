// SPDX-License-Identifier: AGPL-3.0-or-later
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  localArchiveInstallArguments,
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
      installedShim: join(consumer, 'node_modules/.bin/opnsense-mcp'),
      installedTarget: join(consumer, 'node_modules/@gabrielion/opnsense-mcp/dist/main.js'),
      installedCommand: {
        command: join(consumer, 'node_modules/.bin/opnsense-mcp'),
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
    expect(harness.installedShim).toBe(join(consumer, 'node_modules/.bin/opnsense-mcp.cmd'));
    expect(harness.installedTarget).toBe(
      join(consumer, 'node_modules/@gabrielion/opnsense-mcp/dist/main.js')
    );
    expect(harness.installedCommand).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      arguments: ['/d', '/s', '/c', `"${harness.installedShim}"`]
    });
  });

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
          timeoutLabel: 'bounded-child',
          onClose: () => {
            closed = true;
          }
        }
      )
    ).rejects.toThrow('bounded-child timed out');
    expect(closed).toBe(true);
  });
});

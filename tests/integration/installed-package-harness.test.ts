// SPDX-License-Identifier: AGPL-3.0-or-later
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMMAND_SUPERVISOR_STARTUP_TIMEOUT_MS,
  POSIX_COMMAND_HARNESS_ERROR,
  ownedTreeTerminationPlan,
  packageHarnessPlatform,
  runBoundedCommand,
  terminateOwnedProcessTree
} from '../support/installed-package-harness.js';
import {
  BUILD_TIMEOUT_MS,
  INSTALL_TIMEOUT_MS,
  LIST_TIMEOUT_MS,
  PACKED_DIRECTORY_MODE,
  PACKED_FILE_MODE,
  PACK_TIMEOUT_MS,
  PREPARATION_BUDGET_MS,
  hermeticInstallArguments,
  normalizeTreeModes,
  redactedCommandFailure
} from '../../scripts/testing/prepare-installed-package.mjs';
import { REGISTRY_BUDGET_MS } from '../../scripts/testing/local-npm-registry.mjs';
import { PACKAGE_TEST_TIMEOUT_MS } from './installed-package-budget.js';
import {
  createPrivateFixtureRoot,
  removePrivateFixtureRoot
} from '../support/private-fixture-root.js';

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

async function readFixturePidIfPresent(path: string): Promise<number | undefined> {
  try {
    return validateFixturePid(await readFile(path, 'utf8'));
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return undefined;
    throw error;
  }
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

async function waitForFixtureExit(pid: number, milliseconds = 4_000): Promise<void> {
  const deadline = Date.now() + milliseconds;
  while (processIsAlive(pid) && Date.now() < deadline) {
    await new Promise<void>((resolveWait) => {
      const timer = setTimeout(resolveWait, 10);
      timer.unref();
    });
  }
  if (processIsAlive(pid)) throw new Error('Fixture process did not self-expire');
}

async function writePreReadyExitSupervisor(
  supervisorPath: string,
  supervisorPidFile: string,
  pipeHolderPidFile: string,
  pipeHoldMs: number
): Promise<void> {
  await writeFile(
    supervisorPath,
    [
      "import { spawn } from 'node:child_process';",
      "import { writeFileSync } from 'node:fs';",
      `const holder = spawn(process.execPath, ['-e', ${JSON.stringify(
        `setTimeout(() => {}, ${String(pipeHoldMs)})`
      )}], { stdio: ['ignore', 'inherit', 'inherit'] });`,
      `writeFileSync(${JSON.stringify(supervisorPidFile)}, String(process.pid));`,
      `writeFileSync(${JSON.stringify(pipeHolderPidFile)}, String(holder.pid));`,
      'holder.unref();',
      'setTimeout(() => process.exit(0), 250);'
    ].join(''),
    'utf8'
  );
}

describe('installed-package harness portability', () => {
  it('installs the local archive without lifecycle scripts, audit, or funding traffic', () => {
    expect(hermeticInstallArguments('/tmp/package.tgz')).toEqual([
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '/tmp/package.tgz'
    ]);
  });

  it('owns every child budget of the preparation it performs', () => {
    expect(PREPARATION_BUDGET_MS).toBe(
      BUILD_TIMEOUT_MS + PACK_TIMEOUT_MS + INSTALL_TIMEOUT_MS + LIST_TIMEOUT_MS + REGISTRY_BUDGET_MS
    );
    expect(PREPARATION_BUDGET_MS).toBeLessThan(PACKAGE_TEST_TIMEOUT_MS);
  });

  it('makes packed modes independent of the packing host umask', async () => {
    const root = await createPrivateFixtureRoot('mode-normalisation');
    try {
      const nested = join(root, 'nested');
      const restricted = join(root, 'restricted.txt');
      const inNested = join(nested, 'inner.txt');
      await mkdir(nested, { mode: 0o700 });
      await writeFile(restricted, 'x', { mode: 0o600 });
      await writeFile(inNested, 'y', { mode: 0o640 });
      await symlink(restricted, join(root, 'link.txt'));

      await normalizeTreeModes(root);

      // npm's portable tar keeps group/other READ bits, so 0600 and 0640 would otherwise change
      // the archive digest for identical content.
      expect((await lstat(restricted)).mode & 0o7777).toBe(PACKED_FILE_MODE);
      expect((await lstat(inNested)).mode & 0o7777).toBe(PACKED_FILE_MODE);
      expect((await lstat(nested)).mode & 0o7777).toBe(PACKED_DIRECTORY_MODE);
      expect((await lstat(join(root, 'link.txt'))).isSymbolicLink()).toBe(true);
    } finally {
      await removePrivateFixtureRoot(root);
    }
  });

  it('bounds and redacts a failed preparation command diagnostic', () => {
    const failure = redactedCommandFailure(
      'npm install',
      {
        code: 1,
        signal: null,
        stdout: '',
        stderr: `${'q'.repeat(4096)} /private/work/secret-path npm error code ENOTCACHED`
      },
      ['/private/work/secret-path']
    );

    expect(failure.message).toContain('npm install failed (exit 1, signal null)');
    expect(failure.message).toContain('ENOTCACHED');
    expect(failure.message).not.toContain('/private/work/secret-path');
    expect(failure.message).toContain('<redacted>');
    expect(failure.message.length).toBeLessThan(700);
  });

  it('projects npm, dependency links, package targets, and bin shims for Unix', () => {
    const consumer = '/tmp/consumer';
    const harness = packageHarnessPlatform({
      platform: 'darwin',
      consumer,
      packageName: '@gabrielion/opnsense-mcp',
      nodeExecutable: '/runtime/node',
      npmCli: '/runtime/npm-cli.js',
      windowsSystemRoot: undefined
    });

    expect(harness).toEqual({
      dependencyLinkType: 'dir',
      npm: { command: '/runtime/node', arguments: ['/runtime/npm-cli.js'] },
      installedShim: posix.join(consumer, 'node_modules/.bin/opnsense-mcp'),
      installedTarget: posix.join(consumer, 'node_modules/@gabrielion/opnsense-mcp/dist/main.js'),
      installedCommand: {
        command: posix.join(consumer, 'node_modules/.bin/opnsense-mcp'),
        arguments: [],
        cwd: consumer
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
      windowsSystemRoot: 'C:\\Windows'
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
      arguments: ['/d', '/s', '/c', `"${harness.installedShim}"`],
      cwd: consumer
    });
  });

  it('derives only validated owned POSIX groups and refuses Windows containment', () => {
    expect(ownedTreeTerminationPlan('darwin', 4321, 1234)).toEqual({
      kind: 'posix-group',
      group: -4321
    });
    expect(() => ownedTreeTerminationPlan('win32', 4321, 1234)).toThrow(
      POSIX_COMMAND_HARNESS_ERROR
    );
    for (const unsafe of [undefined, Number.NaN, -1, 0, 1, 1234]) {
      expect(() => ownedTreeTerminationPlan('linux', unsafe, 1234)).toThrow(
        'Invalid owned process identifier'
      );
    }
    for (const unsafeRoot of [undefined, '', 'Windows', 'C:\\Windows\\..\\Temp']) {
      expect(() =>
        packageHarnessPlatform({
          platform: 'win32',
          consumer: 'C:\\Temp\\consumer',
          packageName: '@gabrielion/opnsense-mcp',
          nodeExecutable: 'C:\\node\\node.exe',
          npmCli: 'C:\\node\\npm-cli.js',
          windowsSystemRoot: unsafeRoot
        })
      ).toThrow('Invalid Windows system root');
    }
  });

  it('refuses simulated Windows before starting the generic supervisor', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'mcp-posix-harness-boundary-'));
    const supervisorPath = join(temporaryRoot, 'must-not-start.mjs');
    const markerPath = join(temporaryRoot, 'started');
    await writeFile(
      supervisorPath,
      `import { writeFileSync } from 'node:fs';writeFileSync(${JSON.stringify(markerPath)}, 'started');`,
      'utf8'
    );
    try {
      await expect(
        runBoundedCommand(
          { command: process.execPath, arguments: ['-e', 'process.exit(0)'] },
          {
            cwd: process.cwd(),
            environment: process.env,
            input: '',
            timeoutMs: 1_000,
            cleanupTimeoutMs: 1_000
          },
          { platform: 'win32', supervisorPath }
        )
      ).rejects.toThrow(POSIX_COMMAND_HARNESS_ERROR);
      await expect(readFile(markerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('keeps the command supervisor free of Windows tree-containment branches', async () => {
    const source = await readFile(
      new URL('../support/bounded-command-supervisor.mjs', import.meta.url),
      'utf8'
    );
    expect(source).not.toMatch(/\b(?:taskkill|SystemRoot|win32)\b/u);
  });

  it('kills a real parent and descendant before rejecting the command timeout', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'mcp-owned-tree-'));
    const pidFile = join(temporaryRoot, 'descendant.pid');
    let parentPid: number | undefined;
    let descendantPid: number | undefined;
    const fixture = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { stdio: 'ignore' });",
      'writeFileSync(process.argv[1], String(child.pid));',
      'setTimeout(() => {}, 3000);'
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
            expect(processIsAlive(parentPid)).toBe(true);
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
      if (descendantPid !== undefined) await waitForFixtureExit(descendantPid);
      if (parentPid !== undefined) await waitForFixtureExit(parentPid);
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 10_000);

  it('uses a fixed bounded cleanup failure when tree termination never settles', async () => {
    let parentPid: number | undefined;
    try {
      await expect(
        runBoundedCommand(
          { command: process.execPath, arguments: ['-e', 'setTimeout(() => {}, 3000)'] },
          {
            cwd: process.cwd(),
            environment: process.env,
            input: '',
            timeoutMs: 50,
            cleanupTimeoutMs: 500
          },
          {
            terminateOwnedTree: async (pid, signal) => {
              parentPid = validateFixturePid(pid);
              await terminateOwnedProcessTree(process.platform, parentPid, signal);
              await new Promise(() => undefined);
            }
          }
        )
      ).rejects.toThrow('Command cleanup timed out');
    } finally {
      if (parentPid !== undefined) await waitForFixtureExit(parentPid);
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

  it('finalizes an ignored descendant before preserving a successful target result', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'mcp-successful-owned-family-'));
    const pidFile = join(temporaryRoot, 'descendant.pid');
    let descendantPid: number | undefined;
    const fixture = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], { stdio: 'ignore' });",
      'writeFileSync(process.argv[1], String(child.pid));',
      'child.unref();',
      "process.stdout.write('target stdout');",
      "process.stderr.write('target stderr');"
    ].join('');
    try {
      const result = await runBoundedCommand(
        { command: process.execPath, arguments: ['-e', fixture, pidFile] },
        {
          cwd: process.cwd(),
          environment: process.env,
          input: '',
          timeoutMs: 1_000,
          cleanupTimeoutMs: 2_000
        }
      );
      descendantPid = validateFixturePid(await readFile(pidFile, 'utf8'));
      expect(result).toEqual({
        code: 0,
        signal: null,
        stdout: 'target stdout',
        stderr: 'target stderr'
      });
      expect(processIsAlive(descendantPid)).toBe(false);
    } finally {
      descendantPid ??= await readFixturePidIfPresent(pidFile);
      if (descendantPid !== undefined) await waitForFixtureExit(descendantPid);
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 5_000);

  it('kills a real pre-ready supervisor by child handle and reports the startup timeout', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'mcp-pre-ready-supervisor-'));
    const supervisorPath = join(temporaryRoot, 'never-ready-supervisor.mjs');
    const pidFile = join(temporaryRoot, 'supervisor.pid');
    let supervisorPid: number | undefined;
    await writeFile(
      supervisorPath,
      [
        "import { writeFileSync } from 'node:fs';",
        `writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
        'setTimeout(() => {}, 3200);'
      ].join(''),
      'utf8'
    );
    try {
      const outerBoundMs = COMMAND_SUPERVISOR_STARTUP_TIMEOUT_MS + 1_000;
      let boundExpired = false;
      const bound = new Promise<Error>((resolveBound) => {
        const deadline = setTimeout(() => {
          boundExpired = true;
          resolveBound(new Error('outer bound expired'));
        }, outerBoundMs);
        deadline.unref();
      });
      const result = await Promise.race([
        runBoundedCommand(
          { command: process.execPath, arguments: ['-e', 'process.exit(0)'] },
          {
            cwd: process.cwd(),
            environment: process.env,
            input: '',
            timeoutMs: 1_000,
            cleanupTimeoutMs: 1_000
          },
          { supervisorPath }
        ).catch((error: unknown) => error as Error),
        bound
      ]);
      expect(boundExpired).toBe(false);
      expect(result).toMatchObject({ message: 'Command startup timed out' });
      supervisorPid = validateFixturePid(await readFile(pidFile, 'utf8'));
      expect(processIsAlive(supervisorPid)).toBe(false);
    } finally {
      supervisorPid ??= await readFixturePidIfPresent(pidFile);
      if (supervisorPid !== undefined) await waitForFixtureExit(supervisorPid);
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 6_000);

  it('settles a pre-ready kill race from the exact supervisor close event', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'mcp-pre-ready-close-race-'));
    const supervisorPath = join(temporaryRoot, 'exiting-supervisor.mjs');
    const supervisorPidFile = join(temporaryRoot, 'supervisor.pid');
    const pipeHolderPidFile = join(temporaryRoot, 'pipe-holder.pid');
    let supervisorPid: number | undefined;
    let pipeHolderPid: number | undefined;
    await writePreReadyExitSupervisor(
      supervisorPath,
      supervisorPidFile,
      pipeHolderPidFile,
      COMMAND_SUPERVISOR_STARTUP_TIMEOUT_MS + 300
    );
    try {
      await expect(
        runBoundedCommand(
          { command: process.execPath, arguments: ['-e', 'process.exit(0)'] },
          {
            cwd: process.cwd(),
            environment: process.env,
            input: '',
            timeoutMs: 1_000,
            cleanupTimeoutMs: 1_000
          },
          { supervisorPath }
        )
      ).rejects.toThrow('Command startup timed out');
      supervisorPid = validateFixturePid(await readFile(supervisorPidFile, 'utf8'));
      pipeHolderPid = validateFixturePid(await readFile(pipeHolderPidFile, 'utf8'));
      expect(processIsAlive(supervisorPid)).toBe(false);
      expect(processIsAlive(pipeHolderPid)).toBe(false);
    } finally {
      supervisorPid ??= await readFixturePidIfPresent(supervisorPidFile);
      pipeHolderPid ??= await readFixturePidIfPresent(pipeHolderPidFile);
      if (supervisorPid !== undefined) await waitForFixtureExit(supervisorPid);
      if (pipeHolderPid !== undefined) await waitForFixtureExit(pipeHolderPid);
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 6_000);

  it('retains the cleanup bound when a raced pre-ready supervisor does not close', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'mcp-pre-ready-no-close-'));
    const supervisorPath = join(temporaryRoot, 'exiting-supervisor.mjs');
    const supervisorPidFile = join(temporaryRoot, 'supervisor.pid');
    const pipeHolderPidFile = join(temporaryRoot, 'pipe-holder.pid');
    let supervisorPid: number | undefined;
    let pipeHolderPid: number | undefined;
    await writePreReadyExitSupervisor(
      supervisorPath,
      supervisorPidFile,
      pipeHolderPidFile,
      COMMAND_SUPERVISOR_STARTUP_TIMEOUT_MS + 600
    );
    try {
      await expect(
        runBoundedCommand(
          { command: process.execPath, arguments: ['-e', 'process.exit(0)'] },
          {
            cwd: process.cwd(),
            environment: process.env,
            input: '',
            timeoutMs: 1_000,
            cleanupTimeoutMs: 150
          },
          { supervisorPath }
        )
      ).rejects.toThrow('Command cleanup timed out');
      supervisorPid = validateFixturePid(await readFile(supervisorPidFile, 'utf8'));
      pipeHolderPid = validateFixturePid(await readFile(pipeHolderPidFile, 'utf8'));
      expect(processIsAlive(supervisorPid)).toBe(false);
    } finally {
      supervisorPid ??= await readFixturePidIfPresent(supervisorPidFile);
      pipeHolderPid ??= await readFixturePidIfPresent(pipeHolderPidFile);
      if (supervisorPid !== undefined) await waitForFixtureExit(supervisorPid);
      if (pipeHolderPid !== undefined) await waitForFixtureExit(pipeHolderPid);
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 6_000);

  it('normalizes a nonexistent target executable to the fixed spawn failure', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'mcp-missing-target-'));
    try {
      await expect(
        runBoundedCommand(
          { command: join(temporaryRoot, 'does-not-exist'), arguments: [] },
          {
            cwd: process.cwd(),
            environment: process.env,
            input: '',
            timeoutMs: 1_000,
            cleanupTimeoutMs: 2_000
          }
        )
      ).rejects.toThrow('Command failed to start');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('fails closed on a negative target code that is not a spawn failure', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'mcp-malformed-supervisor-'));
    const supervisorPath = join(temporaryRoot, 'malformed-supervisor.mjs');
    await writeFile(
      supervisorPath,
      [
        "process.on('message', (message) => {",
        "if (message?.type === 'start') process.send({ type: 'target-close', code: -2, signal: null, spawnFailed: false });",
        '});',
        "process.send({ type: 'ready' });",
        'setTimeout(() => {}, 1500);'
      ].join(''),
      'utf8'
    );
    try {
      await expect(
        runBoundedCommand(
          { command: process.execPath, arguments: ['-e', 'process.exit(0)'] },
          {
            cwd: process.cwd(),
            environment: process.env,
            input: '',
            timeoutMs: 1_000,
            cleanupTimeoutMs: 2_000
          },
          { supervisorPath }
        )
      ).rejects.toThrow('Command supervisor protocol failed');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 5_000);

  it('bounds captured command output before returning a fixed failure', async () => {
    await expect(
      runBoundedCommand(
        { command: process.execPath, arguments: ['-e', "process.stdout.write('x'.repeat(33))"] },
        {
          cwd: process.cwd(),
          environment: process.env,
          input: '',
          timeoutMs: 1_000,
          cleanupTimeoutMs: 1_000
        },
        { outputLimitBytes: 32 }
      )
    ).rejects.toThrow('Command output limit exceeded');
  });
});

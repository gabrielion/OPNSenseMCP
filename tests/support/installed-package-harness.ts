// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process';
import { posix, win32 } from 'node:path';

export interface CommandInvocation {
  readonly command: string;
  readonly arguments: readonly string[];
}

export interface CommandResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface PackageHarnessPlatformInput {
  readonly platform: NodeJS.Platform;
  readonly consumer: string;
  readonly packageName: string;
  readonly nodeExecutable: string;
  readonly npmCli: string;
  readonly commandShell: string | undefined;
}

interface PackageHarnessPlatform {
  readonly dependencyLinkType: 'dir' | 'junction';
  readonly npm: CommandInvocation;
  readonly installedShim: string;
  readonly installedTarget: string;
  readonly installedCommand: CommandInvocation;
}

interface BoundedCommandOptions {
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly input: string;
  readonly timeoutMs: number;
  readonly cleanupTimeoutMs: number;
  readonly onClose?: () => void;
}

interface BoundedCommandDependencies {
  readonly platform?: NodeJS.Platform;
  readonly terminateOwnedTree?: (pid: number, signal: AbortSignal) => Promise<void>;
}

export type OwnedTreeTerminationPlan =
  | { readonly kind: 'posix-group'; readonly group: number }
  | {
      readonly kind: 'windows-taskkill';
      readonly command: 'taskkill.exe';
      readonly arguments: readonly ['/pid', string, '/t', '/f'];
      readonly shell: false;
    };

function errnoCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function validatedOwnedPid(pid: number | undefined, currentPid: number): number {
  if (!Number.isSafeInteger(pid) || pid === undefined || pid <= 1 || pid === currentPid) {
    throw new Error('Invalid owned process identifier');
  }
  return pid;
}

export function ownedTreeTerminationPlan(
  platform: NodeJS.Platform,
  pid: number | undefined,
  currentPid = process.pid
): OwnedTreeTerminationPlan {
  const ownedPid = validatedOwnedPid(pid, currentPid);
  if (platform === 'win32') {
    const arguments_: readonly ['/pid', string, '/t', '/f'] = [
      '/pid',
      String(ownedPid),
      '/t',
      '/f'
    ];
    return Object.freeze({
      kind: 'windows-taskkill',
      command: 'taskkill.exe',
      arguments: Object.freeze(arguments_),
      shell: false
    });
  }
  return Object.freeze({ kind: 'posix-group', group: -ownedPid });
}

function terminateWindowsTree(
  plan: Extract<OwnedTreeTerminationPlan, { readonly kind: 'windows-taskkill' }>,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolveTermination, rejectTermination) => {
    const killer = spawn(plan.command, [...plan.arguments], {
      shell: plan.shell,
      stdio: 'ignore',
      windowsHide: true
    });
    killer.unref();
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      killer.removeAllListeners();
      callback();
    };
    const onAbort = () => {
      try {
        killer.kill('SIGKILL');
      } catch {
        // The independently owned cleanup deadline remains authoritative.
      }
      finish(() => {
        rejectTermination(new Error('Process tree termination aborted'));
      });
    };
    killer.once('error', () => {
      finish(() => {
        rejectTermination(new Error('Process tree termination failed'));
      });
    });
    killer.once('close', (code, terminationSignal) => {
      if (code === 0 && terminationSignal === null) {
        finish(() => {
          resolveTermination();
        });
      } else {
        finish(() => {
          rejectTermination(new Error('Process tree termination failed'));
        });
      }
    });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function terminateOwnedProcessTree(
  platform: NodeJS.Platform,
  pid: number | undefined,
  signal: AbortSignal
): Promise<void> {
  const plan = ownedTreeTerminationPlan(platform, pid);
  if (plan.kind === 'windows-taskkill') {
    await terminateWindowsTree(plan, signal);
    return;
  }
  if (signal.aborted) throw new Error('Process tree termination aborted');
  try {
    process.kill(plan.group, 'SIGKILL');
  } catch (error) {
    if (errnoCode(error) === 'ESRCH') return;
    throw new Error('Process tree termination failed');
  }
}

export function localArchiveInstallArguments(archive: string): readonly string[] {
  return Object.freeze([
    'install',
    '--ignore-scripts',
    '--offline',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
    '--no-save',
    archive
  ]);
}

export function packageHarnessPlatform(input: PackageHarnessPlatformInput): PackageHarnessPlatform {
  const pathProjection = input.platform === 'win32' ? win32 : posix;
  const installedShim = pathProjection.join(
    input.consumer,
    `node_modules/.bin/opnsense-mcp${input.platform === 'win32' ? '.cmd' : ''}`
  );
  const installedTarget = pathProjection.join(
    input.consumer,
    'node_modules',
    input.packageName,
    'dist/main.js'
  );
  const commandShell = input.commandShell ?? 'cmd.exe';
  return Object.freeze({
    dependencyLinkType: input.platform === 'win32' ? 'junction' : 'dir',
    npm: Object.freeze({ command: input.nodeExecutable, arguments: Object.freeze([input.npmCli]) }),
    installedShim,
    installedTarget,
    installedCommand: Object.freeze(
      input.platform === 'win32'
        ? {
            command: commandShell,
            arguments: Object.freeze(['/d', '/s', '/c', `"${installedShim}"`])
          }
        : { command: installedShim, arguments: Object.freeze([]) }
    )
  });
}

export function runBoundedCommand(
  invocation: CommandInvocation,
  options: BoundedCommandOptions,
  dependencies: BoundedCommandDependencies = {}
): Promise<CommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const platform = dependencies.platform ?? process.platform;
    const child = spawn(invocation.command, [...invocation.arguments], {
      cwd: options.cwd,
      detached: platform !== 'win32',
      env: options.environment,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnFailed = false;
    let childClosed = false;
    let treeSettled = false;
    let settled = false;
    let cleanupDeadline: ReturnType<typeof setTimeout> | undefined;
    const terminationAbort = new AbortController();
    const finish = (callback: () => void, detach = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (cleanupDeadline !== undefined) clearTimeout(cleanupDeadline);
      terminationAbort.abort();
      if (detach) {
        child.removeAllListeners();
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
      }
      callback();
    };
    const settleTimedOutCommand = () => {
      if (!timedOut || !childClosed || !treeSettled) return;
      finish(() => {
        rejectCommand(new Error('Command timed out'));
      });
    };
    const deadline = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      cleanupDeadline = setTimeout(() => {
        finish(() => {
          rejectCommand(new Error('Command cleanup timed out'));
        }, true);
      }, options.cleanupTimeoutMs);
      cleanupDeadline.unref();
      const pid = child.pid;
      let termination: Promise<void>;
      try {
        const ownedPid = validatedOwnedPid(pid, process.pid);
        termination =
          dependencies.terminateOwnedTree === undefined
            ? terminateOwnedProcessTree(platform, ownedPid, terminationAbort.signal)
            : dependencies.terminateOwnedTree(ownedPid, terminationAbort.signal);
      } catch {
        termination = Promise.reject(new Error('Process tree termination failed'));
      }
      void termination.then(
        () => {
          treeSettled = true;
          settleTimedOutCommand();
        },
        () => undefined
      );
    }, options.timeoutMs);
    deadline.unref();
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.stdin.on('error', () => undefined);
    child.once('error', () => {
      spawnFailed = true;
    });
    child.once('close', (code, signal) => {
      childClosed = true;
      options.onClose?.();
      if (timedOut) {
        settleTimedOutCommand();
        return;
      }
      if (spawnFailed) {
        finish(() => {
          rejectCommand(new Error('Command failed to start'));
        });
        return;
      }
      finish(() => {
        resolveCommand({ code, signal, stdout, stderr });
      });
    });
    child.stdin.end(options.input);
  });
}

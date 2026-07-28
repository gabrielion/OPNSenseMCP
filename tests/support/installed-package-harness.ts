// SPDX-License-Identifier: AGPL-3.0-or-later
import { fork, spawn } from 'node:child_process';
import { posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CommandInvocation {
  readonly command: string;
  readonly arguments: readonly string[];
}

export interface InstalledCommandInvocation extends CommandInvocation {
  readonly cwd: string;
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
  readonly windowsSystemRoot: string | undefined;
}

interface PackageHarnessPlatform {
  readonly dependencyLinkType: 'dir' | 'junction';
  readonly npm: CommandInvocation;
  readonly installedShim: string;
  readonly installedTarget: string;
  readonly installedCommand: InstalledCommandInvocation;
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
  readonly supervisorPath?: string;
  readonly terminateOwnedTree?: (pid: number, signal: AbortSignal) => Promise<void>;
  readonly outputLimitBytes?: number;
}

export const POSIX_COMMAND_HARNESS_ERROR =
  'Installed-package bounded-command harness requires POSIX process groups; use the native Windows product smoke for Windows validation';

export interface OwnedTreeTerminationPlan {
  readonly kind: 'posix-group';
  readonly group: number;
}

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

function windowsSystemExecutable(systemRoot: string | undefined, executable: string): string {
  if (
    typeof systemRoot !== 'string' ||
    !/^[A-Za-z]:\\[^\0/]+(?:\\[^\0/]+)*$/u.test(systemRoot) ||
    win32.normalize(systemRoot) !== systemRoot
  ) {
    throw new Error('Invalid Windows system root');
  }
  return win32.join(systemRoot, 'System32', executable);
}

function assertSupportedCommandHarnessPlatform(
  platform: NodeJS.Platform
): asserts platform is 'darwin' | 'linux' {
  if (platform !== 'darwin' && platform !== 'linux') {
    throw new Error(POSIX_COMMAND_HARNESS_ERROR);
  }
}

export function ownedTreeTerminationPlan(
  platform: NodeJS.Platform,
  pid: number | undefined,
  currentPid = process.pid
): OwnedTreeTerminationPlan {
  assertSupportedCommandHarnessPlatform(platform);
  const ownedPid = validatedOwnedPid(pid, currentPid);
  return Object.freeze({ kind: 'posix-group', group: -ownedPid });
}

const PROCESS_LIST_OUTPUT_LIMIT = 4 * 1024 * 1024;

function posixGroupHasMembers(group: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolveInspection, rejectInspection) => {
    if (signal.aborted) {
      rejectInspection(new Error('Process tree wait aborted'));
      return;
    }
    const groupId = Math.abs(group);
    const inspector = spawn('/bin/ps', ['-axo', 'pgid='], {
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    let output = '';
    let outputBytes = 0;
    let outputExceeded = false;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      inspector.stdout.removeAllListeners('data');
      callback();
    };
    const stopInspector = () => {
      try {
        inspector.kill('SIGKILL');
      } catch {
        // Its fixed parent cleanup deadline remains authoritative.
      }
    };
    const onAbort = () => {
      stopInspector();
      inspector.stdout.destroy();
      inspector.unref();
      finish(() => {
        rejectInspection(new Error('Process tree wait aborted'));
      });
    };
    inspector.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > PROCESS_LIST_OUTPUT_LIMIT) {
        outputExceeded = true;
        stopInspector();
        inspector.stdout.destroy();
        inspector.unref();
        return;
      }
      output += chunk.toString('utf8');
    });
    inspector.once('error', () => {
      finish(() => {
        rejectInspection(new Error('Process tree status failed'));
      });
    });
    inspector.once('close', (code, terminationSignal) => {
      if (outputExceeded || code !== 0 || terminationSignal !== null) {
        finish(() => {
          rejectInspection(new Error('Process tree status failed'));
        });
        return;
      }
      const hasMember = output.split(/\r?\n/u).some((line) => line.trim() === String(groupId));
      finish(() => {
        resolveInspection(hasMember);
      });
    });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function waitForPosixGroupExit(group: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveExit, rejectExit) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => {
      finish(() => {
        rejectExit(new Error('Process tree wait aborted'));
      });
    };
    const inspect = async () => {
      try {
        if (!(await posixGroupHasMembers(group, signal))) {
          finish(resolveExit);
          return;
        }
        if (settled || signal.aborted) {
          onAbort();
          return;
        }
        timer = setTimeout(() => void inspect(), 25);
        timer.unref();
      } catch {
        if (signal.aborted) {
          onAbort();
          return;
        }
        finish(() => {
          rejectExit(new Error('Process tree status failed'));
        });
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void inspect();
  });
}

export async function terminateOwnedProcessTree(
  platform: NodeJS.Platform,
  pid: number | undefined,
  signal: AbortSignal
): Promise<void> {
  const plan = ownedTreeTerminationPlan(platform, pid, process.pid);
  if (signal.aborted) throw new Error('Process tree termination aborted');
  try {
    process.kill(plan.group, 'SIGKILL');
  } catch (error) {
    if (errnoCode(error) === 'ESRCH') return;
    throw new Error('Process tree termination failed');
  }
  await waitForPosixGroupExit(plan.group, signal);
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
  return Object.freeze({
    dependencyLinkType: input.platform === 'win32' ? 'junction' : 'dir',
    npm: Object.freeze({ command: input.nodeExecutable, arguments: Object.freeze([input.npmCli]) }),
    installedShim,
    installedTarget,
    installedCommand: Object.freeze(
      input.platform === 'win32'
        ? {
            command: windowsSystemExecutable(input.windowsSystemRoot, 'cmd.exe'),
            arguments: Object.freeze(['/d', '/s', '/c', `"${installedShim}"`]),
            cwd: input.consumer
          }
        : { command: installedShim, arguments: Object.freeze([]), cwd: input.consumer }
    )
  });
}

export const COMMAND_SUPERVISOR_STARTUP_TIMEOUT_MS = 2_000;
const DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
const COMMAND_SUPERVISOR_PATH = fileURLToPath(
  new URL('./bounded-command-supervisor.mjs', import.meta.url)
);

interface OutputCapture {
  readonly chunks: Buffer[];
  bytes: number;
  exceeded: boolean;
}

interface TargetCloseMessage {
  readonly type: 'target-close';
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly spawnFailed: boolean;
}

type SupervisorMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'started' }
  | TargetCloseMessage;

function hasExactObjectKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isSupervisorMessage(value: unknown): value is SupervisorMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const type = (value as { readonly type?: unknown }).type;
  if (type === 'ready' || type === 'started') return hasExactObjectKeys(value, ['type']);
  if (type !== 'target-close') return false;
  const message = value as {
    readonly code?: unknown;
    readonly signal?: unknown;
    readonly spawnFailed?: unknown;
  };
  return (
    hasExactObjectKeys(value, ['code', 'signal', 'spawnFailed', 'type']) &&
    (message.code === null ||
      (typeof message.code === 'number' &&
        Number.isSafeInteger(message.code) &&
        message.code >= 0)) &&
    (message.signal === null ||
      (typeof message.signal === 'string' && /^SIG[A-Z0-9]+$/u.test(message.signal))) &&
    typeof message.spawnFailed === 'boolean'
  );
}

function validatedOutputLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES;
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Invalid command output limit');
  return limit;
}

function captureOutput(capture: OutputCapture, chunk: Buffer, limit: number): void {
  const remaining = Math.max(0, limit - capture.bytes);
  if (chunk.length > remaining) capture.exceeded = true;
  if (remaining === 0) return;
  const accepted = chunk.subarray(0, remaining);
  capture.chunks.push(accepted);
  capture.bytes += accepted.length;
}

function serializableEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string';
    })
  );
}

/**
 * Runs project-owned test commands under a durable supervisor. Commands and their descendants must stay
 * in the inherited process family: setsid, double-fork, daemonization, and Windows breakaway are outside
 * this portable cleanup contract and therefore may only produce an unconfirmed-cleanup failure.
 */
export function runBoundedCommand(
  invocation: CommandInvocation,
  options: BoundedCommandOptions,
  dependencies: BoundedCommandDependencies = {}
): Promise<CommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const platform = dependencies.platform ?? process.platform;
    try {
      assertSupportedCommandHarnessPlatform(platform);
    } catch {
      rejectCommand(new Error(POSIX_COMMAND_HARNESS_ERROR));
      return;
    }
    let outputLimit: number;
    try {
      outputLimit = validatedOutputLimit(dependencies.outputLimitBytes);
    } catch {
      rejectCommand(new Error('Command platform configuration failed'));
      return;
    }
    let supervisor: ReturnType<typeof fork>;
    try {
      supervisor = fork(dependencies.supervisorPath ?? COMMAND_SUPERVISOR_PATH, [], {
        cwd: options.cwd,
        detached: true,
        env: Object.freeze({}),
        execArgv: [],
        serialization: 'json',
        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
      });
    } catch {
      rejectCommand(new Error('Command failed to start'));
      return;
    }
    if (supervisor.stdin === null || supervisor.stdout === null || supervisor.stderr === null) {
      supervisor.kill('SIGKILL');
      rejectCommand(new Error('Command failed to start'));
      return;
    }
    const supervisorInput = supervisor.stdin;
    const supervisorOutput = supervisor.stdout;
    const supervisorError = supervisor.stderr;
    const stdout: OutputCapture = { chunks: [], bytes: 0, exceeded: false };
    const stderr: OutputCapture = { chunks: [], bytes: 0, exceeded: false };
    let state: 'starting' | 'active' | 'terminating' | 'closed' = 'starting';
    let supervisorReady = false;
    let supervisorSpawnFailed = false;
    let supervisorExited = false;
    let supervisorClosed = false;
    let targetResult: TargetCloseMessage | undefined;
    let terminationStarted = false;
    let treeSettled = false;
    let settled = false;
    let terminationReason: string | undefined;
    let commandDeadline: ReturnType<typeof setTimeout> | undefined;
    let cleanupDeadline: ReturnType<typeof setTimeout> | undefined;
    const terminationAbort = new AbortController();
    const clearDeadlines = () => {
      clearTimeout(startupDeadline);
      if (commandDeadline !== undefined) clearTimeout(commandDeadline);
      if (cleanupDeadline !== undefined) clearTimeout(cleanupDeadline);
    };
    const finish = (callback: () => void, detach = false) => {
      if (settled) return;
      settled = true;
      clearDeadlines();
      terminationAbort.abort();
      if (detach) {
        try {
          if (supervisor.connected) supervisor.disconnect();
        } catch {
          // Detachment never upgrades an unconfirmed cleanup to success.
        }
        supervisorInput.destroy();
        supervisorOutput.destroy();
        supervisorError.destroy();
        supervisor.unref();
      }
      callback();
    };
    const finishCleanedCommand = () => {
      if (targetResult === undefined) {
        finish(() => {
          rejectCommand(new Error('Command cleanup unconfirmed'));
        });
        return;
      }
      const result = targetResult;
      if (result.spawnFailed || supervisorSpawnFailed) {
        finish(() => {
          rejectCommand(new Error('Command failed to start'));
        });
        return;
      }
      if (stdout.exceeded || stderr.exceeded) {
        finish(() => {
          rejectCommand(new Error('Command output limit exceeded'));
        });
        return;
      }
      finish(() => {
        resolveCommand({
          code: result.code,
          signal: result.signal,
          stdout: Buffer.concat(stdout.chunks).toString('utf8'),
          stderr: Buffer.concat(stderr.chunks).toString('utf8')
        });
      });
    };
    const settleTerminatedCommand = () => {
      if (!terminationStarted || !supervisorClosed || !treeSettled) return;
      if (terminationReason === undefined) {
        finishCleanedCommand();
        return;
      }
      const reason = terminationReason;
      finish(() => {
        rejectCommand(new Error(reason));
      });
    };
    const beginTermination = (reason?: string) => {
      if (settled || terminationStarted || state === 'closed') return;
      terminationStarted = true;
      terminationReason = reason;
      state = 'terminating';
      clearDeadlines();
      cleanupDeadline = setTimeout(() => {
        finish(() => {
          rejectCommand(new Error('Command cleanup timed out'));
        }, true);
      }, options.cleanupTimeoutMs);
      cleanupDeadline.unref();
      if (!supervisorReady) {
        try {
          if (supervisor.kill('SIGKILL')) {
            treeSettled = true;
            settleTerminatedCommand();
          }
        } catch {
          // The independently owned cleanup deadline remains authoritative.
        }
        return;
      }
      let termination: Promise<void>;
      try {
        if (supervisorExited || supervisor.exitCode !== null || supervisor.signalCode !== null) {
          termination = Promise.reject(new Error('Process identity is no longer owned'));
        } else {
          const ownedPid = validatedOwnedPid(supervisor.pid, process.pid);
          termination =
            dependencies.terminateOwnedTree === undefined
              ? terminateOwnedProcessTree(platform, ownedPid, terminationAbort.signal)
              : dependencies.terminateOwnedTree(ownedPid, terminationAbort.signal);
        }
      } catch {
        termination = Promise.reject(new Error('Process tree termination failed'));
      }
      void termination.then(
        () => {
          treeSettled = true;
          settleTerminatedCommand();
        },
        () => undefined
      );
    };
    const sendToSupervisor = (message: object): boolean => {
      if (!supervisor.connected) return false;
      try {
        supervisor.send(message);
        return true;
      } catch {
        return false;
      }
    };
    supervisorOutput.on('data', (chunk: Buffer) => {
      captureOutput(stdout, chunk, outputLimit);
    });
    supervisorError.on('data', (chunk: Buffer) => {
      captureOutput(stderr, chunk, outputLimit);
    });
    supervisorInput.on('error', () => undefined);
    supervisor.once('error', () => {
      supervisorSpawnFailed = true;
    });
    supervisor.once('exit', () => {
      supervisorExited = true;
    });
    supervisor.once('close', () => {
      supervisorClosed = true;
      state = 'closed';
      options.onClose?.();
      if (terminationStarted) {
        // Before ready, exact-child close proves that no target process could have been started.
        if (!supervisorReady) treeSettled = true;
        settleTerminatedCommand();
        return;
      }
      finish(() => {
        rejectCommand(
          new Error(
            supervisorSpawnFailed ? 'Command failed to start' : 'Command cleanup unconfirmed'
          )
        );
      });
    });
    supervisor.on('message', (message: unknown) => {
      if (!isSupervisorMessage(message)) {
        beginTermination('Command supervisor protocol failed');
        return;
      }
      if (message.type === 'ready') {
        if (state !== 'starting' || supervisorReady) {
          beginTermination('Command supervisor protocol failed');
          return;
        }
        supervisorReady = true;
        if (
          !sendToSupervisor({
            type: 'start',
            command: invocation.command,
            arguments: [...invocation.arguments],
            environment: serializableEnvironment(options.environment)
          })
        ) {
          beginTermination('Command supervisor protocol failed');
        }
        return;
      }
      if (message.type === 'started') {
        if (state !== 'starting' || !supervisorReady) {
          beginTermination('Command supervisor protocol failed');
          return;
        }
        clearTimeout(startupDeadline);
        state = 'active';
        commandDeadline = setTimeout(() => {
          beginTermination('Command timed out');
        }, options.timeoutMs);
        commandDeadline.unref();
        return;
      }
      if (
        terminationStarted ||
        (state !== 'active' && !(state === 'starting' && message.spawnFailed))
      ) {
        return;
      }
      clearTimeout(startupDeadline);
      if (commandDeadline !== undefined) clearTimeout(commandDeadline);
      targetResult = message;
      beginTermination();
    });
    const startupDeadline = setTimeout(() => {
      beginTermination('Command startup timed out');
    }, COMMAND_SUPERVISOR_STARTUP_TIMEOUT_MS);
    startupDeadline.unref();
    supervisorInput.end(options.input);
  });
}

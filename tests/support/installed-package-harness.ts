// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process';
import { join } from 'node:path';

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
  readonly timeoutLabel: string;
  readonly onClose?: () => void;
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
  const installedShim = join(
    input.consumer,
    `node_modules/.bin/opnsense-mcp${input.platform === 'win32' ? '.cmd' : ''}`
  );
  const installedTarget = join(input.consumer, 'node_modules', input.packageName, 'dist/main.js');
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
  options: BoundedCommandOptions
): Promise<CommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(invocation.command, [...invocation.arguments], {
      cwd: options.cwd,
      env: options.environment,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnFailed = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // The close event remains the child ownership settlement.
      }
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
      clearTimeout(deadline);
      options.onClose?.();
      if (spawnFailed) {
        rejectCommand(new Error(`${options.timeoutLabel} failed to start`));
        return;
      }
      if (timedOut) {
        rejectCommand(new Error(`${options.timeoutLabel} timed out`));
        return;
      }
      resolveCommand({ code, signal, stdout, stderr });
    });
    child.stdin.end(options.input);
  });
}

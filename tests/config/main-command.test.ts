// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { runCommandLine, type CommandLineDependencies } from '../../src/main.js';

function dependencies(): CommandLineDependencies & {
  readonly startStdio: ReturnType<typeof vi.fn>;
  readonly runConfigure: ReturnType<typeof vi.fn>;
  readonly writeError: ReturnType<typeof vi.fn>;
  readonly writeOutput: ReturnType<typeof vi.fn>;
} {
  const startStdio = vi.fn(() => Promise.resolve());
  const runConfigure = vi.fn(() => Promise.resolve(0 as const));
  const writeError = vi.fn();
  const writeOutput = vi.fn();
  return { startStdio, runConfigure, writeError, writeOutput };
}

describe('main command selection', () => {
  it('runs the protocol-clean stdio entrypoint for no arguments', async () => {
    const command = dependencies();

    await expect(runCommandLine([], command)).resolves.toBe(0);

    expect(command.startStdio).toHaveBeenCalledTimes(1);
    expect(command.runConfigure).not.toHaveBeenCalled();
    expect(command.writeError).not.toHaveBeenCalled();
  });

  it('passes only trailing arguments to the exact configure subcommand', async () => {
    const command = dependencies();

    await expect(runCommandLine(['configure'], command)).resolves.toBe(0);

    expect(command.startStdio).not.toHaveBeenCalled();
    expect(command.runConfigure).toHaveBeenCalledWith([]);
    expect(command.writeError).not.toHaveBeenCalled();
  });

  it.each([['--help'], ['-h']])('prints usage for %s without starting anything', async (flag) => {
    const command = dependencies();

    await expect(runCommandLine([flag], command)).resolves.toBe(0);

    expect(command.startStdio).not.toHaveBeenCalled();
    expect(command.runConfigure).not.toHaveBeenCalled();
    expect(command.writeError).not.toHaveBeenCalled();
    expect(command.writeOutput).toHaveBeenCalledTimes(1);
    const usage = command.writeOutput.mock.calls[0]?.[0] as string;
    expect(usage).toContain('configure');
    expect(usage).toContain('--version');
  });

  it('prints only the version for --version', async () => {
    const command = dependencies();

    await expect(runCommandLine(['--version'], command)).resolves.toBe(0);

    expect(command.startStdio).not.toHaveBeenCalled();
    expect(command.runConfigure).not.toHaveBeenCalled();
    expect(command.writeError).not.toHaveBeenCalled();
    expect(command.writeOutput).toHaveBeenCalledWith('0.1.1\n');
  });

  it('rejects every non-configure argument without starting stdio', async () => {
    const command = dependencies();

    await expect(runCommandLine(['--api-key', 'SENTINEL_KEY'], command)).resolves.toBe(1);

    expect(command.startStdio).not.toHaveBeenCalled();
    expect(command.runConfigure).not.toHaveBeenCalled();
    expect(command.writeError).toHaveBeenCalledWith('Error\n');
    expect(command.writeError.mock.calls.flat().join('')).not.toContain('SENTINEL_KEY');
  });
});

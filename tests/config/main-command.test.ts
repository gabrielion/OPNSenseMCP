// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { runCommandLine, type CommandLineDependencies } from '../../src/main.js';

function dependencies(): CommandLineDependencies & {
  readonly startStdio: ReturnType<typeof vi.fn>;
  readonly runConfigure: ReturnType<typeof vi.fn>;
  readonly writeError: ReturnType<typeof vi.fn>;
} {
  const startStdio = vi.fn(() => Promise.resolve());
  const runConfigure = vi.fn(() => Promise.resolve(0 as const));
  const writeError = vi.fn();
  return { startStdio, runConfigure, writeError };
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

  it('rejects every non-configure argument without starting stdio', async () => {
    const command = dependencies();

    await expect(runCommandLine(['--api-key', 'SENTINEL_KEY'], command)).resolves.toBe(1);

    expect(command.startStdio).not.toHaveBeenCalled();
    expect(command.runConfigure).not.toHaveBeenCalled();
    expect(command.writeError).toHaveBeenCalledWith('Error\n');
    expect(command.writeError.mock.calls.flat().join('')).not.toContain('SENTINEL_KEY');
  });
});

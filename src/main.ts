// SPDX-License-Identifier: AGPL-3.0-or-later
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { startStdio, type StdioRuntime } from './entrypoints/stdio.js';

interface SignalProcess {
  exitCode?: string | number | null | undefined;
  once(signal: 'SIGINT' | 'SIGTERM', listener: () => void | Promise<void>): unknown;
}

interface StdioInput {
  readonly readableEnded: boolean;
  once(event: 'end', listener: () => void | Promise<void>): unknown;
}

export function installStdioSignalHandlers(
  handle: StdioRuntime,
  target: SignalProcess = process,
  input: StdioInput = process.stdin
): void {
  let settlement: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    settlement ??= (async () => {
      const hold = setInterval(() => undefined, 2_147_483_647);
      try {
        await handle.close();
      } catch (error: unknown) {
        const diagnostic = error instanceof Error ? error.name : 'Error';
        process.stderr.write(`${diagnostic}\n`);
        target.exitCode = 1;
      } finally {
        clearInterval(hold);
      }
    })();
    return settlement;
  };
  target.once('SIGINT', shutdown);
  target.once('SIGTERM', shutdown);
  input.once('end', shutdown);
  if (input.readableEnded) {
    void shutdown();
  }
}

export async function runStdioEntrypoint(): Promise<StdioRuntime> {
  const handle = await startStdio();
  installStdioSignalHandlers(handle);
  return handle;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  void runStdioEntrypoint().catch((error: unknown) => {
    const diagnostic = error instanceof Error ? error.name : 'Error';
    process.stderr.write(`${diagnostic}\n`);
    process.exitCode = 1;
  });
}

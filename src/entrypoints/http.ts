// SPDX-License-Identifier: AGPL-3.0-or-later
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDefaultApplicationRuntime,
  type OwnedApplicationRuntime
} from '../app/default-application.js';
import { createAggregateClose, startHttp, type HttpRuntime } from '../http/runtime.js';

interface SignalProcess {
  exitCode?: string | number | null | undefined;
  once(signal: 'SIGINT' | 'SIGTERM', listener: () => void | Promise<void>): unknown;
}

export type OwnedHttpRuntime = HttpRuntime;

export interface HttpEntrypointDependencies {
  readonly createDefaultRuntime: () => OwnedApplicationRuntime;
  readonly start: typeof startHttp;
}

const DEFAULT_DEPENDENCIES: HttpEntrypointDependencies = Object.freeze({
  createDefaultRuntime: createDefaultApplicationRuntime,
  start: startHttp
});

export function installHttpSignalHandlers(
  handle: OwnedHttpRuntime,
  target: SignalProcess = process
): void {
  const shutdown = async () => {
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
  };
  target.once('SIGINT', shutdown);
  target.once('SIGTERM', shutdown);
}

export async function startOwnedHttpEntrypoint(
  dependencies: HttpEntrypointDependencies = DEFAULT_DEPENDENCIES
): Promise<OwnedHttpRuntime> {
  const owned = dependencies.createDefaultRuntime();
  let http: HttpRuntime;
  try {
    http = await dependencies.start(owned.application);
  } catch (startupFailure) {
    const cleanup = await Promise.allSettled([owned.close()]);
    const cleanupFailures = cleanup.flatMap((result) =>
      result.status === 'rejected'
        ? [result.reason instanceof Error ? result.reason : new Error(String(result.reason))]
        : []
    );
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [
          startupFailure instanceof Error ? startupFailure : new Error(String(startupFailure)),
          ...cleanupFailures
        ],
        'HTTP entrypoint startup and cleanup failed'
      );
    }
    throw startupFailure;
  }
  return Object.freeze({
    url: http.url,
    limits: http.limits,
    close: createAggregateClose([() => http.close(), () => owned.close()])
  });
}

export async function runHttpEntrypoint(): Promise<OwnedHttpRuntime> {
  const handle = await startOwnedHttpEntrypoint();
  process.stderr.write(`${new URL(handle.url).origin}\n`);
  installHttpSignalHandlers(handle);
  return handle;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  void runHttpEntrypoint().catch((error: unknown) => {
    const diagnostic = error instanceof Error ? error.name : 'Error';
    process.stderr.write(`${diagnostic}\n`);
    process.exitCode = 1;
  });
}

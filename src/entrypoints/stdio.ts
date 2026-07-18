// SPDX-License-Identifier: AGPL-3.0-or-later
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import type { Transport } from '@modelcontextprotocol/server';
import type { ApplicationContext } from '../app/application-context.js';
import { createPhasedClose } from '../app/shutdown.js';
import {
  createDefaultApplicationRuntime,
  type OwnedApplicationRuntime
} from '../app/default-application.js';
import { DEFAULT_HTTP_LIMITS } from '../http/limits.js';
import { createServerFactory } from '../mcp/server-factory.js';

export interface StdioRuntime {
  close(): Promise<void>;
}

export interface InternalStdioOptions {
  readonly transport?: Transport;
}

export interface StdioRuntimeDependencies {
  readonly createDefaultRuntime: () => OwnedApplicationRuntime;
  readonly serve: typeof serveStdio;
}

const DEFAULT_DEPENDENCIES: StdioRuntimeDependencies = Object.freeze({
  createDefaultRuntime: createDefaultApplicationRuntime,
  serve: serveStdio
});

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function flattenFailure(value: unknown): Error[] {
  if (value instanceof AggregateError) return value.errors.flatMap(flattenFailure);
  return [toError(value)];
}

export function createStdioAggregateClose(
  serverClose: () => Promise<void>,
  runtimeClose: (() => Promise<void>) | undefined,
  recordedFailures: () => readonly Error[]
): () => Promise<void> {
  return createPhasedClose(
    [[serverClose], ...(runtimeClose === undefined ? [] : [[runtimeClose]])],
    recordedFailures,
    'Stdio cleanup failed'
  );
}

function diagnose(): void {
  process.stderr.write('Error\n');
}

export async function startStdioWithDependencies(
  application: ApplicationContext | undefined,
  options: InternalStdioOptions,
  dependencies: StdioRuntimeDependencies
): Promise<StdioRuntime> {
  const owned = application === undefined ? dependencies.createDefaultRuntime() : undefined;
  const effectiveApplication = application ?? owned?.application;
  if (effectiveApplication === undefined) throw new Error('Application runtime is unavailable');
  const failures: Error[] = [];
  const record = (error: Error) => {
    failures.push(error);
    diagnose();
  };
  let handle: StdioServerHandle;
  try {
    handle = dependencies.serve(createServerFactory(effectiveApplication, 'stdio'), {
      legacy: 'serve',
      maxSubscriptions: DEFAULT_HTTP_LIMITS.maxSubscriptions,
      onerror: record,
      ...(options.transport === undefined ? {} : { transport: options.transport })
    });
  } catch (error) {
    const cleanup =
      owned === undefined
        ? []
        : await Promise.allSettled([Promise.resolve().then(() => owned.close())]);
    const cleanupFailures = cleanup.flatMap((result) =>
      result.status === 'rejected' ? [toError(result.reason)] : []
    );
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [...flattenFailure(error), ...cleanupFailures],
        'Stdio startup and cleanup failed'
      );
    }
    throw error;
  }
  return Object.freeze({
    close: createStdioAggregateClose(
      () => handle.close(),
      owned === undefined ? undefined : () => owned.close(),
      () => failures
    )
  });
}

export function startStdio(application?: ApplicationContext): Promise<StdioRuntime> {
  return startStdioWithDependencies(application, {}, DEFAULT_DEPENDENCIES);
}

export function startStdioWithOptions(
  application: ApplicationContext | undefined,
  options: InternalStdioOptions
): Promise<StdioRuntime> {
  return startStdioWithDependencies(application, options, DEFAULT_DEPENDENCIES);
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import { PassThrough } from 'node:stream';
import { createServer } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import { startStdioWithOptions } from '../../src/entrypoints/stdio.js';
import { createApplicationContext } from '../../src/app/application-context.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';
import {
  createAggregateClose,
  startHttp,
  startHttpWithDependencies,
  type HttpRuntimeDependencies
} from '../../src/http/runtime.js';
import { installStdioSignalHandlers } from '../../src/main.js';
import { installHttpSignalHandlers, startOwnedHttpEntrypoint } from '../../src/entrypoints/http.js';

function config(): RuntimeConfig {
  return {
    readOnly: true,
    allowedResourceScopes: null,
    enabledFeatureFlags: new Set(),
    requestStateKey: new TextEncoder().encode('0123456789abcdef0123456789abcdef'),
    http: {
      enabled: true,
      host: '127.0.0.1',
      port: 3000,
      allowedHosts: ['127.0.0.1'],
      allowedOrigins: [],
      legacySseEnabled: false,
      token: 'LIFECYCLE_SENTINEL_TOKEN_0123456789'
    }
  };
}

describe('owned lifecycle aggregation', () => {
  it('makes concurrent stdio close callers settle the same cleanup once', async () => {
    const transport = new StdioServerTransport(new PassThrough(), new PassThrough());
    const handle = await startStdioWithOptions(createApplicationContext(config()), { transport });
    const first = handle.close();
    const second = handle.close();
    expect(first).toBe(second);
    await first;
    await handle.close();
  });

  it('makes concurrent HTTP close callers settle handler and server exactly once', async () => {
    const runtime = await startHttp(createApplicationContext(config()), { port: 0 });
    const first = runtime.close();
    const second = runtime.close();
    expect(first).toBe(second);
    await first;
    await runtime.close();
  });

  it('retains every independent cleanup failure in one AggregateError', async () => {
    const handlerFailure = new Error('handler-close');
    const serverFailure = new Error('server-close');
    const handlerClose = vi.fn(() => Promise.reject(handlerFailure));
    const serverClose = vi.fn(() => Promise.reject(serverFailure));
    const applicationClose = vi.fn(() => Promise.resolve());
    const close = createAggregateClose([handlerClose, serverClose, applicationClose]);
    const first = close();
    const second = close();
    expect(first).toBe(second);
    const error = await first.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([handlerFailure, serverFailure]);
    expect(handlerClose).toHaveBeenCalledTimes(1);
    expect(serverClose).toHaveBeenCalledTimes(1);
    expect(applicationClose).toHaveBeenCalledTimes(1);
  });

  it.each(['createHandler', 'adaptHandler', 'createNodeServer'] as const)(
    'closes the handler after a %s construction failure whenever it exists',
    async (stage) => {
      const startupFailure = new Error(stage);
      const handlerClose = vi.fn(() => Promise.resolve());
      const handler = { close: handlerClose } as unknown as McpHttpHandler;
      const dependencies = {
        createHandler: () => {
          if (stage === 'createHandler') throw startupFailure;
          return handler;
        },
        adaptHandler: () => {
          if (stage === 'adaptHandler') throw startupFailure;
          return (() => Promise.resolve()) as never;
        },
        createNodeServer: () => {
          if (stage === 'createNodeServer') throw startupFailure;
          return createServer();
        },
        listen: () => Promise.reject(new Error('unexpected-listen'))
      } as unknown as HttpRuntimeDependencies;
      await expect(
        startHttpWithDependencies(createApplicationContext(config()), { port: 0 }, dependencies)
      ).rejects.toThrow(startupFailure);
      expect(handlerClose).toHaveBeenCalledTimes(stage === 'createHandler' ? 0 : 1);
    }
  );

  it('aggregates listen, handler-close, and server-close failures from partial HTTP startup', async () => {
    const startupFailure = new Error('listen');
    const handlerFailure = new Error('handler');
    const serverFailure = new Error('server');
    const handlerClose = vi.fn(() => Promise.reject(handlerFailure));
    const handler = { close: handlerClose } as unknown as McpHttpHandler;
    const server = createServer();
    const serverClose = vi.fn((callback?: (error?: Error) => void) => {
      queueMicrotask(() => callback?.(serverFailure));
      return server;
    });
    server.close = serverClose as typeof server.close;
    const dependencies = {
      createHandler: () => handler,
      adaptHandler: () => (() => Promise.resolve()) as never,
      createNodeServer: () => server,
      listen: () => Promise.reject(startupFailure)
    } as unknown as HttpRuntimeDependencies;
    const error = await startHttpWithDependencies(
      createApplicationContext(config()),
      { port: 0 },
      dependencies
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      startupFailure,
      handlerFailure,
      serverFailure
    ]);
    expect(handlerClose).toHaveBeenCalledTimes(1);
    expect(serverClose).toHaveBeenCalledTimes(1);
  });

  it('closes the owned default application when HTTP startup fails', async () => {
    const startupFailure = new Error('http-start');
    const applicationClose = vi.fn(() => Promise.resolve());
    await expect(
      startOwnedHttpEntrypoint({
        createDefaultRuntime: () => ({
          application: createApplicationContext(config()),
          close: applicationClose
        }),
        start: () => Promise.reject(startupFailure)
      })
    ).rejects.toThrow(startupFailure);
    expect(applicationClose).toHaveBeenCalledTimes(1);
  });

  it.each([installStdioSignalHandlers, installHttpSignalHandlers])(
    'awaits one aggregate shutdown across concurrent SIGINT and SIGTERM',
    async (install) => {
      let release: (() => void) | undefined;
      const operation = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      );
      const close = createAggregateClose([operation]);
      const listeners = new Map<string, () => void | Promise<void>>();
      const target = {
        exitCode: undefined,
        once: (signal: 'SIGINT' | 'SIGTERM', listener: () => void | Promise<void>) => {
          listeners.set(signal, listener);
        }
      };
      install({ close } as never, target);
      const first = listeners.get('SIGINT')?.();
      const second = listeners.get('SIGTERM')?.();
      expect(first).toBeInstanceOf(Promise);
      expect(second).toBeInstanceOf(Promise);
      expect(operation).toHaveBeenCalledTimes(1);
      let settled = false;
      void Promise.all([first, second]).then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      release?.();
      await Promise.all([first, second]);
      expect(settled).toBe(true);
      expect(target.exitCode).toBeUndefined();
    }
  );
});

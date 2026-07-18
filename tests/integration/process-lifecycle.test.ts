// SPDX-License-Identifier: AGPL-3.0-or-later
import { PassThrough } from 'node:stream';
import { createServer, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import { startStdioWithOptions } from '../../src/entrypoints/stdio.js';
import { createApplicationContext } from '../../src/app/application-context.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';
import {
  DEFAULT_HTTP_LIMITS,
  startHttp,
  startHttpWithDependencies,
  type HttpRuntimeDependencies
} from '../../src/http/runtime.js';
import { createPhasedClose } from '../../src/app/shutdown.js';
import { installStdioSignalHandlers, isDirectInvocation } from '../../src/main.js';
import { installHttpSignalHandlers, startOwnedHttpEntrypoint } from '../../src/entrypoints/http.js';

function config(legacySseEnabled = false): RuntimeConfig {
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
      legacySseEnabled,
      token: 'LIFECYCLE_SENTINEL_TOKEN_0123456789'
    }
  };
}

function controlledStdin(initiallyEnded = false) {
  let ended = initiallyEnded;
  let endListener: (() => void | Promise<void>) | undefined;
  return {
    input: {
      get readableEnded() {
        return ended;
      },
      once: (_event: 'end', listener: () => void | Promise<void>) => {
        endListener = listener;
      }
    },
    end: () => {
      ended = true;
      return endListener?.();
    }
  };
}

describe('owned lifecycle aggregation', () => {
  it('fails closed without diagnostics when direct-entry realpath resolution fails', async () => {
    const sentinel = '/DIRECT_ENTRY_PATH_MUST_NOT_LEAK';
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const canonicalize = vi.fn(() => Promise.reject(new Error(sentinel)));

    await expect(
      isDirectInvocation('file:///installed/dist/main.js', sentinel, canonicalize)
    ).resolves.toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('closes the owned stdio handle exactly once on stdin EOF', async () => {
    const stdin = controlledStdin();
    const close = vi.fn(() => Promise.resolve());
    const listeners = new Map<string, () => void | Promise<void>>();
    installStdioSignalHandlers(
      { close },
      {
        exitCode: undefined,
        once: (signal, listener) => {
          listeners.set(signal, listener);
        }
      },
      stdin.input
    );

    const first = stdin.end();
    const second = stdin.end();
    await Promise.all([first, second]);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('shares one failed stdio shutdown across EOF, SIGINT, and SIGTERM', async () => {
    const failure = new Error('STDIO_EOF_FAILURE_MUST_NOT_LEAK');
    let rejectClose: ((error: Error) => void) | undefined;
    const close = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectClose = reject;
        })
    );
    const stdin = controlledStdin();
    const listeners = new Map<string, () => void | Promise<void>>();
    const target = {
      exitCode: undefined as number | undefined,
      once: (signal: 'SIGINT' | 'SIGTERM', listener: () => void | Promise<void>) => {
        listeners.set(signal, listener);
      }
    };
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    installStdioSignalHandlers({ close }, target, stdin.input);

    const eof = stdin.end();
    const sigint = listeners.get('SIGINT')?.();
    const sigterm = listeners.get('SIGTERM')?.();
    expect(eof).toBe(sigint);
    expect(sigint).toBe(sigterm);
    expect(close).toHaveBeenCalledTimes(1);
    rejectClose?.(failure);
    await Promise.allSettled([eof, sigint, sigterm]);

    expect(write.mock.calls.flat().join('')).toBe('Error\n');
    expect(write.mock.calls.flat().join('')).not.toContain(failure.message);
    expect(target.exitCode).toBe(1);
  });

  it('closes stdio when EOF happened before lifecycle installation', async () => {
    const stdin = controlledStdin(true);
    const close = vi.fn(() => Promise.resolve());
    installStdioSignalHandlers(
      { close },
      { once: () => undefined, exitCode: undefined },
      stdin.input
    );

    await expect.poll(() => close.mock.calls.length).toBe(1);
  });

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

  it('rejects a pipelined keep-alive request submitted after HTTP close begins', async () => {
    let finishFirstRequest: (() => void) | undefined;
    let finishHandlerClose: (() => void) | undefined;
    let adapterCalls = 0;
    const nodeHandler = vi.fn((_request: unknown, response: ServerResponse) => {
      adapterCalls += 1;
      if (adapterCalls > 1) {
        response.writeHead(200, { 'content-length': '2', 'content-type': 'application/json' });
        response.end('{}');
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        finishFirstRequest = () => {
          if (response.headersSent) return;
          response.writeHead(200, { 'content-length': '2', 'content-type': 'application/json' });
          response.end('{}');
          resolve();
        };
      });
    });
    const handlerClose = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishHandlerClose = resolve;
        })
    );
    const dependencies = {
      createHandler: () => ({ close: handlerClose }),
      adaptHandler: () => nodeHandler,
      createNodeServer: (options: Parameters<typeof createServer>[0], listener: never) =>
        createServer(options, listener),
      listen: (server: ReturnType<typeof createServer>, port: number, host: string) =>
        new Promise<{ port: number }>((resolveAddress, rejectAddress) => {
          server.once('error', rejectAddress);
          server.listen(port, host, () => {
            const address = server.address();
            if (address === null || typeof address === 'string') {
              rejectAddress(new Error('Expected an HTTP test address'));
              return;
            }
            resolveAddress({ port: address.port });
          });
        })
    } as unknown as HttpRuntimeDependencies;
    const runtime = await startHttpWithDependencies(
      createApplicationContext(config()),
      { port: 0 },
      dependencies
    );
    const target = new URL(runtime.url);
    let socket: Socket | undefined;
    let closeSettlement: Promise<void> | undefined;
    let received = '';
    const requestText = [
      'POST /mcp HTTP/1.1',
      `Host: ${target.host}`,
      'Authorization: Bearer LIFECYCLE_SENTINEL_TOKEN_0123456789',
      'Accept: application/json',
      'Content-Type: application/json',
      'Content-Length: 2',
      'Connection: keep-alive',
      '',
      '{}'
    ].join('\r\n');
    try {
      socket = connect({ host: target.hostname, port: Number(target.port) });
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        received += chunk;
      });
      await new Promise<void>((resolveConnection, rejectConnection) => {
        socket?.once('connect', resolveConnection);
        socket?.once('error', rejectConnection);
      });
      socket.write(requestText);
      await expect.poll(() => nodeHandler.mock.calls.length).toBe(1);

      closeSettlement = runtime.close();
      await expect.poll(() => handlerClose.mock.calls.length).toBe(1);
      socket.write(requestText);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      finishFirstRequest?.();
      await expect
        .poll(() => received.match(/HTTP\/1\.1 [0-9]{3}/gu) ?? [], { timeout: 3_000 })
        .toHaveLength(2);
      finishHandlerClose?.();
      await closeSettlement;

      expect(received.match(/HTTP\/1\.1 [0-9]{3}/gu)).toEqual(['HTTP/1.1 200', 'HTTP/1.1 503']);
      expect(received).toContain('{"error":"server_shutting_down"}');
      expect(received).not.toContain('LIFECYCLE_SENTINEL_TOKEN_0123456789');
      expect(nodeHandler).toHaveBeenCalledTimes(1);
    } finally {
      finishFirstRequest?.();
      finishHandlerClose?.();
      socket?.destroy();
      await Promise.allSettled([closeSettlement ?? runtime.close()]);
    }
  });

  it('retains every independent cleanup failure in one AggregateError', async () => {
    const handlerFailure = new Error('handler-close');
    const serverFailure = new Error('server-close');
    const handlerClose = vi.fn(() => {
      throw handlerFailure;
    });
    const serverClose = vi.fn(() => Promise.reject(serverFailure));
    const applicationClose = vi.fn(() => Promise.resolve());
    const close = createPhasedClose([[handlerClose, serverClose, applicationClose]]);
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

  it('executes cleanup phases in order and still runs later phases after failures', async () => {
    const firstFailure = new Error('first-close');
    const secondFailure = new AggregateError([new Error('second-close')]);
    const thirdFailure = new Error('third-close');
    let rejectFirst: ((error: Error) => void) | undefined;
    let rejectSecond: ((error: AggregateError) => void) | undefined;
    const events: string[] = [];
    const close = createPhasedClose([
      [
        () => {
          events.push('first');
          return new Promise<void>((_resolve, reject) => {
            rejectFirst = reject;
          });
        }
      ],
      [
        () => {
          events.push('second-a');
          return Promise.resolve();
        },
        () => {
          events.push('second-b');
          return new Promise<void>((_resolve, reject) => {
            rejectSecond = reject;
          });
        }
      ],
      [
        () => {
          events.push('third');
          throw thirdFailure;
        }
      ]
    ]);

    const first = close();
    expect(close()).toBe(first);
    await expect.poll(() => events).toEqual(['first']);
    rejectFirst?.(firstFailure);
    await expect.poll(() => events).toEqual(['first', 'second-a', 'second-b']);
    rejectSecond?.(secondFailure);
    const error = await first.catch((reason: unknown) => reason);

    expect(events).toEqual(['first', 'second-a', 'second-b', 'third']);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      firstFailure,
      secondFailure.errors[0],
      thirdFailure
    ]);
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

  it('does not load the isolated compatibility module while legacy SSE is disabled', async () => {
    const startupFailure = new Error('node-construction');
    const handlerClose = vi.fn(() => Promise.resolve());
    const loadLegacySse = vi.fn();
    const dependencies = {
      createHandler: () => ({ close: handlerClose }),
      adaptHandler: () => (() => Promise.resolve()) as never,
      createNodeServer: () => {
        throw startupFailure;
      },
      listen: () => Promise.reject(new Error('unexpected-listen')),
      loadLegacySse
    } as unknown as HttpRuntimeDependencies;
    await expect(
      startHttpWithDependencies(createApplicationContext(config(false)), { port: 0 }, dependencies)
    ).rejects.toThrow(startupFailure);
    expect(loadLegacySse).not.toHaveBeenCalled();
    expect(handlerClose).toHaveBeenCalledTimes(1);
  });

  it('cleans up the beta handler when legacy loading or metadata mounting rejects', async () => {
    const loaderFailure = new Error('legacy-loader');
    const handlerClose = vi.fn(() => Promise.resolve());
    const dependencies = {
      createHandler: () => ({ close: handlerClose }),
      adaptHandler: () => (() => Promise.resolve()) as never,
      createNodeServer: () => createServer(),
      listen: () => Promise.reject(new Error('unexpected-listen')),
      loadLegacySse: () => Promise.reject(loaderFailure)
    } as unknown as HttpRuntimeDependencies;
    await expect(
      startHttpWithDependencies(createApplicationContext(config(true)), { port: 0 }, dependencies)
    ).rejects.toThrow(loaderFailure);
    expect(handlerClose).toHaveBeenCalledTimes(1);
  });

  it('does not construct a TCP listener when the compatibility mount rejects', async () => {
    const mountFailure = new Error('Legacy SSE capability schema is not representable');
    const handlerClose = vi.fn(() => Promise.resolve());
    const createNodeServer = vi.fn(() => createServer());
    const dependencies = {
      createHandler: () => ({ close: handlerClose }),
      adaptHandler: () => (() => Promise.resolve()) as never,
      createNodeServer,
      listen: () => Promise.reject(new Error('unexpected-listen')),
      loadLegacySse: () =>
        Promise.resolve({
          mountLegacySseCompatibility: () => {
            throw mountFailure;
          }
        })
    } as unknown as HttpRuntimeDependencies;
    const error = await startHttpWithDependencies(
      createApplicationContext(config(true)),
      { port: 0 },
      dependencies
    ).catch((reason: unknown) => reason);
    expect(error).toBe(mountFailure);
    expect(createNodeServer).not.toHaveBeenCalled();
    expect(handlerClose).toHaveBeenCalledTimes(1);
  });

  it('closes mounted legacy and beta owners when Node construction throws before listen', async () => {
    const startupFailure = new Error('node-construction-after-legacy-mount');
    const legacyClose = vi.fn(() => Promise.resolve());
    const handlerClose = vi.fn(() => Promise.resolve());
    const listen = vi.fn(() => Promise.reject(new Error('unexpected-listen')));
    const dependencies = {
      createHandler: () => ({ close: handlerClose }),
      adaptHandler: () => (() => Promise.resolve()) as never,
      createNodeServer: () => {
        throw startupFailure;
      },
      listen,
      loadLegacySse: () =>
        Promise.resolve({
          mountLegacySseCompatibility: () => ({ close: legacyClose })
        })
    } as unknown as HttpRuntimeDependencies;

    await expect(
      startHttpWithDependencies(createApplicationContext(config(true)), { port: 0 }, dependencies)
    ).rejects.toThrow(startupFailure);
    expect(legacyClose).toHaveBeenCalledTimes(1);
    expect(handlerClose).toHaveBeenCalledTimes(1);
    expect(listen).not.toHaveBeenCalled();
  });

  it('settles legacy, beta, and Node cleanup in deterministic order after legacy mounting', async () => {
    const legacyFailure = new Error('legacy-close');
    const handlerFailure = new Error('handler-close');
    const serverFailure = new Error('server-close');
    const legacyClose = vi.fn(() => {
      throw legacyFailure;
    });
    let rejectHandler: ((error: Error) => void) | undefined;
    const handlerClose = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectHandler = reject;
        })
    );
    let finishServer: ((error?: Error) => void) | undefined;
    const server = {
      maxRequestsPerSocket: 0,
      close: vi.fn((callback: (error?: Error) => void) => {
        finishServer = callback;
      }),
      closeAllConnections: vi.fn(() => finishServer?.(serverFailure))
    };
    const dependencies = {
      createHandler: () => ({ close: handlerClose }),
      adaptHandler: () => (() => Promise.resolve()) as never,
      createNodeServer: () => server,
      listen: () => Promise.resolve({ port: 12345 }),
      loadLegacySse: () =>
        Promise.resolve({
          mountLegacySseCompatibility: () => ({ close: legacyClose })
        })
    } as unknown as HttpRuntimeDependencies;
    const runtime = await startHttpWithDependencies(
      createApplicationContext(config(true)),
      { port: 0 },
      dependencies
    );
    const first = runtime.close();
    const second = runtime.close();
    expect(first).toBe(second);
    await expect.poll(() => server.close.mock.calls.length).toBe(1);
    await expect.poll(() => handlerClose.mock.calls.length).toBe(1);
    expect(legacyClose).toHaveBeenCalledTimes(1);
    expect(server.closeAllConnections).not.toHaveBeenCalled();
    rejectHandler?.(handlerFailure);
    const error = await first.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      handlerFailure,
      legacyFailure,
      serverFailure
    ]);
    expect(legacyClose).toHaveBeenCalledTimes(1);
    expect(handlerClose).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
  });

  it('closes owned HTTP before the application and continues after an HTTP failure', async () => {
    const httpFailure = new Error('http-close');
    let rejectHttp: ((error: Error) => void) | undefined;
    const httpClose = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectHttp = reject;
        })
    );
    const applicationClose = vi.fn(() => Promise.resolve());
    const runtime = await startOwnedHttpEntrypoint({
      createDefaultRuntime: () => ({
        application: createApplicationContext(config()),
        close: applicationClose
      }),
      start: () =>
        Promise.resolve({
          url: 'http://127.0.0.1:3000/mcp',
          limits: DEFAULT_HTTP_LIMITS,
          close: httpClose
        })
    });

    const first = runtime.close();
    expect(runtime.close()).toBe(first);
    await expect.poll(() => httpClose.mock.calls.length).toBe(1);
    expect(applicationClose).not.toHaveBeenCalled();
    rejectHttp?.(httpFailure);
    const error = await first.catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([httpFailure]);
    expect(applicationClose).toHaveBeenCalledTimes(1);
  });

  it('cleans legacy, beta, and Node owners after a post-mount listen failure', async () => {
    const startupFailure = new Error('listen');
    const legacyFailure = new Error('legacy-close');
    const handlerFailure = new Error('handler-close');
    const serverFailure = new Error('server-close');
    const legacyClose = vi.fn(() => {
      throw legacyFailure;
    });
    const handlerClose = vi.fn(() => Promise.reject(handlerFailure));
    const server = {
      maxRequestsPerSocket: 0,
      close: vi.fn((callback: (error?: Error) => void) => {
        callback(serverFailure);
      })
    };
    const dependencies = {
      createHandler: () => ({ close: handlerClose }),
      adaptHandler: () => (() => Promise.resolve()) as never,
      createNodeServer: () => server,
      listen: () => Promise.reject(startupFailure),
      loadLegacySse: () =>
        Promise.resolve({
          mountLegacySseCompatibility: () => ({ close: legacyClose })
        })
    } as unknown as HttpRuntimeDependencies;
    const error = await startHttpWithDependencies(
      createApplicationContext(config(true)),
      { port: 0 },
      dependencies
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      startupFailure,
      handlerFailure,
      legacyFailure,
      serverFailure
    ]);
    expect(legacyClose).toHaveBeenCalledTimes(1);
    expect(handlerClose).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it('aggregates listen, handler-close, and server-close failures from partial HTTP startup', async () => {
    const startupFailure = new Error('listen');
    const handlerFailure = new Error('handler');
    const serverFailure = new Error('server');
    const handlerClose = vi.fn(() => {
      throw handlerFailure;
    });
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
    const cleanupFailure = new Error('application-close');
    const applicationClose = vi.fn(() => {
      throw cleanupFailure;
    });
    const error = await startOwnedHttpEntrypoint({
      createDefaultRuntime: () => ({
        application: createApplicationContext(config()),
        close: applicationClose
      }),
      start: () => Promise.reject(startupFailure)
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([startupFailure, cleanupFailure]);
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
      const close = createPhasedClose([[operation]]);
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
      expect(second).toBe(first);
      await Promise.resolve();
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

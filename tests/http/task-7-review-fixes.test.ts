// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type RequestListener,
  type Server,
  type ServerResponse
} from 'node:http';
import { createConnection, type Socket } from 'node:net';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildApplicationHttpSecurity,
  createApplicationContext
} from '../../src/app/application-context.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';
import { createLocalBearerAuthentication } from '../../src/http/auth.js';
import { DEFAULT_HTTP_LIMITS, resolveHttpLimits, type HttpLimits } from '../../src/http/limits.js';
import {
  buildHttpExpressApplication,
  startHttp,
  type HttpRuntime
} from '../../src/http/runtime.js';

const TOKEN = 'HTTP_REVIEW_SENTINEL_TOKEN_MUST_NEVER_LEAK_0123456789';
const MAX_TIMER_DELAY = 2_147_483_647;
const runtimes = new Set<HttpRuntime>();

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
      token: TOKEN
    }
  };
}

async function listen(application: RequestListener): Promise<{ server: Server; url: URL }> {
  const server = createServer(application);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected TCP address');
  return { server, url: new URL(`http://127.0.0.1:${String(address.port)}/mcp`) };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

interface RawExchangeOptions {
  readonly method: string;
  readonly headers: OutgoingHttpHeaders | readonly string[];
  readonly chunks?: readonly (string | Buffer)[];
  readonly end?: boolean;
}

async function rawExchange(
  url: URL,
  options: RawExchangeOptions
): Promise<{ readonly status: number; readonly body: string }> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: options.method,
        headers: options.headers
      },
      (response) => {
        const chunks: Buffer[] = [];
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8')
          });
        };
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('end', finish);
        response.once('close', finish);
      }
    );
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    for (const chunk of options.chunks ?? []) request.write(chunk);
    if (options.end !== false) request.end();
    else request.flushHeaders();
  });
}

function fakeClock() {
  const scheduled: {
    readonly callback: () => void;
    readonly milliseconds: number;
    cleared: boolean;
  }[] = [];
  return {
    scheduled,
    clock: {
      set: (callback: () => void, milliseconds: number) => {
        const timer = { callback, milliseconds, cleared: false };
        scheduled.push(timer);
        return timer as never;
      },
      clear: (handle: { cleared: boolean }) => {
        handle.cleared = true;
      }
    }
  };
}

function beginPost(url: URL): {
  readonly request: ReturnType<typeof httpRequest>;
  readonly response: Promise<IncomingMessage>;
  readonly closed: Promise<void>;
  readonly requestFailed: () => boolean;
} {
  let resolveResponse: (response: IncomingMessage) => void;
  const response = new Promise<IncomingMessage>((resolve) => {
    resolveResponse = resolve;
  });
  let resolveClosed: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const body = '{}';
  let failed = false;
  const request = httpRequest(
    url,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body))
      }
    },
    (incoming) => {
      resolveResponse(incoming);
      incoming.once('close', resolveClosed);
      incoming.once('end', resolveClosed);
    }
  );
  request.once('error', () => {
    failed = true;
    resolveClosed();
  });
  request.end(body);
  return { request, response, closed, requestFailed: () => failed };
}

afterEach(async () => {
  await Promise.allSettled([...runtimes].map((runtime) => runtime.close()));
  runtimes.clear();
});

describe('reviewed HTTP limit validation', () => {
  it.each([
    'bodyReceiptTimeoutMs',
    'executionTimeoutMs',
    'streamLifetimeMs',
    'headersTimeoutMs',
    'keepAliveTimeoutMs'
  ] as const)('accepts the Node timer maximum and rejects maximum + 1 for %s', (name) => {
    expect(resolveHttpLimits({ [name]: MAX_TIMER_DELAY })).toMatchObject({
      [name]: MAX_TIMER_DELAY
    });
    expect(() => resolveHttpLimits({ [name]: MAX_TIMER_DELAY + 1 })).toThrow(new RegExp(name, 'u'));
  });

  it('does not apply the timer maximum to non-timer integer limits', () => {
    expect(resolveHttpLimits({ bodyBytes: MAX_TIMER_DELAY + 1 }).bodyBytes).toBe(
      MAX_TIMER_DELAY + 1
    );
  });
});

describe('all-method body boundary', () => {
  it('bounds and validates every body before auth and adapter while preserving bodyless GET/DELETE', async () => {
    const original = buildApplicationHttpSecurity(createApplicationContext(config()));
    let authCalls = 0;
    let adapterCalls = 0;
    const parsedBodies: unknown[] = [];
    const security = {
      ...original,
      authenticate: ((request, response, next) => {
        authCalls += 1;
        original.authenticate(request, response, next);
      }) satisfies typeof original.authenticate
    };
    const adapter = vi.fn((request: { readonly body?: unknown }, response: ServerResponse) => {
      adapterCalls += 1;
      parsedBodies.push(request.body);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
      return Promise.resolve();
    });
    const limits: HttpLimits = Object.freeze({
      ...DEFAULT_HTTP_LIMITS,
      bodyReceiptTimeoutMs: 30
    });
    const running = await listen(buildHttpExpressApplication(security, limits, adapter as never));
    const baseHeaders = {
      host: running.url.host,
      authorization: `Bearer ${TOKEN}`
    };
    const expectRejectedBeforeBoundaries = async (
      expectedStatus: number,
      options: RawExchangeOptions
    ) => {
      const beforeAuth = authCalls;
      const beforeAdapter = adapterCalls;
      expect((await rawExchange(running.url, options)).status).toBe(expectedStatus);
      expect(authCalls).toBe(beforeAuth);
      expect(adapterCalls).toBe(beforeAdapter);
    };

    try {
      await expectRejectedBeforeBoundaries(415, {
        method: 'PATCH',
        headers: {
          ...baseHeaders,
          'content-type': 'text/plain',
          'content-length': '2'
        },
        chunks: ['{}']
      });
      await expectRejectedBeforeBoundaries(413, {
        method: 'DELETE',
        headers: {
          ...baseHeaders,
          'content-type': 'application/json',
          'transfer-encoding': 'chunked'
        },
        chunks: [Buffer.alloc(DEFAULT_HTTP_LIMITS.bodyBytes), Buffer.from('x')]
      });
      await expectRejectedBeforeBoundaries(408, {
        method: 'PUT',
        headers: {
          ...baseHeaders,
          'content-type': 'application/json',
          'content-length': '10'
        },
        chunks: ['{'],
        end: false
      });
      await expectRejectedBeforeBoundaries(413, {
        method: 'DELETE',
        headers: {
          ...baseHeaders,
          'content-type': 'application/json',
          'content-length': String(DEFAULT_HTTP_LIMITS.bodyBytes + 1)
        },
        end: false
      });
      for (const method of ['GET', 'HEAD']) {
        await expectRejectedBeforeBoundaries(400, {
          method,
          headers: {
            ...baseHeaders,
            'content-type': 'application/json',
            'content-length': '2'
          },
          chunks: ['{}']
        });
      }

      expect(
        (
          await rawExchange(running.url, {
            method: 'PUT',
            headers: {
              ...baseHeaders,
              'content-type': 'application/json',
              'content-length': '2'
            },
            chunks: ['{}']
          })
        ).status
      ).toBe(200);
      for (const method of ['GET', 'DELETE']) {
        expect((await rawExchange(running.url, { method, headers: baseHeaders })).status).toBe(200);
      }
      expect(authCalls).toBe(3);
      expect(adapterCalls).toBe(3);
      expect(parsedBodies[0]).toEqual({});
    } finally {
      await closeServer(running.server);
    }
  });
});

describe('effective header deadline', () => {
  it('closes a real socket with incomplete headers on a short injected bound', async () => {
    const runtime = await startHttp(createApplicationContext(config()), {
      port: 0,
      limits: { headersTimeoutMs: 30 }
    });
    runtimes.add(runtime);
    const target = new URL(runtime.url);
    let socket: Socket | undefined;
    try {
      socket = createConnection({ host: target.hostname, port: Number(target.port) });
      await new Promise<void>((resolve, reject) => {
        socket?.once('connect', resolve);
        socket?.once('error', reject);
      });
      socket.write(`POST /mcp HTTP/1.1\r\nHost: ${target.host}\r\nAuthorization: Bearer`);
      socket.resume();
      const closed = await Promise.race([
        new Promise<boolean>((resolve) => {
          socket?.once('close', () => {
            resolve(true);
          });
        }),
        new Promise<boolean>((resolve) => {
          setTimeout(() => {
            resolve(false);
          }, 750);
        })
      ]);
      expect(closed).toBe(true);
    } finally {
      socket?.destroy();
    }
  });
});

describe('closed bearer projection', () => {
  it('rejects duplicate and comma-joined Authorization before the adapter', async () => {
    const security = buildApplicationHttpSecurity(createApplicationContext(config()));
    let adapterCalls = 0;
    const adapter = (_request: unknown, response: ServerResponse) => {
      adapterCalls += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
      return Promise.resolve();
    };
    const running = await listen(
      buildHttpExpressApplication(security, DEFAULT_HTTP_LIMITS, adapter as never)
    );
    const bodyHeaders = [
      'Host',
      running.url.host,
      'Content-Type',
      'application/json',
      'Content-Length',
      '2'
    ];
    try {
      expect(
        (
          await rawExchange(running.url, {
            method: 'POST',
            headers: [
              ...bodyHeaders,
              'Authorization',
              `Bearer ${TOKEN}`,
              'Authorization',
              'Bearer conflicting-token'
            ],
            chunks: ['{}']
          })
        ).status
      ).toBe(401);
      expect(
        (
          await rawExchange(running.url, {
            method: 'POST',
            headers: {
              host: running.url.host,
              authorization: `Bearer ${TOKEN}, Bearer conflicting-token`,
              'content-type': 'application/json',
              'content-length': '2'
            },
            chunks: ['{}']
          })
        ).status
      ).toBe(401);
      expect(adapterCalls).toBe(0);
    } finally {
      await closeServer(running.server);
    }
  });

  it('removes the wire credential from every request header view but keeps exact AuthInfo', async () => {
    const security = buildApplicationHttpSecurity(createApplicationContext(config()));
    let observed:
      | {
          readonly auth: unknown;
          readonly headers: IncomingHttpHeaders;
          readonly rawHeaders: readonly string[];
          readonly headersDistinct: Readonly<Record<string, readonly string[] | undefined>>;
        }
      | undefined;
    const adapter = (
      request: IncomingMessage & { readonly auth?: unknown },
      response: ServerResponse
    ) => {
      observed = {
        auth: request.auth,
        headers: { ...request.headers },
        rawHeaders: [...request.rawHeaders],
        headersDistinct: { ...request.headersDistinct }
      };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
      return Promise.resolve();
    };
    const running = await listen(
      buildHttpExpressApplication(security, DEFAULT_HTTP_LIMITS, adapter as never)
    );
    try {
      expect(
        (
          await rawExchange(running.url, {
            method: 'POST',
            headers: {
              host: running.url.host,
              authorization: `Bearer ${TOKEN}`,
              'content-type': 'application/json',
              'content-length': '2'
            },
            chunks: ['{}']
          })
        ).status
      ).toBe(200);
      expect(observed?.auth).toEqual({
        token: TOKEN,
        clientId: 'http:local-bearer',
        scopes: []
      });
      expect(observed?.headers.authorization).toBeUndefined();
      expect(observed?.headersDistinct.authorization).toBeUndefined();
      expect(observed?.rawHeaders.some((value) => /authorization|bearer/iu.test(value))).toBe(
        false
      );
    } finally {
      await closeServer(running.server);
    }
  });

  it('always compares fixed SHA-256 digests for missing, malformed, wrong, and correct input', () => {
    const digest = vi.fn((value: string) => createHash('sha256').update(value, 'utf8').digest());
    const equals = vi.fn((left: Uint8Array, right: Uint8Array) =>
      Buffer.from(left).equals(Buffer.from(right))
    );
    const createWithCrypto = createLocalBearerAuthentication as unknown as (
      token: string,
      crypto: {
        readonly sha256: (value: string) => Uint8Array;
        readonly timingSafeEqual: (left: Uint8Array, right: Uint8Array) => boolean;
      }
    ) => ReturnType<typeof createLocalBearerAuthentication>;
    const middleware = createWithCrypto(TOKEN, { sha256: digest, timingSafeEqual: equals });

    for (const authorization of [undefined, 'Basic abc', 'Bearer wrong-token', `Bearer ${TOKEN}`]) {
      const response = {
        status: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      };
      middleware(
        {
          headers: authorization === undefined ? {} : { authorization },
          rawHeaders: authorization === undefined ? [] : ['Authorization', authorization],
          headersDistinct: authorization === undefined ? {} : { authorization: [authorization] }
        } as never,
        response as never,
        vi.fn()
      );
    }

    expect(equals).toHaveBeenCalledTimes(4);
    for (const [left, right] of equals.mock.calls) {
      expect(left).toHaveLength(32);
      expect(right).toHaveLength(32);
    }
  });
});

describe('real adapter deadline boundary', () => {
  it('connects an unresolved real toNodeHandler request before firing the ordinary deadline', async () => {
    let markConnected: (() => void) | undefined;
    const connected = new Promise<void>((resolve) => {
      markConnected = resolve;
    });
    const handler = {
      fetch: vi.fn(() => {
        markConnected?.();
        return new Promise<Response>(() => undefined);
      })
    } as unknown as McpHttpHandler;
    const timers = fakeClock();
    const running = await listen(
      buildHttpExpressApplication(
        buildApplicationHttpSecurity(createApplicationContext(config())),
        DEFAULT_HTTP_LIMITS,
        toNodeHandler(handler),
        timers.clock as never
      )
    );
    const exchange = beginPost(running.url);
    try {
      await connected;
      expect(timers.scheduled.map(({ milliseconds }) => milliseconds)).toEqual([30_000]);
      timers.scheduled[0]?.callback();
      await exchange.closed;
      expect(exchange.requestFailed()).toBe(true);
    } finally {
      exchange.request.destroy();
      await closeServer(running.server);
    }
  });

  it('promotes a real SSE Response once, ignores keepalives, and closes at the absolute deadline', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const handler = {
      fetch: vi.fn(() =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(streamController) {
                controller = streamController;
                streamController.enqueue(new TextEncoder().encode(': primed\n\n'));
              }
            }),
            { headers: { 'content-type': 'text/event-stream' } }
          )
        )
      )
    } as unknown as McpHttpHandler;
    const timers = fakeClock();
    const running = await listen(
      buildHttpExpressApplication(
        buildApplicationHttpSecurity(createApplicationContext(config())),
        DEFAULT_HTTP_LIMITS,
        toNodeHandler(handler),
        timers.clock as never
      )
    );
    const exchange = beginPost(running.url);
    try {
      const response = await exchange.response;
      await new Promise<void>((resolve) => {
        response.once('data', () => {
          resolve();
        });
      });
      expect(timers.scheduled.map(({ milliseconds }) => milliseconds)).toEqual([30_000, 300_000]);
      expect(timers.scheduled[0]?.cleared).toBe(true);
      controller?.enqueue(new TextEncoder().encode(': keepalive\n\n'));
      controller?.enqueue(new TextEncoder().encode(': keepalive\n\n'));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(timers.scheduled).toHaveLength(2);
      timers.scheduled[1]?.callback();
      await exchange.closed;
      expect(exchange.request.destroyed).toBe(true);
    } finally {
      exchange.request.destroy();
      await closeServer(running.server);
    }
  });

  it('clears the ordinary deadline when a real JSON response finishes', async () => {
    const handler = {
      fetch: vi.fn(() =>
        Promise.resolve(Response.json({ jsonrpc: '2.0', id: 1, result: { ok: true } }))
      )
    } as unknown as McpHttpHandler;
    const timers = fakeClock();
    const running = await listen(
      buildHttpExpressApplication(
        buildApplicationHttpSecurity(createApplicationContext(config())),
        DEFAULT_HTTP_LIMITS,
        toNodeHandler(handler),
        timers.clock as never
      )
    );
    const exchange = beginPost(running.url);
    try {
      const response = await exchange.response;
      response.resume();
      await exchange.closed;
      expect(timers.scheduled.map(({ milliseconds }) => milliseconds)).toEqual([30_000]);
      expect(timers.scheduled[0]?.cleared).toBe(true);
    } finally {
      exchange.request.destroy();
      await closeServer(running.server);
    }
  });
});

it('enforces 16 real modern subscriptions, rejects pre-ack, and admits a replacement', async () => {
  const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const runtime = await startHttp(createApplicationContext(config()), { port: 0 });
  runtimes.add(runtime);
  const transport = new StreamableHTTPClientTransport(new URL(runtime.url), {
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${TOKEN}`);
      return fetch(input, { ...init, headers });
    }
  });
  const client = new Client(
    { name: 'subscription-limit-review', version: '0.1.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } }
  );
  const subscriptions: Awaited<ReturnType<Client['listen']>>[] = [];
  try {
    await client.connect(transport);
    for (let index = 0; index < 16; index += 1) {
      subscriptions.push(await client.listen({ toolsListChanged: true }));
    }
    await expect(client.listen({ toolsListChanged: true })).rejects.toThrow(
      /Subscription limit reached/u
    );
    expect(write.mock.calls.flat().join('')).toBe('Error\n');
    expect(write.mock.calls.flat().join('')).not.toContain(TOKEN);

    const [first] = subscriptions.splice(0, 1);
    await first?.close();
    await first?.closed;
    subscriptions.push(await client.listen({ toolsListChanged: true }));
    expect(subscriptions).toHaveLength(16);
  } finally {
    await Promise.allSettled(subscriptions.map((subscription) => subscription.close()));
    await Promise.allSettled([client.close(), transport.close()]);
  }
});

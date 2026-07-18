// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  createServer,
  request as httpRequest,
  Agent,
  type RequestListener,
  type Server
} from 'node:http';
import { EventEmitter } from 'node:events';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildApplicationHttpSecurity,
  createApplicationContext
} from '../../src/app/application-context.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';
import { DEFAULT_HTTP_LIMITS } from '../../src/http/limits.js';
import {
  buildHttpExpressApplication,
  startHttp,
  startHttpWithDependencies,
  withResponseDeadline,
  type HttpRuntimeDependencies,
  type HttpRuntime
} from '../../src/http/runtime.js';

const TOKEN = 'HTTP_SENTINEL_TOKEN_MUST_NEVER_LEAK_0123456789';
const ORIGIN = 'http://localhost:4321';
const runtimes = new Set<HttpRuntime>();

function config(overrides: Partial<RuntimeConfig['http']> = {}): RuntimeConfig {
  return {
    readOnly: true,
    allowedResourceScopes: null,
    enabledFeatureFlags: new Set(),
    requestStateKey: new TextEncoder().encode('0123456789abcdef0123456789abcdef'),
    http: {
      enabled: true,
      host: '127.0.0.1',
      port: 3000,
      allowedHosts: ['127.0.0.1', 'localhost'],
      allowedOrigins: [ORIGIN],
      legacySseEnabled: false,
      token: TOKEN,
      ...overrides
    }
  };
}

async function start(overrides: Partial<RuntimeConfig['http']> = {}) {
  const runtime = await startHttp(createApplicationContext(config(overrides)), { port: 0 });
  runtimes.add(runtime);
  return runtime;
}

afterEach(async () => {
  await Promise.allSettled([...runtimes].map((runtime) => runtime.close()));
  runtimes.clear();
});

function request(runtime: HttpRuntime, init: RequestInit = {}, token = TOKEN): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  headers.set('accept', 'application/json, text/event-stream');
  if (token !== '') headers.set('authorization', `Bearer ${token}`);
  return fetch(runtime.url, {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    ...init,
    headers
  });
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

async function rawPost(
  url: URL,
  headers: Record<string, string>,
  body: string,
  agent?: Agent
): Promise<{ status: number; body: string; headers: Headers }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers,
        ...(agent === undefined ? {} : { agent })
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: new Headers(
              Object.entries(response.headers).flatMap(([name, value]) =>
                typeof value === 'string' ? [[name, value] as [string, string]] : []
              )
            )
          });
        });
      }
    );
    request.on('error', reject);
    request.end(body);
  });
}

async function rawHeadersOnly(url: URL, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers
      },
      (response) => {
        response.resume();
        response.once('end', () => {
          resolve(response.statusCode ?? 0);
        });
      }
    );
    request.once('error', (error) => {
      if (!request.destroyed) reject(error);
    });
    request.flushHeaders();
  });
}

describe('hardened HTTP construction', () => {
  it('is disabled by default and permits only loopback application hosts', async () => {
    await expect(
      startHttp(createApplicationContext(config({ enabled: false })), { port: 0 })
    ).rejects.toThrow(/disabled/iu);
    await expect(
      startHttp(createApplicationContext(config({ host: '127.0.0.1' })), { port: 1 })
    ).rejects.toThrow(/port/iu);
    const localhost = await startHttp(
      createApplicationContext(config({ host: 'localhost', allowedHosts: ['localhost'] })),
      { port: 0 }
    );
    await localhost.close();
    for (const unsafeHost of ['0.0.0.0', '::', 'firewall.example']) {
      const unsafe = config() as unknown as { http: Record<string, unknown> };
      unsafe.http.host = unsafeHost;
      await expect(
        startHttp(createApplicationContext(unsafe as unknown as RuntimeConfig), { port: 0 })
      ).rejects.toThrow();
    }
  });

  it('publishes and freezes the exact owned limits and validates overrides', async () => {
    expect(DEFAULT_HTTP_LIMITS).toEqual({
      bodyBytes: 256 * 1024,
      maxConcurrentRequests: 32,
      maxSubscriptions: 16,
      bodyReceiptTimeoutMs: 10_000,
      executionTimeoutMs: 30_000,
      streamLifetimeMs: 5 * 60_000,
      headersTimeoutMs: 5_000,
      keepAliveTimeoutMs: 5_000,
      maxRequestsPerSocket: 100
    });
    expect(Object.isFrozen(DEFAULT_HTTP_LIMITS)).toBe(true);
    const runtime = await start();
    expect(runtime.limits).toEqual(DEFAULT_HTTP_LIMITS);
    expect(Object.isFrozen(runtime.limits)).toBe(true);
    await expect(
      startHttp(createApplicationContext(config()), {
        port: 0,
        limits: { maxConcurrentRequests: 0 }
      })
    ).rejects.toThrow(/maxConcurrentRequests/u);
  });
});

describe('HTTP guard order and secret handling', () => {
  it('rejects missing and wrong bearer credentials with 401 before MCP dispatch', async () => {
    const runtime = await start();
    for (const token of ['', 'wrong-token']) {
      const response = await request(runtime, {}, token);
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(TOKEN);
    }
  });

  it('proves Host, Origin, and every body guard run before auth and adapter boundaries', async () => {
    const original = buildApplicationHttpSecurity(createApplicationContext(config()));
    let authCalls = 0;
    let adapterCalls = 0;
    let observedAuth: unknown;
    const security = {
      ...original,
      authenticate: ((requestValue, responseValue, nextValue) => {
        authCalls += 1;
        original.authenticate(requestValue, responseValue, nextValue);
      }) satisfies typeof original.authenticate
    };
    const adapter = vi.fn((incoming: { readonly auth?: unknown }, response: never) => {
      adapterCalls += 1;
      observedAuth = incoming.auth;
      const outgoing = response as unknown as {
        writeHead(status: number, headers: Record<string, string>): void;
        end(body: string): void;
      };
      outgoing.writeHead(200, { 'content-type': 'application/json' });
      outgoing.end('{}');
      return Promise.resolve();
    });
    const limits = Object.freeze({
      ...DEFAULT_HTTP_LIMITS,
      bodyBytes: 16,
      bodyReceiptTimeoutMs: 25
    });
    const running = await listen(buildHttpExpressApplication(security, limits, adapter as never));
    try {
      const baseHeaders = {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        'content-length': '2'
      };
      expect(
        (await rawPost(running.url, { ...baseHeaders, host: 'foreign.example' }, '{}')).status
      ).toBe(403);
      expect(
        (
          await rawPost(
            running.url,
            { ...baseHeaders, host: running.url.host, origin: 'https://foreign.example' },
            '{}'
          )
        ).status
      ).toBe(403);
      expect(
        (
          await rawPost(
            running.url,
            {
              host: running.url.host,
              authorization: `Bearer ${TOKEN}`,
              'content-type': 'text/plain',
              'content-length': '32'
            },
            'x'.repeat(32)
          )
        ).status
      ).toBe(413);
      expect(authCalls).toBe(0);
      expect(adapterCalls).toBe(0);

      expect(
        await rawHeadersOnly(running.url, {
          host: running.url.host,
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'content-length': '32'
        })
      ).toBe(413);
      expect(
        await rawHeadersOnly(running.url, {
          host: running.url.host,
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'text/plain',
          'content-length': '2'
        })
      ).toBe(415);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(authCalls).toBe(0);
      expect(adapterCalls).toBe(0);

      const valid = await rawPost(running.url, { ...baseHeaders, host: running.url.host }, '{}');
      expect(valid.status).toBe(200);
      expect(authCalls).toBe(1);
      expect(adapterCalls).toBe(1);
      expect(observedAuth).toEqual({
        token: TOKEN,
        clientId: 'http:local-bearer',
        scopes: []
      });
      expect(JSON.stringify(valid)).not.toContain(TOKEN);
    } finally {
      await new Promise<void>((resolve, reject) => {
        running.server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
    }
  });

  it('turns adapter rejection into a generic 500 and logs only the error name', async () => {
    const original = buildApplicationHttpSecurity(createApplicationContext(config()));
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const adapterFailure = new Error(TOKEN);
    const running = await listen(
      buildHttpExpressApplication(original, DEFAULT_HTTP_LIMITS, (() =>
        Promise.reject(adapterFailure)) as never)
    );
    try {
      const response = await rawPost(
        running.url,
        {
          host: running.url.host,
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'content-length': '2'
        },
        '{}'
      );
      expect(response.status).toBe(500);
      expect(response.body).toBe(JSON.stringify({ error: 'internal_server_error' }));
      expect(JSON.stringify(response.headers)).not.toContain(TOKEN);
      expect(write.mock.calls.flat().join('')).toBe('Error\n');
    } finally {
      await new Promise<void>((resolve, reject) => {
        running.server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
    }
  });

  it('runs exact Host and Origin rejection before bearer authentication', async () => {
    const runtime = await start();
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    const foreignHost = await rawPost(
      new URL(runtime.url),
      {
        host: 'foreign.example',
        authorization: 'Bearer wrong',
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body))
      },
      body
    );
    expect(foreignHost.status).toBe(403);

    const absent = await request(runtime);
    expect(absent.status).toBe(200);

    const allowed = await request(runtime, { headers: { origin: ORIGIN } });
    expect(allowed.status).toBe(200);

    for (const origin of [
      'https://localhost:4321',
      'http://localhost',
      'http://localhost:4322',
      'http://127.0.0.1:4321',
      'null',
      'file://opaque',
      'not an origin',
      `${ORIGIN}, ${ORIGIN}`
    ]) {
      const response = await request(runtime, { headers: { origin } }, 'wrong');
      expect(response.status, origin).toBe(403);
      expect(await response.text()).not.toContain(TOKEN);
    }
  });

  it('rejects duplicate Origin header lines before authentication', async () => {
    const runtime = await start();
    const target = new URL(runtime.url);
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: target.hostname,
          port: target.port,
          path: target.pathname,
          method: 'POST',
          headers: [
            'Host',
            target.host,
            'Origin',
            ORIGIN,
            'Origin',
            ORIGIN,
            'Authorization',
            'Bearer wrong',
            'Content-Type',
            'application/json',
            'Content-Length',
            '2'
          ]
        },
        (response) => {
          response.resume();
          response.on('end', () => {
            resolve(response.statusCode ?? 0);
          });
        }
      );
      req.on('error', reject);
      req.end('{}');
    });
    expect(status).toBe(403);
  });

  it('rejects an oversized body before authentication and times out incomplete bodies', async () => {
    const runtime = await start();
    const oversized = await request(
      runtime,
      { body: JSON.stringify({ payload: 'x'.repeat(DEFAULT_HTTP_LIMITS.bodyBytes) }) },
      'wrong'
    );
    expect(oversized.status).toBe(413);

    const shortRuntime = await startHttp(createApplicationContext(config()), {
      port: 0,
      limits: { bodyReceiptTimeoutMs: 25 }
    });
    runtimes.add(shortRuntime);
    const target = new URL(shortRuntime.url);
    const slowStatus = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: target.hostname,
          port: target.port,
          path: target.pathname,
          method: 'POST',
          headers: {
            authorization: 'Bearer wrong',
            'content-type': 'application/json',
            'content-length': '100'
          }
        },
        (response) => {
          response.resume();
          response.on('end', () => {
            resolve(response.statusCode ?? 0);
          });
        }
      );
      req.on('error', reject);
      req.write('{');
    });
    expect(slowStatus).toBe(408);
  });
});

describe.each([
  ['2025 stateless compatibility', 'legacy' as const],
  ['2026-07-28', { pin: '2026-07-28' as const }]
])('HTTP MCP adapter: %s', (_label, mode) => {
  it('authenticates through createMcpHandler/toNodeHandler and lists server_status', async () => {
    const runtime = await start();
    const transport = new StreamableHTTPClientTransport(new URL(runtime.url), {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('authorization', `Bearer ${TOKEN}`);
        return fetch(input, { ...init, headers });
      }
    });
    const client = new Client(
      { name: 'http-runtime-test', version: '0.1.0' },
      { versionNegotiation: { mode } }
    );
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map(({ name }) => name)).toEqual(['server_status']);
    } finally {
      await Promise.allSettled([client.close(), transport.close()]);
    }
  });
});

it('passes stateless legacy and 16 subscriptions to beta.4 and configures exact socket bounds', async () => {
  let capturedOptions: Parameters<typeof createMcpHandler>[1];
  let capturedServer: Server | undefined;
  const dependencies = {
    createHandler: (
      factory: Parameters<typeof createMcpHandler>[0],
      options: Parameters<typeof createMcpHandler>[1]
    ) => {
      capturedOptions = options;
      return createMcpHandler(factory, options);
    },
    adaptHandler: toNodeHandler,
    createNodeServer: (listener: RequestListener) => {
      capturedServer = createServer(listener);
      return capturedServer;
    },
    listen: (server: Server, port: number, host: string) =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          const address = server.address();
          if (address === null || typeof address === 'string') reject(new Error('TCP address'));
          else resolve(address);
        });
      })
  } as unknown as HttpRuntimeDependencies;
  const runtime = await startHttpWithDependencies(
    createApplicationContext(config()),
    { port: 0 },
    dependencies
  );
  try {
    expect(capturedOptions).toMatchObject({ legacy: 'stateless', maxSubscriptions: 16 });
    expect(Object.keys(capturedOptions ?? {})).not.toContain('sessionStore');
    expect(capturedServer?.headersTimeout).toBe(5_000);
    expect(capturedServer?.keepAliveTimeout).toBe(5_000);
    expect(capturedServer?.maxRequestsPerSocket).toBe(100);
    let connections = 0;
    capturedServer?.on('connection', () => {
      connections += 1;
    });
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    try {
      for (let index = 0; index < 100; index += 1) {
        const response = await rawPost(
          new URL(runtime.url),
          {
            authorization: `Bearer ${TOKEN}`,
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(body))
          },
          body,
          agent
        );
        expect(response.status).toBe(200);
      }
      const overLimit = await rawPost(
        new URL(runtime.url),
        {
          authorization: `Bearer ${TOKEN}`,
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body))
        },
        body,
        agent
      );
      expect(overLimit.status).toBe(503);
      const nextSocket = await rawPost(
        new URL(runtime.url),
        {
          authorization: `Bearer ${TOKEN}`,
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body))
        },
        body,
        agent
      );
      expect(nextSocket.status).toBe(200);
      expect(connections).toBe(2);
    } finally {
      agent.destroy();
    }
  } finally {
    await runtime.close();
  }
});

it('projects frozen defensive HTTP settings without exposing the bearer', () => {
  const allowedHosts = ['127.0.0.1'];
  const allowedOrigins = [ORIGIN];
  const application = createApplicationContext(config({ allowedHosts, allowedOrigins }));
  allowedHosts.push('mutated.example');
  allowedOrigins.push('https://mutated.example');
  const security = buildApplicationHttpSecurity(application);
  expect(Object.isFrozen(security)).toBe(true);
  expect(Object.isFrozen(security.allowedHosts)).toBe(true);
  expect(Object.isFrozen(security.allowedOrigins)).toBe(true);
  expect(security.allowedHosts).toEqual(['127.0.0.1']);
  expect(security.allowedOrigins).toEqual([ORIGIN]);
  expect(Object.getOwnPropertyNames(security)).not.toContain('token');
  expect(JSON.stringify(security)).not.toContain(TOKEN);
});

it('starts an ordinary deadline once and upgrades an SSE response once to an absolute lifetime', () => {
  const scheduled: { callback: () => void; milliseconds: number; cleared: boolean }[] = [];
  const clock = {
    set: (callback: () => void, milliseconds: number) => {
      const timer = { callback, milliseconds, cleared: false };
      scheduled.push(timer);
      return timer as never;
    },
    clear: (handle: { cleared: boolean }) => {
      handle.cleared = true;
    }
  };
  class FakeResponse extends EventEmitter {
    destroyed = 0;
    writeHead(..._arguments: unknown[]): this {
      void _arguments;
      return this;
    }
    destroy(): void {
      this.destroyed += 1;
    }
  }
  const ordinaryResponse = new FakeResponse();
  const handler = vi.fn(() => Promise.resolve());
  withResponseDeadline(
    handler as never,
    { executionTimeoutMs: 30_000, streamLifetimeMs: 300_000 },
    clock as never
  )({ body: undefined } as never, ordinaryResponse as never, vi.fn());
  expect(scheduled[0]?.milliseconds).toBe(30_000);
  scheduled[0]?.callback();
  expect(ordinaryResponse.destroyed).toBe(1);

  const streamResponse = new FakeResponse();
  withResponseDeadline(
    handler as never,
    { executionTimeoutMs: 30_000, streamLifetimeMs: 300_000 },
    clock as never
  )({ body: undefined } as never, streamResponse as never, vi.fn());
  streamResponse.writeHead(200, { 'content-type': 'text/event-stream' } as never);
  streamResponse.writeHead(200, { 'content-type': 'text/event-stream' } as never);
  expect(scheduled.map(({ milliseconds }) => milliseconds)).toEqual([30_000, 30_000, 300_000]);
  expect(scheduled[1]?.cleared).toBe(true);
  scheduled[2]?.callback();
  expect(streamResponse.destroyed).toBe(1);
});

it('admits 32 held requests, rejects request 33, and releases capacity after completion', async () => {
  const security = buildApplicationHttpSecurity(createApplicationContext(config()));
  const held: {
    readonly response: {
      writeHead(status: number, headers: Record<string, string>): void;
      end(body: string): void;
    };
    readonly resolve: () => void;
  }[] = [];
  const adapter = (_request: unknown, response: unknown) =>
    new Promise<void>((resolve) => {
      held.push({
        response: response as (typeof held)[number]['response'],
        resolve
      });
    });
  const running = await listen(
    buildHttpExpressApplication(security, DEFAULT_HTTP_LIMITS, adapter as never)
  );
  const call = () =>
    fetch(running.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json'
      },
      body: '{}'
    });
  try {
    const admitted = Array.from({ length: 32 }, call);
    await expect.poll(() => held.length, { timeout: 3000 }).toBe(32);
    expect((await call()).status).toBe(503);
    for (const request of held.splice(0)) {
      request.response.writeHead(200, { 'content-type': 'application/json' });
      request.response.end('{}');
      request.resolve();
    }
    expect((await Promise.all(admitted)).every(({ status }) => status === 200)).toBe(true);

    const afterRelease = call();
    await expect.poll(() => held.length, { timeout: 3000 }).toBe(1);
    const [last] = held.splice(0);
    last?.response.writeHead(200, { 'content-type': 'application/json' });
    last?.response.end('{}');
    last?.resolve();
    expect((await afterRelease).status).toBe(200);
  } finally {
    for (const request of held.splice(0)) {
      request.response.writeHead(500, { 'content-type': 'application/json' });
      request.response.end('{}');
      request.resolve();
    }
    await new Promise<void>((resolve, reject) => {
      running.server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    });
  }
});

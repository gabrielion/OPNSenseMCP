// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-deprecated */
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Server as LegacyServer } from '@modelcontextprotocol/sdk/server/index.js';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import * as z from 'zod/v4';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApplicationContext } from '../../src/app/application-context.js';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import { dispatchCapability } from '../../src/capabilities/dispatch.js';
import { defineCapability } from '../../src/capabilities/kernel.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { startHttp, type HttpRuntime } from '../../src/http/runtime.js';
import { connectLegacy } from '../helpers/connect.js';
import { createMutationFixture } from '../fixtures/capabilities.js';

const TOKEN = 'LEGACY_SSE_SENTINEL_TOKEN_0123456789';
const ORIGIN = 'https://console.example:8443';
const runtimes = new Set<HttpRuntime>();
const connections = new Set<() => Promise<unknown>>();

interface OpenSse {
  readonly sessionId: string;
  readonly close: () => void;
  readonly closed: Promise<void>;
}

interface BlockingCapabilityFixture {
  readonly catalog: CapabilityCatalog;
  readonly signals: AbortSignal[];
  readonly secondStarted: Promise<void>;
  readonly finalized: () => number;
  release(): void;
}

function application(enabled: boolean, catalog?: CapabilityCatalog) {
  return createApplicationContext(
    loadRuntimeConfig({
      READ_ONLY: 'false',
      MCP_HTTP_ENABLED: 'true',
      MCP_HTTP_TOKEN: TOKEN,
      MCP_ALLOWED_ORIGINS: ORIGIN,
      MCP_LEGACY_SSE_ENABLED: enabled ? 'true' : 'false'
    }),
    catalog
  );
}

function createBlockingCapabilityFixture(
  effect: 'read' | 'local-write',
  options: { readonly rejectAfterRelease?: boolean } = {}
): BlockingCapabilityFixture {
  const signals: AbortSignal[] = [];
  let finalized = 0;
  let releaseGate: (() => void) | undefined;
  let resolveSecondStarted: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const secondStarted = new Promise<void>((resolve) => {
    resolveSecondStarted = resolve;
  });
  const capability = defineCapability({
    id: `test.blocking-${effect}`,
    mcpName: 'blocking_call',
    title: 'Blocking call',
    description: 'Hold one test capability execution until explicitly released.',
    inputSchema: z.object({ value: z.string() }).strict(),
    outputSchema: z.object({ echoed: z.string() }).strict(),
    annotations: {
      readOnlyHint: effect === 'read',
      destructiveHint: effect !== 'read',
      idempotentHint: true,
      openWorldHint: false
    },
    transports: ['http'],
    policy: {
      effect,
      resourceScopes: [],
      requiredFeatureFlags: [],
      backup: 'none',
      audit: 'none',
      confirmation: 'none',
      timeoutMs: 1_000,
      redactFields: []
    },
    handler: async ({ value }, context) => {
      signals.push(context.signal);
      if (signals.length === 2) resolveSecondStarted?.();
      try {
        await gate;
        if (options.rejectAfterRelease === true) throw new Error('fixture-rejection');
        return { echoed: value };
      } finally {
        finalized += 1;
      }
    }
  });
  return {
    catalog: new CapabilityCatalog([capability]),
    signals,
    secondStarted,
    finalized: () => finalized,
    release() {
      releaseGate?.();
      releaseGate = undefined;
    }
  };
}

afterEach(async () => {
  await Promise.allSettled([...connections].map((close) => close()));
  connections.clear();
  await Promise.allSettled([...runtimes].map((runtime) => runtime.close()));
  runtimes.clear();
  vi.restoreAllMocks();
});

function headers(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, origin: ORIGIN };
}

function rawRequest(
  runtime: HttpRuntime,
  path: string,
  method: 'GET' | 'POST',
  requestHeaders: Record<string, string>,
  body?: string
): Promise<{ status: number; body: string }> {
  const target = new URL(runtime.url);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path,
        method,
        headers: { host: target.host, ...requestHeaders }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('error', reject);
        response.once('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );
    request.once('error', reject);
    request.end(body);
  });
}

function rawHeadersOnly(
  runtime: HttpRuntime,
  path: string,
  requestHeaders: Record<string, string>
): Promise<number> {
  const target = new URL(runtime.url);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path,
        method: 'POST',
        headers: { host: target.host, ...requestHeaders }
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

function openSse(runtime: HttpRuntime): Promise<OpenSse> {
  const target = new URL(runtime.url);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: '/sse',
        method: 'GET',
        headers: { host: target.host, ...headers() }
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Expected SSE HTTP 200, got ${String(response.statusCode)}`));
          return;
        }
        let settled = false;
        let text = '';
        let resolveClosed: (() => void) | undefined;
        const closed = new Promise<void>((resolveClosedValue) => {
          resolveClosed = resolveClosedValue;
        });
        response.once('error', (error) => {
          if (!settled) reject(error);
        });
        response.once('close', () => resolveClosed?.());
        response.on('data', (chunk: Buffer) => {
          text += chunk.toString('utf8');
          const match = /event: endpoint\s+data: \/messages\?sessionId=([A-Za-z0-9_-]+)/u.exec(
            text
          );
          if (settled || match?.[1] === undefined) return;
          settled = true;
          const session = { sessionId: match[1], close: () => response.destroy(), closed };
          connections.add(() => {
            session.close();
            return session.closed;
          });
          resolve(session);
        });
      }
    );
    request.once('error', reject);
    request.end();
  });
}

async function openLegacyClient(runtime: HttpRuntime, name: string) {
  const transport = new SSEClientTransport(new URL('/sse', runtime.url), {
    requestInit: { headers: headers() }
  });
  const client = new LegacyClient({ name, version: '0.1.0' }, { capabilities: {} });
  let resolveClosed: (() => void) | undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  client.onclose = () => resolveClosed?.();
  const close = () => Promise.allSettled([client.close(), transport.close()]);
  connections.add(close);
  await client.connect(transport);
  const endpoint = (transport as unknown as { readonly _endpoint?: URL })._endpoint;
  const sessionId = endpoint?.searchParams.get('sessionId');
  if (sessionId === null || sessionId === undefined) {
    await close();
    throw new Error('Legacy test client did not receive a session identifier');
  }
  return { client, transport, closed, close, sessionId };
}

function betaToolsList(runtime: HttpRuntime): Promise<Response> {
  return fetch(runtime.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
  });
}

describe('isolated legacy SSE compatibility', () => {
  it('is default-off and leaves the beta endpoint available', async () => {
    const runtime = await startHttp(application(false), { port: 0 });
    runtimes.add(runtime);
    const headers = { authorization: `Bearer ${TOKEN}`, origin: ORIGIN };
    expect((await fetch(new URL('/sse', runtime.url), { headers })).status).toBe(404);
    expect(
      (
        await fetch(new URL('/messages?sessionId=valid-but-absent', runtime.url), {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: '{}'
        })
      ).status
    ).toBe(404);
    const transport = new StreamableHTTPClientTransport(new URL(runtime.url), {
      fetch: (input, init) => {
        const forwarded = new Headers(init?.headers);
        forwarded.set('authorization', `Bearer ${TOKEN}`);
        return fetch(input, { ...init, headers: forwarded });
      }
    });
    const client = new Client({ name: 'beta', version: '0.1.0' }, { capabilities: {} });
    connections.add(() => Promise.allSettled([client.close(), transport.close()]));
    await client.connect(transport);
    expect((await client.listTools()).tools.map(({ name }) => name)).toEqual([
      'server_status',
      'opn_describe',
      'opn_get',
      'opn_list'
    ]);
  });

  it('serves the isolated v1 client while retaining /mcp', async () => {
    const runtime = await startHttp(application(true), { port: 0 });
    runtimes.add(runtime);
    expect(runtime.url).toMatch(/\/mcp$/u);
    const transport = new SSEClientTransport(new URL('/sse', runtime.url), {
      requestInit: { headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN } }
    });
    const client = new LegacyClient({ name: 'legacy', version: '0.1.0' }, { capabilities: {} });
    const betaTransport = new StreamableHTTPClientTransport(new URL(runtime.url), {
      fetch: (input, init) => {
        const forwarded = new Headers(init?.headers);
        forwarded.set('authorization', `Bearer ${TOKEN}`);
        return fetch(input, { ...init, headers: forwarded });
      }
    });
    const betaClient = new Client({ name: 'beta', version: '0.1.0' }, { capabilities: {} });
    connections.add(() => Promise.allSettled([client.close(), transport.close()]));
    connections.add(() => Promise.allSettled([betaClient.close(), betaTransport.close()]));
    await client.connect(transport);
    await betaClient.connect(betaTransport);
    expect((await client.listTools()).tools.map(({ name }) => name)).toEqual([
      'server_status',
      'opn_describe',
      'opn_get',
      'opn_list'
    ]);
    expect((await betaClient.listTools()).tools.map(({ name }) => name)).toEqual([
      'server_status',
      'opn_describe',
      'opn_get',
      'opn_list'
    ]);
    expect((await client.callTool({ name: 'server_status', arguments: {} })).isError).not.toBe(
      true
    );
    expect((await betaClient.callTool({ name: 'server_status', arguments: {} })).isError).not.toBe(
      true
    );
  });

  it('applies shared Host, Origin, bearer, and body guards before legacy routes', async () => {
    const runtime = await startHttp(application(true), {
      port: 0,
      limits: { bodyReceiptTimeoutMs: 25 }
    });
    runtimes.add(runtime);
    const diagnostics = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    for (const [path, method] of [
      ['/sse', 'GET'],
      ['/messages?sessionId=valid-but-absent', 'POST']
    ] as const) {
      const contentType = method === 'POST' ? { 'content-type': 'application/json' } : {};
      expect((await rawRequest(runtime, path, method, contentType)).status).toBe(401);
      expect(
        (await rawRequest(runtime, path, method, { ...contentType, authorization: 'Bearer wrong' }))
          .status
      ).toBe(401);
      expect(
        (
          await rawRequest(runtime, path, method, {
            ...contentType,
            ...headers(),
            origin: 'https://foreign.example'
          })
        ).status
      ).toBe(403);
      expect(
        (
          await rawRequest(runtime, path, method, {
            ...contentType,
            ...headers(),
            host: 'foreign.example'
          })
        ).status
      ).toBe(403);
    }
    expect(
      (
        await rawRequest(
          runtime,
          '/messages?sessionId=../escape',
          'POST',
          {
            ...headers(),
            'content-type': 'application/json'
          },
          '{}'
        )
      ).status
    ).toBe(400);
    expect(
      (
        await rawRequest(
          runtime,
          '/messages?sessionId=valid-but-absent',
          'POST',
          {
            ...headers(),
            'content-type': 'application/json'
          },
          '{}'
        )
      ).status
    ).toBe(404);
    const oversize = await rawRequest(runtime, '/messages?sessionId=valid-but-absent', 'POST', {
      'content-type': 'application/json',
      'content-length': String(256 * 1024 + 1)
    });
    expect(oversize.status).toBe(413);
    expect(oversize.body).not.toContain(TOKEN);
    expect(
      await rawHeadersOnly(runtime, '/messages?sessionId=valid-but-absent', {
        'content-type': 'application/json',
        'content-length': '10'
      })
    ).toBe(408);
    expect(diagnostics.mock.calls.flat().join('')).not.toContain(TOKEN);
  });

  it('bounds eight legacy sessions and reclaims a destroyed session', async () => {
    const runtime = await startHttp(application(true), { port: 0 });
    runtimes.add(runtime);
    const sessions: OpenSse[] = [];
    for (let index = 0; index < 8; index += 1) sessions.push(await openSse(runtime));
    expect((await rawRequest(runtime, '/sse', 'GET', headers())).status).toBe(503);
    sessions[0]?.close();
    await sessions[0]?.closed;
    await new Promise((resolve) => setTimeout(resolve, 25));
    const replacement = await openSse(runtime);
    replacement.close();
    for (const session of sessions.slice(1)) session.close();
  });

  it('shares concurrent-request capacity with the beta endpoint and releases it on SSE close', async () => {
    const runtime = await startHttp(application(true), {
      port: 0,
      limits: { maxConcurrentRequests: 2 }
    });
    runtimes.add(runtime);
    const first = await openSse(runtime);
    const second = await openSse(runtime);
    const modern = await fetch(runtime.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    });
    expect(modern.status).toBe(503);
    expect(await modern.json()).toEqual({ error: 'request_limit_reached' });
    const legacy = await rawRequest(
      runtime,
      `/messages?sessionId=${first.sessionId}`,
      'POST',
      { ...headers(), 'content-type': 'application/json' },
      '{}'
    );
    expect(legacy.status).toBe(503);
    expect(JSON.parse(legacy.body)).toEqual({ error: 'request_limit_reached' });
    first.close();
    await first.closed;
    const recovered = await fetch(runtime.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    });
    expect(recovered.status).toBe(200);
    second.close();
  });

  it('admits only one capability dispatch per legacy session and refuses the whole competing flood', async () => {
    const fixture = createBlockingCapabilityFixture('read');
    const runtime = await startHttp(application(true, fixture.catalog), {
      port: 0,
      limits: { maxConcurrentRequests: 32 }
    });
    runtimes.add(runtime);
    const opened = await openLegacyClient(runtime, 'single-dispatch');
    const first = opened.client.callTool({ name: 'blocking_call', arguments: { value: 'first' } });
    await expect.poll(() => fixture.signals.length).toBe(1);
    const competing = Array.from({ length: 12 }, (_, index) =>
      opened.client.callTool({
        name: 'blocking_call',
        arguments: { value: `competing-${String(index)}` }
      })
    );
    const allCallsSettlement = Promise.allSettled([first, ...competing]);
    const competingSettlement = Promise.all(competing);
    try {
      await Promise.race([competingSettlement.then(() => undefined), fixture.secondStarted]);
      expect(fixture.signals).toHaveLength(1);
      expect(await competingSettlement).toEqual(
        Array.from({ length: 12 }, () => ({
          isError: true,
          content: [
            { type: 'text', text: 'Legacy SSE session already has an active capability call.' }
          ],
          structuredContent: { code: 'LEGACY_SESSION_BUSY' }
        }))
      );
      fixture.release();
      await expect(first).resolves.toMatchObject({ structuredContent: { echoed: 'first' } });
      await expect(
        opened.client.callTool({ name: 'blocking_call', arguments: { value: 'after' } })
      ).resolves.toMatchObject({ structuredContent: { echoed: 'after' } });
      expect(fixture.signals).toHaveLength(2);
      expect(fixture.finalized()).toBe(2);
    } finally {
      fixture.release();
      await opened.close();
      await allCallsSettlement;
    }
  });

  it('keeps a disconnected write dispatch in the shared admission slot until real settlement', async () => {
    const fixture = createBlockingCapabilityFixture('local-write');
    const runtime = await startHttp(application(true, fixture.catalog), {
      port: 0,
      limits: { maxConcurrentRequests: 2 }
    });
    runtimes.add(runtime);
    const opened = await openLegacyClient(runtime, 'retained-admission');
    const call = opened.client.callTool({
      name: 'blocking_call',
      arguments: { value: 'held-write' }
    });
    const callSettlement = Promise.allSettled([call]);
    let replacement: OpenSse | undefined;
    try {
      await expect.poll(() => fixture.signals.length).toBe(1);
      await opened.transport.close();
      await opened.closed;
      replacement = await openSse(runtime);

      const saturated = await betaToolsList(runtime);
      expect(saturated.status).toBe(503);
      expect(await saturated.json()).toEqual({ error: 'request_limit_reached' });

      fixture.release();
      await expect.poll(() => fixture.finalized()).toBe(1);
      await delay(0);
      expect((await betaToolsList(runtime)).status).toBe(200);
    } finally {
      fixture.release();
      replacement?.close();
      await opened.close();
      await callSettlement;
    }
  });

  it('keeps runtime close pending on an abort-ignoring write and shares the same close promise', async () => {
    const fixture = createBlockingCapabilityFixture('local-write');
    const runtime = await startHttp(application(true, fixture.catalog), {
      port: 0,
      limits: { headersTimeoutMs: 25, keepAliveTimeoutMs: 25 }
    });
    runtimes.add(runtime);
    const opened = await openLegacyClient(runtime, 'owned-write');
    const call = opened.client.callTool({
      name: 'blocking_call',
      arguments: { value: 'shutdown-write' }
    });
    const callSettlement = Promise.allSettled([call]);
    let close: Promise<void> | undefined;
    try {
      await expect.poll(() => fixture.signals.length).toBe(1);
      close = runtime.close();
      expect(runtime.close()).toBe(close);
      let closeSettled = false;
      void close.then(
        () => {
          closeSettled = true;
        },
        () => {
          closeSettled = true;
        }
      );
      await expect.poll(() => fixture.signals[0]?.aborted).toBe(true);
      await delay(10);
      expect(closeSettled).toBe(false);
      expect(fixture.finalized()).toBe(0);

      await opened.close();
      fixture.release();
      await close;
      expect(fixture.finalized()).toBe(1);
      expect(runtime.close()).toBe(close);
    } finally {
      fixture.release();
      await opened.close();
      await Promise.allSettled(close === undefined ? [] : [close]);
      await callSettlement;
    }
  });

  it('suspends idle expiry during a call and rearms it only after dispatch settlement', async () => {
    const fixture = createBlockingCapabilityFixture('read');
    const runtime = await startHttp(application(true, fixture.catalog), {
      port: 0,
      limits: { legacySessionIdleTimeoutMs: 25, streamLifetimeMs: 1_000 }
    });
    runtimes.add(runtime);
    const opened = await openLegacyClient(runtime, 'idle-suspension');
    const call = opened.client.callTool({
      name: 'blocking_call',
      arguments: { value: 'longer-than-idle' }
    });
    const callSettlement = Promise.allSettled([call]);
    try {
      await expect.poll(() => fixture.signals.length).toBe(1);
      await delay(75);
      expect(fixture.signals[0]?.aborted).toBe(false);
      expect(fixture.finalized()).toBe(0);

      fixture.release();
      await expect(call).resolves.toMatchObject({
        structuredContent: { echoed: 'longer-than-idle' }
      });
      await delay(75);
      const afterIdle = await rawRequest(
        runtime,
        `/messages?sessionId=${opened.sessionId}`,
        'POST',
        { ...headers(), 'content-type': 'application/json' },
        JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list', params: {} })
      );
      expect(afterIdle.status).toBe(404);
      expect(fixture.finalized()).toBe(1);
    } finally {
      fixture.release();
      await opened.close();
      await callSettlement;
    }
  });

  it('never reflects a non-object legacy envelope marker', async () => {
    const runtime = await startHttp(application(true), { port: 0 });
    runtimes.add(runtime);
    const session = await openSse(runtime);
    const marker = 'LEGACY_ARRAY_MARKER_MUST_NOT_BE_REFLECTED_93f62d';
    const response = await rawRequest(
      runtime,
      `/messages?sessionId=${session.sessionId}`,
      'POST',
      { ...headers(), 'content-type': 'application/json' },
      JSON.stringify([marker])
    );
    expect(response).toEqual({
      status: 400,
      body: JSON.stringify({ error: 'invalid_legacy_message' })
    });
    expect(response.body).not.toContain(marker);
    session.close();
  });

  it('releases session ownership exactly once after a rejected capability dispatch', async () => {
    const fixture = createBlockingCapabilityFixture('read', { rejectAfterRelease: true });
    const runtime = await startHttp(application(true, fixture.catalog), { port: 0 });
    runtimes.add(runtime);
    const opened = await openLegacyClient(runtime, 'rejected-dispatch');
    const first = opened.client.callTool({
      name: 'blocking_call',
      arguments: { value: 'first-rejection' }
    });
    await expect.poll(() => fixture.signals.length).toBe(1);
    fixture.release();
    await expect(first).resolves.toMatchObject({
      isError: true,
      structuredContent: { code: 'EXECUTION_FAILED' }
    });
    await expect(
      opened.client.callTool({ name: 'blocking_call', arguments: { value: 'second-rejection' } })
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: { code: 'EXECUTION_FAILED' }
    });
    expect(fixture.signals).toHaveLength(2);
    expect(fixture.finalized()).toBe(2);
  });

  it('retains one failed idle session close for concurrent runtime shutdown', async () => {
    const closeFailure = new Error('legacy-session-close-failure');
    const closeServer = vi.spyOn(LegacyServer.prototype, 'close').mockRejectedValue(closeFailure);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runtime = await startHttp(application(true), {
      port: 0,
      limits: {
        legacySessionIdleTimeoutMs: 25,
        streamLifetimeMs: 1_000,
        keepAliveTimeoutMs: 25
      }
    });
    runtimes.add(runtime);
    const opened = await openSse(runtime);
    await expect.poll(() => closeServer.mock.calls.length).toBe(1);
    opened.close();
    await opened.closed;
    await delay(25);

    const first = runtime.close();
    expect(runtime.close()).toBe(first);
    const error = await first.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([closeFailure]);
    expect(closeServer).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['idle', { legacySessionIdleTimeoutMs: 25, streamLifetimeMs: 1_000 }],
    ['absolute stream', { legacySessionIdleTimeoutMs: 1_000, streamLifetimeMs: 25 }]
  ] as const)('expires a %s legacy stream and forgets its session', async (_label, limits) => {
    const runtime = await startHttp(application(true), { port: 0, limits });
    runtimes.add(runtime);
    const session = await openSse(runtime);
    await session.closed;
    expect(
      (
        await rawRequest(
          runtime,
          `/messages?sessionId=${session.sessionId}`,
          'POST',
          { ...headers(), 'content-type': 'application/json' },
          '{}'
        )
      ).status
    ).toBe(404);
  });

  it('passes raw legacy arguments through the sealed kernel exactly once', async () => {
    const counters = { inputRefine: 0, inputTransform: 0, outputRefine: 0, handler: 0 };
    const capability = defineCapability({
      id: 'test.sealed-read',
      mcpName: 'sealed_read',
      title: 'Sealed read',
      description: 'Verify one kernel parse.',
      inputSchema: z.object({
        port: z
          .string()
          .refine(() => {
            counters.inputRefine += 1;
            return true;
          })
          .transform((value) => {
            counters.inputTransform += 1;
            return Number(value);
          })
      }),
      outputSchema: z.object({
        port: z.number().refine(() => {
          counters.outputRefine += 1;
          return true;
        })
      }),
      annotations: { readOnlyHint: true },
      transports: ['http'],
      policy: {
        effect: 'read',
        resourceScopes: [],
        requiredFeatureFlags: [],
        backup: 'none',
        audit: 'none',
        confirmation: 'none',
        timeoutMs: 1_000,
        redactFields: []
      },
      handler: ({ port }) => {
        counters.handler += 1;
        return Promise.resolve({ port });
      }
    });
    const runtime = await startHttp(application(true, new CapabilityCatalog([capability])), {
      port: 0
    });
    runtimes.add(runtime);
    const transport = new SSEClientTransport(new URL('/sse', runtime.url), {
      requestInit: { headers: headers() }
    });
    const client = new LegacyClient({ name: 'sealed', version: '0.1.0' }, { capabilities: {} });
    connections.add(() => Promise.allSettled([client.close(), transport.close()]));
    await client.connect(transport);
    expect(
      await client.callTool({ name: 'sealed_read', arguments: { port: '443' } })
    ).toMatchObject({
      structuredContent: { port: 443 }
    });
    expect(counters).toEqual({ inputRefine: 1, inputTransform: 1, outputRefine: 1, handler: 1 });
    expect(await client.callTool({ name: 'unknown', arguments: {} })).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Capability is not available.' }],
      structuredContent: { code: 'UNKNOWN_CAPABILITY' }
    });
    expect(counters).toEqual({ inputRefine: 1, inputTransform: 1, outputRefine: 1, handler: 1 });
  });

  it('filters confirmation tools so forged SSE calls cannot consume the confirmation ledger', async () => {
    const onCall = vi.fn();
    const sealed = createMutationFixture(onCall, { id: 'test.sealed', mcpName: 'sealed_tool' });
    const sealedApplication = application(true, new CapabilityCatalog([sealed]));
    const runtime = await startHttp(sealedApplication, { port: 0 });
    runtimes.add(runtime);
    const transport = new SSEClientTransport(new URL('/sse', runtime.url), {
      requestInit: { headers: headers() }
    });
    const client = new LegacyClient({ name: 'forged', version: '0.1.0' }, { capabilities: {} });
    connections.add(() => Promise.allSettled([client.close(), transport.close()]));
    await client.connect(transport);
    expect((await client.listTools()).tools.map(({ name }) => name)).not.toContain('sealed_tool');
    for (let sequence = 0; sequence < 1023; sequence += 1) {
      expect(
        (
          await dispatchCapability(
            { name: 'sealed_tool', arguments: { value: String(sequence) } },
            {
              application: sealedApplication,
              transport: 'stdio',
              principalId: 'stdio:local-connection'
            }
          )
        ).kind
      ).toBe('confirmation-required');
    }
    const unknown = {
      isError: true,
      content: [{ type: 'text', text: 'Capability is not available.' }],
      structuredContent: { code: 'UNKNOWN_CAPABILITY' }
    };
    for (let sequence = 0; sequence < 16; sequence += 1) {
      expect(
        await client.callTool({ name: 'sealed_tool', arguments: { value: String(sequence) } })
      ).toEqual(unknown);
    }
    expect(onCall).not.toHaveBeenCalled();
    const beta = await connectLegacy(sealedApplication, {
      capabilities: { elicitation: { form: {} } }
    });
    connections.add(() => beta.close());
    beta.client.setRequestHandler('elicitation/create', () =>
      Promise.resolve({ action: 'accept', content: { confirm: true } })
    );
    try {
      expect(
        await beta.client.callTool({ name: 'sealed_tool', arguments: { value: '1023' } })
      ).toMatchObject({
        structuredContent: { accepted: '1023' }
      });
      expect(onCall).toHaveBeenCalledTimes(1);
      expect(
        (
          await dispatchCapability(
            { name: 'sealed_tool', arguments: { value: 'ledger-final-pending' } },
            {
              application: sealedApplication,
              transport: 'stdio',
              principalId: 'stdio:local-connection'
            }
          )
        ).kind
      ).toBe('confirmation-required');
      expect(
        await dispatchCapability(
          { name: 'sealed_tool', arguments: { value: 'ledger-overflow' } },
          {
            application: sealedApplication,
            transport: 'stdio',
            principalId: 'stdio:local-connection'
          }
        )
      ).toMatchObject({ kind: 'refused', code: 'CONFIRMATION_UNAVAILABLE' });
    } finally {
      await beta.close();
    }
  });

  it('owns and settles all legacy streams through one idempotent runtime shutdown', async () => {
    const runtime = await startHttp(application(true), { port: 0 });
    runtimes.add(runtime);
    const sessions = await Promise.all([openSse(runtime), openSse(runtime), openSse(runtime)]);
    const first = runtime.close();
    const second = runtime.close();
    expect(first).toBe(second);
    await first;
    await Promise.all(sessions.map(({ closed }) => closed));
    expect(runtime.close()).toBe(first);
  });

  it('fails closed before binding when v1 metadata cannot represent a capability schema', async () => {
    const base = {
      id: 'test.schema',
      mcpName: 'schema_test',
      title: 'Schema test',
      description: 'Schema test capability',
      inputSchema: z.object({ value: z.string() }),
      annotations: { readOnlyHint: true },
      transports: ['http'] as const,
      policy: {
        effect: 'read' as const,
        resourceScopes: [],
        requiredFeatureFlags: [],
        backup: 'none' as const,
        audit: 'none' as const,
        confirmation: 'none' as const,
        timeoutMs: 1_000,
        redactFields: []
      },
      handler: () => Promise.resolve({ value: 'ok' })
    };
    const transformed = new CapabilityCatalog([
      defineCapability({
        ...base,
        outputSchema: z.object({ value: z.string().transform(Number) }),
        handler: () => Promise.resolve({ value: 1 })
      })
    ]);
    const transformedError = await startHttp(application(true, transformed), { port: 0 }).catch(
      (error: unknown) => error
    );
    expect(transformedError).toBeInstanceOf(Error);
    expect((transformedError as Error).message).toBe(
      'Legacy SSE capability schema is not representable'
    );
    const nonObject = new CapabilityCatalog([
      defineCapability({
        ...base,
        id: 'test.non-object',
        mcpName: 'non_object_test',
        inputSchema: z.string() as never,
        outputSchema: z.object({ value: z.string() })
      })
    ]);
    const nonObjectError = await startHttp(application(true, nonObject), { port: 0 }).catch(
      (error: unknown) => error
    );
    expect(nonObjectError).toBeInstanceOf(Error);
    expect((nonObjectError as Error).message).toBe(
      'Legacy SSE capability schema is not representable'
    );
  });
});

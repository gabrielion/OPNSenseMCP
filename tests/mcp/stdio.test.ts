// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStdioAggregateClose,
  startStdioWithDependencies,
  startStdioWithOptions,
  type StdioRuntimeDependencies
} from '../../src/entrypoints/stdio.js';
import { createApplicationContext } from '../../src/app/application-context.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';

const SENTINEL = 'STDIO_SENTINEL_MUST_NOT_LEAK_0123456789';
const children = new Set<StdioClientTransport>();
const rawChildren = new Set<ChildProcessWithoutNullStreams>();

function parseJson(line: string): unknown {
  return JSON.parse(line) as unknown;
}

afterEach(async () => {
  await Promise.allSettled([...children].map((transport) => transport.close()));
  children.clear();
  for (const child of rawChildren) child.kill('SIGKILL');
  rawChildren.clear();
});

function spawnMain(): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? '',
      READ_ONLY: 'true',
      MCP_REQUEST_STATE_SECRET: SENTINEL
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  rawChildren.add(child);
  return child;
}

async function exchangeRaw(messages: readonly Record<string, unknown>[]) {
  const child = spawnMain();
  let stdout = '';
  let stderr = '';
  const responses: unknown[] = [];
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
    const lines = stdout.split('\n');
    for (const line of lines.slice(0, -1)) {
      if (line.length > 0) responses.push(JSON.parse(line) as unknown);
    }
  });
  for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
  const expectedIds = new Set(
    messages.flatMap((message) =>
      typeof message.id === 'number' || typeof message.id === 'string' ? [message.id] : []
    )
  );
  await expect
    .poll(
      () =>
        [...expectedIds].every((id) =>
          responses.some(
            (response) =>
              typeof response === 'object' &&
              response !== null &&
              'id' in response &&
              Reflect.get(response, 'id') === id
          )
        ),
      { timeout: 3000 }
    )
    .toBe(true);
  child.kill('SIGTERM');
  await new Promise<void>((resolve) =>
    child.once('exit', () => {
      resolve();
    })
  );
  rawChildren.delete(child);
  const completeStdout = stdout.trim();
  const lines = completeStdout === '' ? [] : completeStdout.split('\n');
  return { lines, responses, stderr };
}

async function connect(versionNegotiation: 'legacy' | { readonly pin: '2026-07-28' }) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/main.js'],
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? '',
      READ_ONLY: 'true',
      MCP_REQUEST_STATE_SECRET: SENTINEL
    },
    stderr: 'pipe'
  });
  children.add(transport);
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const client = new Client(
    { name: 'stdio-entrypoint-test', version: '0.1.0' },
    { versionNegotiation: { mode: versionNegotiation } }
  );
  await client.connect(transport);
  return { client, transport, stderr: () => stderr };
}

describe.each([
  ['2025 compatibility', 'legacy' as const],
  ['2026-07-28', { pin: '2026-07-28' as const }]
])('owned stdio entrypoint: %s', (_label, versionNegotiation) => {
  it('keeps stdout protocol-clean, exposes server_status, and never diagnoses the sentinel', async () => {
    const connection = await connect(versionNegotiation);
    try {
      expect((await connection.client.listTools()).tools.map(({ name }) => name)).toEqual([
        'server_status'
      ]);
      expect(connection.stderr()).not.toContain(SENTINEL);
    } finally {
      await connection.client.close();
      await connection.transport.close();
      children.delete(connection.transport);
    }
  });
});

it('emits only one JSON-RPC object per nonempty stdout line in both eras', async () => {
  const legacy = await exchangeRaw([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'raw-legacy', version: '0.1.0' }
      }
    },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }
  ]);
  const modernMeta = {
    [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
    [CLIENT_INFO_META_KEY]: { name: 'raw-modern', version: '0.1.0' }
  };
  const modern = await exchangeRaw([
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
      params: { _meta: modernMeta }
    }
  ]);
  for (const result of [legacy, modern]) {
    expect(result.lines.length).toBeGreaterThan(0);
    for (const line of result.lines) {
      expect(() => {
        parseJson(line);
      }).not.toThrow();
      expect(parseJson(line)).toMatchObject({ jsonrpc: '2.0' });
    }
    expect(result.stderr).not.toContain(SENTINEL);
    expect(result.lines.join('\n')).not.toContain(SENTINEL);
  }
});

it.each(['SIGINT', 'SIGTERM'] as const)(
  '%s closes the owned process and exits promptly',
  async (signal) => {
    const child = spawnMain();
    let stdout = '';
    let stderr = '';
    let pending = '';
    const responses: unknown[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      pending += chunk.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line.length > 0) responses.push(JSON.parse(line) as unknown);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'signal-test', version: '0.1.0' }
        }
      })}\n`
    );
    await expect
      .poll(
        () =>
          responses.some(
            (response) =>
              typeof response === 'object' &&
              response !== null &&
              Reflect.get(response, 'id') === 99
          ),
        { timeout: 3000 }
      )
      .toBe(true);
    child.kill(signal);
    const exit = await Promise.race([
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once('exit', (code, exitSignal) => {
          resolve({ code, signal: exitSignal });
        });
      }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error(`${signal} shutdown timed out`));
        }, 2000).unref();
      })
    ]);
    rawChildren.delete(child);
    expect(exit).toEqual({ code: 0, signal: null });
    for (const line of stdout.trim().split('\n')) {
      expect(() => {
        parseJson(line);
      }).not.toThrow();
    }
    expect(stderr).not.toContain(SENTINEL);
  }
);

it('aggregates recorded probe/server failures with runtime failure and closes each owner once', async () => {
  const probeFailure = new Error('probe-close');
  const serverFailure = new Error('server-close');
  const runtimeFailure = new Error('runtime-close');
  const synchronousServerFailure = new Error('synchronous-server-close');
  const serverClose = vi.fn(() => {
    throw synchronousServerFailure;
  });
  const runtimeClose = vi.fn(() => Promise.reject(runtimeFailure));
  const close = createStdioAggregateClose(serverClose, runtimeClose, () => [
    probeFailure,
    serverFailure
  ]);
  const first = close();
  const second = close();
  expect(first).toBe(second);
  const error = await first.catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors).toEqual([
    probeFailure,
    serverFailure,
    synchronousServerFailure,
    runtimeFailure
  ]);
  expect(serverClose).toHaveBeenCalledTimes(1);
  expect(runtimeClose).toHaveBeenCalledTimes(1);
  await expect(close()).rejects.toBe(error);
});

it('awaits and aggregates owned runtime cleanup when stdio construction throws', async () => {
  const startupFailure = new Error('serve-start');
  const runtimeFailure = new Error('runtime-close');
  const runtimeClose = vi.fn(() => {
    throw runtimeFailure;
  });
  const testConfig: RuntimeConfig = {
    readOnly: true,
    allowedResourceScopes: null,
    enabledFeatureFlags: new Set(),
    requestStateKey: new TextEncoder().encode('0123456789abcdef0123456789abcdef'),
    http: {
      enabled: false,
      host: '127.0.0.1',
      port: 3000,
      allowedHosts: ['127.0.0.1'],
      allowedOrigins: [],
      legacySseEnabled: false
    }
  };
  const dependencies: StdioRuntimeDependencies = {
    createDefaultRuntime: () => ({
      application: createApplicationContext(testConfig),
      close: runtimeClose
    }),
    serve: () => {
      throw startupFailure;
    }
  };
  const error = await startStdioWithDependencies(undefined, {}, dependencies).catch(
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors).toEqual([startupFailure, runtimeFailure]);
  expect(runtimeClose).toHaveBeenCalledTimes(1);
});

it('records a discovery-probe close failure through the configured serve onerror path', async () => {
  const probeFailure = new Error('discovery-probe-close');
  const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const serverClose = vi.fn(() => Promise.resolve());
  const dependencies: StdioRuntimeDependencies = {
    createDefaultRuntime: () => {
      throw new Error('unexpected default runtime');
    },
    serve: ((factory, options) => {
      expect(factory).toBeTypeOf('function');
      options?.onerror?.(probeFailure);
      return { close: serverClose };
    }) as StdioRuntimeDependencies['serve']
  };
  const application = createApplicationContext({
    readOnly: true,
    allowedResourceScopes: null,
    enabledFeatureFlags: new Set(),
    requestStateKey: new TextEncoder().encode('0123456789abcdef0123456789abcdef'),
    http: {
      enabled: false,
      host: '127.0.0.1',
      port: 3000,
      allowedHosts: ['127.0.0.1'],
      allowedOrigins: [],
      legacySseEnabled: false
    }
  });
  const handle = await startStdioWithDependencies(application, {}, dependencies);
  const error = await handle.close().catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors).toEqual([probeFailure]);
  expect(serverClose).toHaveBeenCalledTimes(1);
  expect(write.mock.calls.flat().join('')).toBe('Error\n');
});

it('writes only diagnostic error names to stderr', async () => {
  const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const input = new PassThrough();
  const output = new PassThrough();
  const transport = new StdioServerTransport(input, output);
  const handle = await startStdioWithOptions(undefined, { transport });
  transport.onerror?.(new Error(SENTINEL));
  await expect(handle.close()).rejects.toBeInstanceOf(AggregateError);
  expect(write.mock.calls.flat().join('')).toContain('Error');
  expect(write.mock.calls.flat().join('')).not.toContain(SENTINEL);
});

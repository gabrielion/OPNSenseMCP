// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import type { ElicitResult } from '@modelcontextprotocol/client';
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  createMcpHandler,
  type AuthInfo,
  type McpHttpHandler
} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  createApplicationContext,
  settleApplicationConfirmation
} from '../../src/app/application-context.js';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import { defineCapability } from '../../src/capabilities/kernel.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';
import { createServerFactory } from '../../src/mcp/server-factory.js';
import { ConfirmationStateSchema } from '../../src/mcp/confirmation.js';
import { createMutationFixture, createReadFixture } from '../fixtures/capabilities.js';
import { connectModern, MCP_ERAS } from '../helpers/connect.js';

function config(): RuntimeConfig {
  return {
    readOnly: false,
    allowedResourceScopes: null,
    enabledFeatureFlags: new Set(),
    requestStateKey: new TextEncoder().encode('0123456789abcdef0123456789abcdef'),
    http: {
      enabled: true,
      host: '127.0.0.1',
      port: 3000,
      allowedHosts: ['localhost'],
      allowedOrigins: [],
      legacySseEnabled: false,
      token: 'HTTP_TOKEN_SENTINEL_DO_NOT_LEAK_123'
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createNestedMutation(
  onCall: () => void,
  id = 'test.nested.write',
  name = 'nested_write',
  policy: {
    readonly resourceScopes?: readonly string[];
    readonly requiredFeatureFlags?: readonly ('advanced-api' | 'restore' | 'shell' | 'ssh')[];
  } = {}
) {
  return defineCapability({
    id,
    mcpName: name,
    title: 'Nested test write',
    description: 'Exercise signed confirmation with nested input.',
    inputSchema: z.object({ change: z.object({ value: z.string() }).strict() }).strict(),
    outputSchema: z.object({ accepted: z.string() }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    transports: ['stdio', 'http'],
    policy: {
      effect: 'local-write',
      resourceScopes: policy.resourceScopes ?? ['test.write'],
      requiredFeatureFlags: policy.requiredFeatureFlags ?? [],
      backup: 'none',
      audit: 'none',
      confirmation: 'elicitation',
      timeoutMs: 1000,
      redactFields: ['secret']
    },
    handler: ({ change }) => {
      onCall();
      return Promise.resolve({ accepted: change.value });
    }
  });
}

const AUTH_A: AuthInfo = { token: 'AUTH_TOKEN_A_SENTINEL', clientId: 'client-a', scopes: [] };
const AUTH_B: AuthInfo = { token: 'AUTH_TOKEN_B_SENTINEL', clientId: 'client-b', scopes: [] };

async function rawModernCall(
  handler: McpHttpHandler,
  id: number,
  name: string,
  argumentsValue: unknown,
  options: {
    readonly requestState?: string;
    readonly inputResponses?: Record<string, unknown>;
    readonly capabilities?: Record<string, unknown>;
    readonly authInfo?: AuthInfo;
  } = {}
): Promise<Record<string, unknown>> {
  const meta = {
    [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
    [CLIENT_INFO_META_KEY]: { name: 'raw-test-client', version: '0.1.0' },
    [CLIENT_CAPABILITIES_META_KEY]: options.capabilities ?? { elicitation: { form: {} } }
  };
  const body = {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: {
      name,
      arguments: argumentsValue,
      _meta: meta,
      ...(options.requestState === undefined ? {} : { requestState: options.requestState }),
      ...(options.inputResponses === undefined ? {} : { inputResponses: options.inputResponses })
    }
  };
  const response = await handler.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': name
      },
      body: JSON.stringify(body)
    }),
    options.authInfo === undefined ? {} : { authInfo: options.authInfo }
  );
  const decoded: unknown = await response.json();
  if (!isRecord(decoded)) throw new Error('Expected a JSON-RPC object');
  return decoded;
}

function requestStateFrom(response: Record<string, unknown>): string {
  const result = response.result;
  if (!isRecord(result) || typeof result.requestState !== 'string') {
    throw new Error('Expected input-required requestState');
  }
  return result.requestState;
}

function acceptedResponse(): Record<string, unknown> {
  return { confirmation: { action: 'accept', content: { confirm: true } } };
}

function handlerCallSucceeded(response: Record<string, unknown>): boolean {
  const result = response.result;
  return isRecord(result) && result.isError !== true && isRecord(result.structuredContent);
}

function claimsFromState(state: string) {
  const encodedPayload = state.split('.')[1];
  if (encodedPayload === undefined) throw new Error('Malformed signed state');
  const envelope: unknown = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  if (!isRecord(envelope)) throw new Error('Malformed signed envelope');
  return ConfirmationStateSchema.parse(envelope.p);
}

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function mutateRequestStateMac(
  state: string,
  mode: 'equivalent-non-canonical' | 'different-bytes'
): string {
  const segments = state.split('.');
  const prefix = segments[0];
  const body = segments[1];
  const mac = segments[2];
  if (segments.length !== 3 || prefix === undefined || body === undefined || mac === undefined) {
    throw new Error('Malformed signed state');
  }
  const decodedMac = Buffer.from(mac, 'base64url');
  const replacement = Array.from(BASE64URL_ALPHABET)
    .map((character) => `${mac.slice(0, -1)}${character}`)
    .find((candidate) => {
      if (candidate === mac) return false;
      const decodedCandidate = Buffer.from(candidate, 'base64url');
      const candidateIsCanonical = decodedCandidate.toString('base64url') === candidate;
      return mode === 'equivalent-non-canonical'
        ? decodedCandidate.equals(decodedMac) && !candidateIsCanonical
        : !decodedCandidate.equals(decodedMac) && candidateIsCanonical;
    });
  if (replacement === undefined) throw new Error('Could not mutate signed state');
  return `${prefix}.${body}.${replacement}`;
}

describe.each(MCP_ERAS)('$label one-shot confirmation [$continuationSurface]', ({ connect }) => {
  it.each([
    ['accept', { action: 'accept', content: { confirm: true } }, 1],
    ['decline', { action: 'decline' }, 0],
    ['cancel', { action: 'cancel' }, 0],
    ['confirm false', { action: 'accept', content: { confirm: false } }, 0],
    ['malformed acceptance', { action: 'accept', content: { confirm: 'yes' } }, 0]
  ] as const)(
    '%s executes the handler expected number of times',
    async (_label, response, calls) => {
      const onCall = vi.fn();
      const mutation = createMutationFixture(onCall);
      const application = createApplicationContext(config(), new CapabilityCatalog([mutation]));
      let elicitationCount = 0;
      let requestText = '';
      const connection = await connect(application, {
        capabilities: { elicitation: { form: {} } }
      });
      connection.client.setRequestHandler('elicitation/create', (request) => {
        elicitationCount += 1;
        requestText = request.params.message;
        return Promise.resolve(response as ElicitResult);
      });
      try {
        const result = await connection.client.callTool({
          name: mutation.mcpName,
          arguments: { value: 'nested-safe' }
        });
        expect(elicitationCount).toBe(1);
        expect(requestText).toBe('Apply this exact OPNsense change?');
        expect(onCall).toHaveBeenCalledTimes(calls);
        if (calls === 1) {
          expect(result.structuredContent).toEqual({ accepted: 'nested-safe' });
        } else {
          expect(result.isError).toBe(true);
        }
        const serialized = JSON.stringify(result);
        for (const secret of ['HTTP_TOKEN_SENTINEL_DO_NOT_LEAK_123', '0123456789abcdef']) {
          expect(serialized).not.toContain(secret);
        }
      } finally {
        await connection.close();
      }
    }
  );

  it('refuses absent or URL-only form support without invoking a handler', async () => {
    const onCall = vi.fn();
    const mutation = createMutationFixture(onCall);
    for (const elicitation of [undefined, { url: {} }]) {
      const connection = await connect(
        createApplicationContext(config(), new CapabilityCatalog([mutation])),
        { capabilities: elicitation === undefined ? {} : { elicitation } }
      );
      try {
        const result = await connection.client.callTool({
          name: mutation.mcpName,
          arguments: { value: 'safe' }
        });
        expect(result).toMatchObject({
          isError: true,
          structuredContent: { code: 'CONFIRMATION_UNAVAILABLE' }
        });
      } finally {
        await connection.close();
      }
    }
    expect(onCall).not.toHaveBeenCalled();
  });

  it('refuses a nested caller mutation during the round without executing the handler', async () => {
    const onCall = vi.fn();
    const mutation = createNestedMutation(onCall);
    const application = createApplicationContext(config(), new CapabilityCatalog([mutation]));
    const callerArguments = { change: { value: 'safe-before-round' } };
    const connection = await connect(application, {
      capabilities: { elicitation: { form: {} } }
    });
    connection.client.setRequestHandler('elicitation/create', () => {
      callerArguments.change.value = 'mutated-by-caller-during-round';
      return Promise.resolve({ action: 'accept', content: { confirm: true } });
    });
    try {
      const result = await connection.client.callTool({
        name: mutation.mcpName,
        arguments: callerArguments
      });
      expect(result).toMatchObject({
        isError: true,
        structuredContent: { code: 'CONFIRMATION_INVALID' }
      });
      expect(onCall).not.toHaveBeenCalled();
      expect(callerArguments.change.value).toBe('mutated-by-caller-during-round');
    } finally {
      await connection.close();
    }
  });

  it('keeps runtime secrets and internal authority labels out of common round payloads', async () => {
    const mutation = createNestedMutation(() => undefined);
    const application = createApplicationContext(config(), new CapabilityCatalog([mutation]));
    const observedRequests: unknown[] = [];
    const connection = await connect(application, {
      capabilities: { elicitation: { form: {} } }
    });
    connection.client.setRequestHandler('elicitation/create', (request) => {
      observedRequests.push(request);
      return Promise.resolve({ action: 'accept', content: { confirm: true } });
    });
    try {
      const result = await connection.client.callTool({
        name: mutation.mcpName,
        arguments: { change: { value: 'safe' } }
      });
      const payload = JSON.stringify({ observedRequests, result });
      for (const forbidden of [
        'HTTP_TOKEN_SENTINEL_DO_NOT_LEAK_123',
        '0123456789abcdef0123456789abcdef',
        'handler',
        'dispatcher',
        'settlement',
        'ledger',
        'inputSchema',
        'outputSchema'
      ]) {
        expect(payload).not.toContain(forbidden);
      }
    } finally {
      await connection.close();
    }
  });
});

describe('2026-only raw continuation security (the 2025 shim exposes neither requestState nor tool substitution)', () => {
  it('consumes a valid continuation redirected to an unknown tool while preserving the fixed refusal', async () => {
    const writeHandler = vi.fn();
    const mutation = createNestedMutation(writeHandler);
    const handler = createMcpHandler(
      createServerFactory(
        createApplicationContext(config(), new CapabilityCatalog([mutation])),
        'http'
      )
    );
    try {
      const writeArguments = { change: { value: 'safe' } };
      const state = requestStateFrom(
        await rawModernCall(handler, 1, mutation.mcpName, writeArguments)
      );
      const redirected = await rawModernCall(
        handler,
        2,
        'forged_cached_tool',
        { ignored: 'safe' },
        { requestState: state, inputResponses: acceptedResponse() }
      );
      const replay = await rawModernCall(handler, 3, mutation.mcpName, writeArguments, {
        requestState: state,
        inputResponses: acceptedResponse()
      });

      expect(redirected.result).toEqual({
        resultType: 'complete',
        isError: true,
        content: [{ type: 'text', text: 'Capability is not available.' }],
        structuredContent: { code: 'UNKNOWN_CAPABILITY' }
      });
      expect(handlerCallSucceeded(replay)).toBe(false);
      expect(writeHandler).not.toHaveBeenCalled();
    } finally {
      await handler.close();
    }
  });

  it('consumes a confirmed write continuation sent to a non-eliciting read without executing either tool', async () => {
    const writeHandler = vi.fn();
    const readHandler = vi.fn();
    const mutation = createNestedMutation(writeHandler);
    const read = createReadFixture({
      id: 'test.cross-tool.read',
      mcpName: 'cross_tool_read',
      handler: ({ value }) => {
        readHandler();
        return Promise.resolve({ echoed: value });
      }
    });
    const handler = createMcpHandler(
      createServerFactory(
        createApplicationContext(config(), new CapabilityCatalog([mutation, read])),
        'http'
      )
    );
    try {
      const writeArguments = { change: { value: 'safe' } };
      const state = requestStateFrom(
        await rawModernCall(handler, 1, mutation.mcpName, writeArguments)
      );
      const redirected = await rawModernCall(
        handler,
        2,
        read.mcpName,
        { value: 'must-not-run' },
        { requestState: state, inputResponses: acceptedResponse() }
      );
      const replay = await rawModernCall(handler, 3, mutation.mcpName, writeArguments, {
        requestState: state,
        inputResponses: acceptedResponse()
      });

      expect(handlerCallSucceeded(redirected)).toBe(false);
      expect(handlerCallSucceeded(replay)).toBe(false);
      expect(readHandler).not.toHaveBeenCalled();
      expect(writeHandler).not.toHaveBeenCalled();
    } finally {
      await handler.close();
    }
  });

  it.each([
    ['bare input response', acceptedResponse()],
    [
      'dropped wrapped response',
      { confirmation: { method: 'elicitation/create', result: { action: 'accept' } } }
    ]
  ] as const)('refuses orphan %s on a non-eliciting read', async (_label, inputResponses) => {
    const readHandler = vi.fn();
    const read = createReadFixture({
      id: 'test.orphan-continuation.read',
      mcpName: 'orphan_continuation_read',
      handler: ({ value }) => {
        readHandler();
        return Promise.resolve({ echoed: value });
      }
    });
    const handler = createMcpHandler(
      createServerFactory(createApplicationContext(config(), new CapabilityCatalog([read])), 'http')
    );
    try {
      const response = await rawModernCall(
        handler,
        1,
        read.mcpName,
        { value: 'must-not-run' },
        { inputResponses }
      );
      expect(handlerCallSucceeded(response)).toBe(false);
      expect(JSON.stringify(response)).toContain('CONFIRMATION_INVALID');
      expect(readHandler).not.toHaveBeenCalled();
    } finally {
      await handler.close();
    }
  });

  it('executes exactly once under sequential and concurrent replay', async () => {
    for (const concurrent of [false, true]) {
      const onCall = vi.fn();
      const mutation = createNestedMutation(onCall);
      const application = createApplicationContext(config(), new CapabilityCatalog([mutation]));
      const handler = createMcpHandler(createServerFactory(application, 'http'));
      try {
        const initial = await rawModernCall(handler, 1, mutation.mcpName, {
          change: { value: 'safe' }
        });
        const requestState = requestStateFrom(initial);
        const invoke = (id: number) =>
          rawModernCall(
            handler,
            id,
            mutation.mcpName,
            { change: { value: 'safe' } },
            { requestState, inputResponses: acceptedResponse() }
          );
        const responses = concurrent
          ? await Promise.all([invoke(2), invoke(3)])
          : [await invoke(2), await invoke(3)];
        expect(responses.filter(handlerCallSucceeded)).toHaveLength(1);
        expect(onCall).toHaveBeenCalledTimes(1);
      } finally {
        await handler.close();
      }
    }
  });

  it.each([
    ['missing', undefined],
    [
      'dropped wrapper',
      { confirmation: { method: 'elicitation/create', result: { action: 'accept' } } }
    ],
    [
      'malformed accepted content',
      { confirmation: { action: 'accept', content: { confirm: 'yes' } } }
    ]
  ] as const)(
    '%s response consumes the known challenge and cannot be replayed',
    async (_label, inputResponses) => {
      const onCall = vi.fn();
      const mutation = createNestedMutation(onCall);
      const handler = createMcpHandler(
        createServerFactory(
          createApplicationContext(config(), new CapabilityCatalog([mutation])),
          'http'
        )
      );
      try {
        const args = { change: { value: 'safe' } };
        const state = requestStateFrom(await rawModernCall(handler, 1, mutation.mcpName, args));
        const declined = await rawModernCall(handler, 2, mutation.mcpName, args, {
          requestState: state,
          ...(inputResponses === undefined ? {} : { inputResponses })
        });
        const replay = await rawModernCall(handler, 3, mutation.mcpName, args, {
          requestState: state,
          inputResponses: acceptedResponse()
        });
        expect(handlerCallSucceeded(declined)).toBe(false);
        expect(handlerCallSucceeded(replay)).toBe(false);
        expect(onCall).not.toHaveBeenCalled();
      } finally {
        await handler.close();
      }
    }
  );

  it('consumes a valid state used with changed nested arguments or the wrong capability', async () => {
    for (const mismatch of ['arguments', 'capability'] as const) {
      const onCall = vi.fn();
      const first = createNestedMutation(onCall);
      const second = createNestedMutation(onCall, 'test.other.write', 'other_write');
      const handler = createMcpHandler(
        createServerFactory(
          createApplicationContext(config(), new CapabilityCatalog([first, second])),
          'http'
        )
      );
      try {
        const original = { change: { value: 'safe' } };
        const state = requestStateFrom(await rawModernCall(handler, 1, first.mcpName, original));
        original.change.value = 'mutated-after-challenge';
        const mismatched = await rawModernCall(
          handler,
          2,
          mismatch === 'capability' ? second.mcpName : first.mcpName,
          mismatch === 'arguments' ? original : { change: { value: 'safe' } },
          { requestState: state, inputResponses: acceptedResponse() }
        );
        const replay = await rawModernCall(
          handler,
          3,
          first.mcpName,
          { change: { value: 'safe' } },
          { requestState: state, inputResponses: acceptedResponse() }
        );
        expect(handlerCallSucceeded(mismatched)).toBe(false);
        expect(handlerCallSucceeded(replay)).toBe(false);
        expect(onCall).not.toHaveBeenCalled();
      } finally {
        await handler.close();
      }
    }
  });

  it.each(['non-canonical', 'tampered', 'unsigned', 'malformed'] as const)(
    '%s state is rejected before settlement and leaves the genuine state usable once',
    async (kind) => {
      const onCall = vi.fn();
      const mutation = createNestedMutation(onCall);
      const handler = createMcpHandler(
        createServerFactory(
          createApplicationContext(config(), new CapabilityCatalog([mutation])),
          'http'
        )
      );
      try {
        const args = { change: { value: 'safe' } };
        const state = requestStateFrom(await rawModernCall(handler, 1, mutation.mcpName, args));
        const invalid =
          kind === 'non-canonical'
            ? mutateRequestStateMac(state, 'equivalent-non-canonical')
            : kind === 'tampered'
              ? mutateRequestStateMac(state, 'different-bytes')
              : kind === 'unsigned'
                ? (state.split('.')[1] ?? 'unsigned')
                : 'not-a-request-state';
        const rejected = await rawModernCall(handler, 2, mutation.mcpName, args, {
          requestState: invalid,
          inputResponses: acceptedResponse()
        });
        const genuine = await rawModernCall(handler, 3, mutation.mcpName, args, {
          requestState: state,
          inputResponses: acceptedResponse()
        });
        expect(rejected.error).toBeDefined();
        expect(handlerCallSucceeded(genuine)).toBe(true);
        expect(onCall).toHaveBeenCalledTimes(1);
      } finally {
        await handler.close();
      }
    }
  );

  it('binds state to the exact authenticated principal', async () => {
    const onCall = vi.fn();
    const mutation = createNestedMutation(onCall);
    const handler = createMcpHandler(
      createServerFactory(
        createApplicationContext(config(), new CapabilityCatalog([mutation])),
        'http'
      )
    );
    try {
      const args = { change: { value: 'safe' } };
      const state = requestStateFrom(
        await rawModernCall(handler, 1, mutation.mcpName, args, { authInfo: AUTH_A })
      );
      const wrongPrincipal = await rawModernCall(handler, 2, mutation.mcpName, args, {
        requestState: state,
        inputResponses: acceptedResponse(),
        authInfo: AUTH_B
      });
      const correctPrincipal = await rawModernCall(handler, 3, mutation.mcpName, args, {
        requestState: state,
        inputResponses: acceptedResponse(),
        authInfo: AUTH_A
      });
      expect(wrongPrincipal.error).toBeDefined();
      expect(handlerCallSucceeded(correctPrincipal)).toBe(true);
      expect(onCall).toHaveBeenCalledTimes(1);
    } finally {
      await handler.close();
    }
  });

  it.each([
    ['transport', { transport: 'stdio' as const, principalId: 'stdio:local-connection' }],
    ['principal', { transport: 'http' as const, principalId: 'client-b' }]
  ])('kernel settlement consumes a known state with wrong %s binding', async (_label, binding) => {
    const onCall = vi.fn();
    const mutation = createNestedMutation(onCall);
    const application = createApplicationContext(config(), new CapabilityCatalog([mutation]));
    const handler = createMcpHandler(createServerFactory(application, 'http'));
    try {
      const args = { change: { value: 'safe' } };
      const state = requestStateFrom(
        await rawModernCall(handler, 1, mutation.mcpName, args, { authInfo: AUTH_A })
      );
      const claims = claimsFromState(state);
      const mismatched = await settleApplicationConfirmation(
        application,
        'accept',
        claims,
        { name: mutation.mcpName, arguments: args },
        binding
      );
      const replay = await rawModernCall(handler, 2, mutation.mcpName, args, {
        requestState: state,
        inputResponses: acceptedResponse(),
        authInfo: AUTH_A
      });
      expect(mismatched).toMatchObject({ kind: 'refused', code: 'CONFIRMATION_INVALID' });
      expect(handlerCallSucceeded(replay)).toBe(false);
      expect(onCall).not.toHaveBeenCalled();
    } finally {
      await handler.close();
    }
  });

  it('rejects expired signed state and never invokes the handler', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const onCall = vi.fn();
    const mutation = createNestedMutation(onCall);
    const handler = createMcpHandler(
      createServerFactory(
        createApplicationContext(config(), new CapabilityCatalog([mutation])),
        'http'
      )
    );
    try {
      const args = { change: { value: 'safe' } };
      const state = requestStateFrom(await rawModernCall(handler, 1, mutation.mcpName, args));
      vi.setSystemTime(new Date('2030-01-01T00:05:01Z'));
      const expired = await rawModernCall(handler, 2, mutation.mcpName, args, {
        requestState: state,
        inputResponses: acceptedResponse()
      });
      expect(expired.error).toBeDefined();
      expect(onCall).not.toHaveBeenCalled();
    } finally {
      await handler.close();
      vi.useRealTimers();
    }
  });

  it('treats a present modern envelope without form support as authoritative', async () => {
    const onCall = vi.fn();
    const mutation = createNestedMutation(onCall);
    const handler = createMcpHandler(
      createServerFactory(
        createApplicationContext(config(), new CapabilityCatalog([mutation])),
        'http'
      )
    );
    try {
      for (const capabilities of [{}, { elicitation: { url: {} } }]) {
        const response = await rawModernCall(
          handler,
          1,
          mutation.mcpName,
          { change: { value: 'safe' } },
          { capabilities }
        );
        expect(requestStateFrom.bind(undefined, response)).toThrow();
        expect(JSON.stringify(response)).toContain('CONFIRMATION_UNAVAILABLE');
      }
      expect(onCall).not.toHaveBeenCalled();
    } finally {
      await handler.close();
    }
  });

  it('keeps definitions, authority, ledger data, runtime keys, and sentinel secrets out of payloads', async () => {
    const mutation = createNestedMutation(() => undefined);
    const runtime = config();
    const handler = createMcpHandler(
      createServerFactory(
        createApplicationContext(runtime, new CapabilityCatalog([mutation])),
        'http'
      )
    );
    try {
      const initial = await rawModernCall(
        handler,
        1,
        mutation.mcpName,
        { change: { value: 'safe' } },
        { authInfo: AUTH_A }
      );
      const state = requestStateFrom(initial);
      const success = await rawModernCall(
        handler,
        2,
        mutation.mcpName,
        { change: { value: 'safe' } },
        { requestState: state, inputResponses: acceptedResponse(), authInfo: AUTH_A }
      );
      const payload = JSON.stringify({ initial, success });
      for (const forbidden of [
        'HTTP_TOKEN_SENTINEL_DO_NOT_LEAK_123',
        'AUTH_TOKEN_A_SENTINEL',
        '0123456789abcdef0123456789abcdef',
        'handler',
        'dispatcher',
        'settlement',
        'ledger',
        'inputSchema',
        'outputSchema'
      ]) {
        expect(payload).not.toContain(forbidden);
      }
    } finally {
      await handler.close();
    }
  });
});

it('keeps policy gates, listing, and a pre-mutation signed state stable across fresh servers', async () => {
  const allowedResourceScopes = new Set(['test.write']);
  const enabledFeatureFlags = new Set<'shell' | 'ssh' | 'restore' | 'advanced-api'>(['shell']);
  const runtime = {
    ...config(),
    allowedResourceScopes,
    enabledFeatureFlags
  } satisfies RuntimeConfig;
  const onCall = vi.fn();
  const mutation = createNestedMutation(onCall, 'test.snapshot.write', 'snapshot_write', {
    resourceScopes: ['test.write'],
    requiredFeatureFlags: ['shell']
  });
  const application = createApplicationContext(runtime, new CapabilityCatalog([mutation]));
  const argumentsValue = { change: { value: 'safe' } };
  const mintingServer = createMcpHandler(createServerFactory(application, 'http'));
  let signedState: string;
  try {
    signedState = requestStateFrom(
      await rawModernCall(mintingServer, 1, mutation.mcpName, argumentsValue)
    );
  } finally {
    await mintingServer.close();
  }

  allowedResourceScopes.clear();
  allowedResourceScopes.add('forged');
  enabledFeatureFlags.clear();
  runtime.requestStateKey.fill(0);
  Reflect.set(runtime, 'readOnly', true);

  const listingConnection = await connectModern(application);
  try {
    expect((await listingConnection.client.listTools()).tools.map(({ name }) => name)).toContain(
      mutation.mcpName
    );
  } finally {
    await listingConnection.close();
  }

  const settlingServer = createMcpHandler(createServerFactory(application, 'http'));
  try {
    const success = await rawModernCall(settlingServer, 2, mutation.mcpName, argumentsValue, {
      requestState: signedState,
      inputResponses: acceptedResponse()
    });
    expect(handlerCallSucceeded(success)).toBe(true);
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(Object.getOwnPropertyNames(application)).toEqual(['catalog']);
    expect(Object.getOwnPropertySymbols(application)).toEqual([]);
  } finally {
    await settlingServer.close();
  }
});

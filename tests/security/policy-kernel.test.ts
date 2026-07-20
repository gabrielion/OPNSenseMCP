// SPDX-License-Identifier: AGPL-3.0-or-later
import { getEventListeners } from 'node:events';
import * as z from 'zod/v4';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import {
  createCapabilityDispatcher,
  defineCapability,
  type CapabilityCatalogView,
  type CapabilityKernelRuntime,
  type CapabilityPolicyOptions,
  type ConfirmationClaims,
  type ConfirmationCompletion,
  type ConfirmationDecision,
  type TypedCapabilityDefinition
} from '../../src/capabilities/kernel.js';
import type {
  CapabilityDefinition,
  CapabilityDispatcher,
  CapabilityExecutionContext,
  CapabilityInvocationContext,
  CapabilityRequest,
  CapabilityResult,
  CapabilityEffect,
  ConfirmationPolicy,
  RefusalCode,
  TransportKind
} from '../../src/capabilities/types.js';
import type { FeatureFlag } from '../../src/config/feature-flags.js';

const REFUSAL_MESSAGES: Readonly<Record<RefusalCode, string>> = Object.freeze({
  BACKUP_FAILED: 'Capability refused: a strict verified backup could not be created.',
  CANCELLED: 'Capability execution was cancelled.',
  CONFIRMATION_DECLINED: 'Capability confirmation was declined.',
  CONFIRMATION_INVALID: 'Capability confirmation is invalid.',
  CONFIRMATION_UNAVAILABLE: 'Capability confirmation is unavailable.',
  EXECUTION_FAILED: 'Capability execution failed.',
  FEATURE_DISABLED: 'A required capability feature is disabled.',
  INVALID_INPUT: 'Capability input is invalid.',
  INVALID_OUTPUT: 'Capability output is invalid.',
  INVALID_POLICY: 'Capability policy is invalid.',
  INVALID_RESOURCE_INPUT: 'Resource input is invalid.',
  LOCK_UNAVAILABLE: 'Capability refused: the target mutation lock is unavailable.',
  OPERATION_NOT_AVAILABLE: 'Resource operation is not available.',
  OUTCOME_INDETERMINATE:
    'Capability outcome is indeterminate; the pre-change backup is preserved. Do not retry blindly: reconcile the target state against the preserved backup before any further change.',
  OUTCOME_UNVERIFIED:
    'Capability outcome could not be verified; the pre-change backup is preserved. Reconcile the target state against the preserved backup before any further change.',
  PREFLIGHT_FAILED: 'Capability refused: the read-only preflight failed.',
  READ_ONLY: 'Capability is disabled in read-only mode.',
  RESOURCE_NOT_ALLOWED: 'Capability resource scope is not allowed.',
  STATE_REVALIDATION_FAILED: 'Capability refused: the target state changed after preflight.',
  TIMEOUT: 'Capability execution timed out.',
  TARGET_UNAVAILABLE: 'OPNsense target is unavailable.',
  UNKNOWN_CAPABILITY: 'Capability is not available.',
  UNKNOWN_RESOURCE: 'Resource is not available.',
  UNSUPPORTED_TRANSPORT: 'Capability is not available on this transport.'
});

interface FixtureOptions {
  readonly id?: string;
  readonly mcpName?: string;
  readonly effect?: CapabilityEffect;
  readonly transports?: readonly TransportKind[];
  readonly resourceScopes?: readonly string[];
  readonly requiredFeatureFlags?: readonly FeatureFlag[];
  readonly confirmation?: ConfirmationPolicy;
  readonly timeoutMs?: number;
  readonly inputSchema?: z.ZodType<Record<string, unknown>>;
  readonly outputSchema?: z.ZodType<Record<string, unknown>>;
  readonly handler?: (
    input: Record<string, unknown>,
    context: CapabilityExecutionContext
  ) => Promise<Record<string, unknown>>;
}

function createKernelDefinition(
  options: FixtureOptions = {}
): TypedCapabilityDefinition<Record<string, unknown>, Record<string, unknown>> {
  const inputSchema =
    options.inputSchema ??
    (z.object({ value: z.string() }).strict() as z.ZodType<Record<string, unknown>>);
  const outputSchema =
    options.outputSchema ??
    (z.object({ echoed: z.string() }).strict() as z.ZodType<Record<string, unknown>>);
  const handler =
    options.handler ??
    ((input: Record<string, unknown>) => Promise.resolve({ echoed: input.value }));

  return {
    id: options.id ?? 'kernel.read',
    mcpName: options.mcpName ?? 'kernel_read',
    title: 'Kernel fixture',
    description: 'Exercise the closed policy kernel.',
    inputSchema,
    outputSchema,
    annotations: {
      readOnlyHint: options.effect === undefined || options.effect === 'read',
      destructiveHint: options.effect !== undefined && options.effect !== 'read',
      idempotentHint: true,
      openWorldHint: false
    },
    transports: options.transports ?? ['stdio', 'http'],
    policy: {
      effect: options.effect ?? 'read',
      resourceScopes: options.resourceScopes ?? ['kernel.read'],
      requiredFeatureFlags: options.requiredFeatureFlags ?? [],
      backup: 'none',
      audit: 'none',
      confirmation: options.confirmation ?? 'none',
      timeoutMs: options.timeoutMs ?? 1000,
      redactFields: []
    },
    handler
  };
}

function createKernelFixture(options: FixtureOptions = {}): CapabilityDefinition {
  return defineCapability(createKernelDefinition(options));
}

function policyOptions(overrides: Partial<CapabilityPolicyOptions> = {}): CapabilityPolicyOptions {
  return {
    readOnly: false,
    allowedResourceScopes: null,
    enabledFeatureFlags: new Set(),
    ...overrides
  };
}

function stdioContext(overrides: Partial<CapabilityInvocationContext> = {}) {
  return { transport: 'stdio' as const, ...overrides };
}

function request(name = 'kernel_read', argumentsValue: unknown = { value: 'safe' }) {
  return { name, arguments: argumentsValue } satisfies CapabilityRequest;
}

function expectRefusal(result: CapabilityResult, code: RefusalCode): void {
  expect(result).toEqual({ kind: 'refused', code, message: REFUSAL_MESSAGES[code] });
}

function dispatcherFor(
  definitions: readonly CapabilityDefinition[],
  options: CapabilityPolicyOptions = policyOptions()
) {
  return createCapabilityDispatcher(new CapabilityCatalog(definitions), options);
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolver: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (resolver === undefined) throw new Error('Deferred resolver was not installed');
      resolver(value);
    }
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('closed capability definitions', () => {
  const invalidDefinitionError = /^Invalid capability definition$/;

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1.5, 300_001])(
    'rejects invalid timeout metadata %s synchronously',
    (timeoutMs) => {
      expect(() => createKernelFixture({ timeoutMs })).toThrow(invalidDefinitionError);
    }
  );

  it.each([1, 300_000])('accepts boundary timeout metadata %s', (timeoutMs) => {
    expect(createKernelFixture({ timeoutMs }).policy.timeoutMs).toBe(timeoutMs);
  });

  it.each([
    ['effect', 'observe'],
    ['backup', 'best-effort'],
    ['audit', 'optional'],
    ['confirmation', 'skip-confirmation']
  ] as const)('rejects invalid runtime policy enum %s', (field, invalidValue) => {
    const definition = createKernelDefinition({ effect: 'firewall-write' });
    Reflect.set(definition.policy, field, invalidValue);

    expect(() => defineCapability(definition)).toThrow(invalidDefinitionError);
  });

  it('does not admit an unknown confirmation policy as an unconfirmed write', () => {
    const handler = vi.fn(() => Promise.resolve({ echoed: 'unsafe' }));
    const definition = createKernelDefinition({ effect: 'firewall-write', handler });
    Reflect.set(definition.policy, 'confirmation', 'skip-confirmation');

    expect(() => defineCapability(definition)).toThrow(invalidDefinitionError);
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects a proxied feature array before it can weaken a firewall write', async () => {
    const handler = vi.fn(() => Promise.resolve({ echoed: 'unsafe' }));
    const definition = createKernelDefinition({ effect: 'firewall-write', handler });
    const requiredFeatureFlags = new Proxy<FeatureFlag[]>(['ssh'], {
      get(_target, key) {
        if (key === 'length') return Number.NaN;
        return undefined;
      }
    });
    Reflect.set(definition.policy, 'requiredFeatureFlags', requiredFeatureFlags);

    let admitted: CapabilityDefinition | undefined;
    let admissionError: unknown;
    try {
      admitted = defineCapability(definition);
    } catch (error) {
      admissionError = error;
    }

    let dispatchResult: CapabilityResult | undefined;
    if (admitted !== undefined) {
      dispatchResult = await dispatcherFor([admitted]).dispatch(request(), stdioContext());
    }

    expect(admissionError).toBeInstanceOf(Error);
    expect((admissionError as Error).message).toMatch(invalidDefinitionError);
    expect(admitted).toBeUndefined();
    expect(dispatchResult).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects top-level and policy proxies without consulting their traps', () => {
    const definition = createKernelDefinition();
    const definitionTrap = vi.fn((): unknown => undefined);
    const proxiedDefinition = new Proxy(definition, { get: definitionTrap });

    expect(() => defineCapability(proxiedDefinition)).toThrow(invalidDefinitionError);
    expect(definitionTrap).not.toHaveBeenCalled();

    const policy = definition.policy;
    const policyTrap = vi.fn((target: typeof policy, key: PropertyKey) =>
      Reflect.getOwnPropertyDescriptor(target, key)
    );
    const proxiedPolicy = new Proxy(policy, { getOwnPropertyDescriptor: policyTrap });
    Reflect.set(definition, 'policy', proxiedPolicy);

    expect(() => defineCapability(definition)).toThrow(invalidDefinitionError);
    expect(policyTrap).not.toHaveBeenCalled();
  });

  it('rejects a top-level policy accessor without invoking it', () => {
    const definition = createKernelDefinition();
    const originalPolicy = definition.policy;
    const getter = vi.fn(() => originalPolicy);
    Object.defineProperty(definition, 'policy', {
      configurable: true,
      enumerable: true,
      get: getter
    });

    expect(() => defineCapability(definition)).toThrow(invalidDefinitionError);
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(['id', 'mcpName', 'title', 'description'] as const)(
    'rejects empty or whitespace-only top-level string metadata %s',
    (field) => {
      for (const value of ['', '   ']) {
        const definition = createKernelDefinition();
        Reflect.set(definition, field, value);

        expect(() => defineCapability(definition)).toThrow(invalidDefinitionError);
      }
    }
  );

  it.each([
    { field: 'id', value: 'i'.repeat(257) },
    { field: 'mcpName', value: 'n'.repeat(257) },
    { field: 'title', value: 't'.repeat(257) },
    { field: 'description', value: 'd'.repeat(4097) }
  ] as const)('rejects overlong top-level string metadata $field', ({ field, value }) => {
    const definition = createKernelDefinition();
    Reflect.set(definition, field, value);

    expect(() => defineCapability(definition)).toThrow(invalidDefinitionError);
  });

  it.each([
    { field: 'id', value: 42 },
    { field: 'mcpName', value: null },
    { field: 'title', value: false },
    { field: 'description', value: () => 'description' },
    { field: 'inputSchema', value: null },
    { field: 'outputSchema', value: { parse: 'not-callable' } },
    { field: 'handler', value: 'not-callable' }
  ] as const)('rejects malformed top-level field $field', ({ field, value }) => {
    const definition = createKernelDefinition();
    Reflect.set(definition, field, value);

    expect(() => defineCapability(definition)).toThrow(invalidDefinitionError);
  });

  it('rejects schema and annotations accessors without invoking them', () => {
    const definition = createKernelDefinition();
    const parseGetter = vi.fn(() => (value: unknown) => value);
    const inputSchema = Object.defineProperty({}, 'parse', {
      configurable: true,
      enumerable: true,
      get: parseGetter
    });
    Reflect.set(definition, 'inputSchema', inputSchema);

    expect(() => defineCapability(definition)).toThrow(invalidDefinitionError);
    expect(parseGetter).not.toHaveBeenCalled();

    const annotationsGetter = vi.fn(() => true);
    const annotations = Object.defineProperty({}, 'readOnlyHint', {
      configurable: true,
      enumerable: true,
      get: annotationsGetter
    });
    Reflect.set(definition, 'inputSchema', z.object({ value: z.string() }).strict());
    Reflect.set(definition, 'annotations', annotations);

    expect(() => defineCapability(definition)).toThrow(invalidDefinitionError);
    expect(annotationsGetter).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'scalar annotations', annotations: 'read-only' },
    { label: 'unknown annotation', annotations: { custom: true } },
    { label: 'invalid annotation value', annotations: { readOnlyHint: 'yes' } }
  ] as const)('rejects $label', ({ annotations }) => {
    const definition = createKernelDefinition();
    Reflect.set(definition, 'annotations', annotations);

    expect(() => defineCapability(definition)).toThrow(invalidDefinitionError);
  });

  it('bounds policy metadata arrays and rejects extra array properties', () => {
    const oversizedFlags = Array<FeatureFlag>(129).fill('ssh');
    const oversizedDefinition = createKernelDefinition();
    Reflect.set(oversizedDefinition.policy, 'requiredFeatureFlags', oversizedFlags);

    expect(() => defineCapability(oversizedDefinition)).toThrow(invalidDefinitionError);

    const extraPropertyFlags: FeatureFlag[] = ['ssh'];
    Reflect.set(extraPropertyFlags, 'extra', 'unsafe');
    const extraPropertyDefinition = createKernelDefinition();
    Reflect.set(extraPropertyDefinition.policy, 'requiredFeatureFlags', extraPropertyFlags);

    expect(() => defineCapability(extraPropertyDefinition)).toThrow(invalidDefinitionError);
  });

  it('rejects extra top-level and policy fields', () => {
    const topLevelDefinition = createKernelDefinition();
    Reflect.set(topLevelDefinition, 'unexpected', true);
    expect(() => defineCapability(topLevelDefinition)).toThrow(invalidDefinitionError);

    const policyDefinition = createKernelDefinition();
    Reflect.set(policyDefinition.policy, 'unexpected', true);
    expect(() => defineCapability(policyDefinition)).toThrow(invalidDefinitionError);
  });

  it.each([{ transports: ['websocket'] }, { transports: ['stdio', 'websocket'] }])(
    'rejects invalid runtime transports $transports',
    ({ transports }) => {
      const definition = createKernelDefinition();
      Reflect.set(definition, 'transports', transports);

      expect(() => defineCapability(definition)).toThrow(invalidDefinitionError);
    }
  );

  it.each([
    { field: 'transports', value: 'stdio' },
    { field: 'transports', value: new Set(['stdio']) },
    { field: 'resourceScopes', value: 'kernel.read' },
    { field: 'requiredFeatureFlags', value: new Set(['ssh']) },
    { field: 'redactFields', value: null }
  ] as const)('rejects non-array runtime shape for $field', ({ field, value }) => {
    const definition = createKernelDefinition();
    if (field === 'transports') Reflect.set(definition, field, value);
    else Reflect.set(definition.policy, field, value);

    expect(() => defineCapability(definition)).toThrow(invalidDefinitionError);
  });

  it.each([
    { field: 'resourceScopes', value: [42] },
    { field: 'requiredFeatureFlags', value: ['unknown-feature'] },
    { field: 'redactFields', value: [null] }
  ] as const)('rejects invalid $field array members', ({ field, value }) => {
    const definition = createKernelDefinition();
    Reflect.set(definition.policy, field, value);

    expect(() => defineCapability(definition)).toThrow(invalidDefinitionError);
  });

  it.each(['transports', 'resourceScopes', 'requiredFeatureFlags', 'redactFields'] as const)(
    'rejects sparse $field arrays',
    (field) => {
      const sparse = new Array<string>(1);
      const definition = createKernelDefinition();
      if (field === 'transports') Reflect.set(definition, field, sparse);
      else Reflect.set(definition.policy, field, sparse);

      expect(() => defineCapability(definition)).toThrow(invalidDefinitionError);
    }
  );

  it.each([{ policy: null }, { policy: [] }, { policy: 'policy' }])(
    'rejects invalid policy container $policy',
    ({ policy }) => {
      const definition = createKernelDefinition();
      Reflect.set(definition, 'policy', policy);

      expect(() => defineCapability(definition)).toThrow(invalidDefinitionError);
    }
  );

  it.each([
    { field: 'effect', values: ['read', 'local-write', 'firewall-write'] },
    { field: 'backup', values: ['none', 'strict'] },
    { field: 'audit', values: ['none', 'required'] },
    { field: 'confirmation', values: ['none', 'elicitation'] }
  ] as const)('accepts every valid $field policy boundary', ({ field, values }) => {
    for (const value of values) {
      const definition = createKernelDefinition();
      Reflect.set(definition.policy, field, value);

      expect(defineCapability(definition).policy[field]).toBe(value);
    }
  });

  it.each([
    { transports: [] },
    { transports: ['stdio'] },
    { transports: ['http'] },
    { transports: ['stdio', 'http'] }
  ] as const)('accepts valid runtime transports $transports', ({ transports }) => {
    const definition = createKernelDefinition();
    Reflect.set(definition, 'transports', transports);

    expect(defineCapability(definition).transports).toEqual(transports);
  });

  it('captures schema/parser entry points, handler, policy, annotations, and arrays before sealing', async () => {
    const originalHandler = vi.fn((input: { value: string }) =>
      Promise.resolve({ echoed: `original:${input.value}` })
    );
    const replacementHandler = vi.fn(() => Promise.resolve({ replaced: true }));
    const transports: TransportKind[] = ['stdio'];
    const scopes = ['kernel.original'];
    const flags: FeatureFlag[] = [];
    const redactFields = ['password'];
    const source: TypedCapabilityDefinition<{ value: string }, { echoed: string }> = {
      id: 'kernel.captured',
      mcpName: 'kernel_captured',
      title: 'Captured title',
      description: 'Captured description',
      inputSchema: z.object({ value: z.string() }).strict(),
      outputSchema: z.object({ echoed: z.string() }).strict(),
      annotations: { readOnlyHint: true },
      transports,
      policy: {
        effect: 'read',
        resourceScopes: scopes,
        requiredFeatureFlags: flags,
        backup: 'none',
        audit: 'none',
        confirmation: 'none',
        timeoutMs: 1000,
        redactFields
      },
      handler: originalHandler
    };
    const capability = defineCapability(source);

    Reflect.set(source, 'inputSchema', z.object({ replacement: z.literal(true) }).strict());
    Reflect.set(source, 'outputSchema', z.object({ replaced: z.literal(true) }).strict());
    Reflect.set(source, 'handler', replacementHandler);
    Reflect.set(source.annotations, 'readOnlyHint', false);
    Reflect.set(source.policy, 'timeoutMs', 300_000);
    transports.push('http');
    scopes.push('kernel.mutated');
    flags.push('ssh');
    redactFields.push('token');

    const dispatcher = dispatcherFor(
      [capability],
      policyOptions({ allowedResourceScopes: new Set(['kernel.original']) })
    );
    const result = await dispatcher.dispatch(
      request('kernel_captured', { value: 'safe' }),
      stdioContext()
    );

    expect(result).toEqual({ kind: 'success', output: { echoed: 'original:safe' } });
    expect(originalHandler).toHaveBeenCalledOnce();
    expect(replacementHandler).not.toHaveBeenCalled();
    expect(capability.annotations.readOnlyHint).toBe(true);
    expect(capability.transports).toEqual(['stdio']);
    expect(capability.policy.resourceScopes).toEqual(['kernel.original']);
    expect(capability.policy.requiredFeatureFlags).toEqual([]);
    expect(capability.policy.redactFields).toEqual(['password']);
    expect(capability.policy.timeoutMs).toBe(1000);
  });

  it('rejects a structural spread before catalog indexing', () => {
    const sealed = createKernelFixture();
    const forged = { ...sealed };

    expect(() => new CapabilityCatalog([forged])).toThrow(
      'Capability definition was not created by the policy kernel'
    );
  });
});

describe('pre-handler policy authorization', () => {
  it('copies option sets, freezes the dispatcher, and exposes no authority properties', async () => {
    const enabledFeatureFlags = new Set<FeatureFlag>(['ssh']);
    const allowedResourceScopes = new Set(['kernel.allowed']);
    const capability = createKernelFixture({
      requiredFeatureFlags: ['ssh'],
      resourceScopes: ['kernel.allowed']
    });
    const dispatcher = dispatcherFor(
      [capability],
      policyOptions({ enabledFeatureFlags, allowedResourceScopes })
    );
    enabledFeatureFlags.clear();
    allowedResourceScopes.clear();

    expect(Object.isFrozen(dispatcher)).toBe(true);
    expect(Reflect.has(dispatcher, 'catalog')).toBe(false);
    expect(Reflect.has(dispatcher, 'options')).toBe(false);
    expect(Reflect.has(dispatcher, 'handler')).toBe(false);
    expect(dispatcher.listExposed('stdio')).toEqual([capability]);
    expect(await dispatcher.dispatch(request(), stdioContext())).toEqual({
      kind: 'success',
      output: { echoed: 'safe' }
    });
  });

  it('refuses unknown names before every later gate', async () => {
    const result = await dispatcherFor([]).dispatch(
      request('SENTINEL-UNKNOWN', { secret: 'SENTINEL-ARGUMENT' }),
      stdioContext()
    );
    expectRefusal(result, 'UNKNOWN_CAPABILITY');
    expect(JSON.stringify(result)).not.toContain('SENTINEL');
  });

  it('checks transport before read-only, features, scopes, parsing, and handlers', async () => {
    const handler = vi.fn(() => Promise.resolve({ echoed: 'unsafe' }));
    const capability = createKernelFixture({
      effect: 'local-write',
      transports: ['http'],
      requiredFeatureFlags: ['ssh'],
      resourceScopes: ['blocked'],
      handler
    });
    const dispatcher = dispatcherFor(
      [capability],
      policyOptions({ readOnly: true, allowedResourceScopes: new Set() })
    );

    expectRefusal(
      await dispatcher.dispatch(request('kernel_read', 'SENTINEL-INVALID'), stdioContext()),
      'UNSUPPORTED_TRANSPORT'
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('checks read-only before required features and resources', async () => {
    const handler = vi.fn(() => Promise.resolve({ echoed: 'unsafe' }));
    const capability = createKernelFixture({
      effect: 'firewall-write',
      requiredFeatureFlags: ['ssh'],
      resourceScopes: ['blocked'],
      handler
    });
    const dispatcher = dispatcherFor(
      [capability],
      policyOptions({ readOnly: true, allowedResourceScopes: new Set() })
    );

    expectRefusal(await dispatcher.dispatch(request(), stdioContext()), 'READ_ONLY');
    expect(handler).not.toHaveBeenCalled();
  });

  it('checks required features before resource scopes', async () => {
    const handler = vi.fn(() => Promise.resolve({ echoed: 'unsafe' }));
    const capability = createKernelFixture({
      requiredFeatureFlags: ['ssh'],
      resourceScopes: ['blocked'],
      handler
    });
    const dispatcher = dispatcherFor(
      [capability],
      policyOptions({ allowedResourceScopes: new Set() })
    );

    expectRefusal(await dispatcher.dispatch(request(), stdioContext()), 'FEATURE_DISABLED');
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'empty', scopes: [] },
    { label: 'partially allowed', scopes: ['allowed', 'blocked'] },
    { label: 'disallowed', scopes: ['blocked'] }
  ])('refuses $label declared resource scopes with an active allow-list', async ({ scopes }) => {
    const handler = vi.fn(() => Promise.resolve({ echoed: 'unsafe' }));
    const capability = createKernelFixture({ resourceScopes: scopes, handler });
    const dispatcher = dispatcherFor(
      [capability],
      policyOptions({ allowedResourceScopes: new Set(['allowed']) })
    );

    expectRefusal(await dispatcher.dispatch(request(), stdioContext()), 'RESOURCE_NOT_ALLOWED');
    expect(handler).not.toHaveBeenCalled();
  });

  it('checks pre-aborted cancellation before parsing or confirmation allocation', async () => {
    const controller = new AbortController();
    controller.abort();
    const handler = vi.fn(() => Promise.resolve({ echoed: 'unsafe' }));
    const randomBytes = vi.fn((size: number) => new Uint8Array(size));
    const capability = createKernelFixture({ confirmation: 'elicitation', handler });
    const dispatcher = createCapabilityDispatcher(
      new CapabilityCatalog([capability]),
      policyOptions(),
      undefined,
      { randomBytes }
    );

    expectRefusal(
      await dispatcher.dispatch(
        request('kernel_read', 'SENTINEL-INVALID'),
        stdioContext({ signal: controller.signal })
      ),
      'CANCELLED'
    );
    expect(handler).not.toHaveBeenCalled();
    expect(randomBytes).not.toHaveBeenCalled();
  });

  it('sanitizes malformed input and canonical snapshot failures', async () => {
    const handler = vi.fn(() => Promise.resolve({ echoed: 'unsafe' }));
    const ordinary = createKernelFixture({ handler });
    const dateTransform = createKernelFixture({
      id: 'kernel.date',
      mcpName: 'kernel_date',
      inputSchema: z.object({ value: z.string() }).transform(() => ({ rejected: new Date(0) })),
      handler
    });
    const dispatcher = dispatcherFor([ordinary, dateTransform]);

    for (const invocation of [
      dispatcher.dispatch(
        request('kernel_read', { value: 'SENTINEL', extra: true }),
        stdioContext()
      ),
      dispatcher.dispatch(request('kernel_date', { value: 'SENTINEL' }), stdioContext())
    ]) {
      const result = await invocation;
      expectRefusal(result, 'INVALID_INPUT');
      expect(JSON.stringify(result)).not.toContain('SENTINEL');
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('defensively refuses forged timeout metadata without throwing or invoking a handler', async () => {
    const handler = vi.fn(() => Promise.resolve({ echoed: 'unsafe' }));
    const sealed = createKernelFixture({ handler });
    const malformed = {
      ...sealed,
      policy: { ...sealed.policy, timeoutMs: Number.NaN }
    } as CapabilityDefinition;
    const view: CapabilityCatalogView = {
      getByMcpName: () => malformed,
      listExposed: () => [malformed]
    };
    const dispatcher = createCapabilityDispatcher(view, policyOptions());

    expectRefusal(await dispatcher.dispatch(request(), stdioContext()), 'INVALID_POLICY');
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns only sanitized invalid-output and execution-failed refusals', async () => {
    const invalidOutput = createKernelFixture({
      id: 'kernel.invalid-output',
      mcpName: 'kernel_invalid_output',
      handler: () => Promise.resolve({ echoed: 'safe', secret: 'SENTINEL-OUTPUT' }),
      outputSchema: z.object({ accepted: z.literal(true) }).strict()
    });
    const rejected = createKernelFixture({
      id: 'kernel.rejected',
      mcpName: 'kernel_rejected',
      handler: () => Promise.reject(new Error('SENTINEL-REJECTION'))
    });
    const synchronous = createKernelFixture({
      id: 'kernel.sync',
      mcpName: 'kernel_sync',
      handler: () => {
        throw new Error('SENTINEL-SYNCHRONOUS');
      }
    });
    const dispatcher = dispatcherFor([invalidOutput, rejected, synchronous]);

    const results = await Promise.all([
      dispatcher.dispatch(request('kernel_invalid_output'), stdioContext()),
      dispatcher.dispatch(request('kernel_rejected'), stdioContext()),
      dispatcher.dispatch(request('kernel_sync'), stdioContext())
    ]);
    expectRefusal(results[0], 'INVALID_OUTPUT');
    expectRefusal(results[1], 'EXECUTION_FAILED');
    expectRefusal(results[2], 'EXECUTION_FAILED');
    expect(JSON.stringify(results)).not.toContain('SENTINEL');
  });

  it('sanitizes a hostile thenable returned by a structurally dishonest handler', async () => {
    const hostileThenable = Object.defineProperty({}, 'then', {
      get: () => {
        throw new Error('SENTINEL-THENABLE-GETTER');
      }
    });
    const capability = createKernelFixture({
      handler: () => hostileThenable as Promise<Record<string, unknown>>
    });

    const result = await dispatcherFor([capability]).dispatch(request(), stdioContext());

    expectRefusal(result, 'EXECUTION_FAILED');
    expect(JSON.stringify(result)).not.toContain('SENTINEL');
  });

  it('hands handlers one canonical, deeply frozen, alias-free input snapshot', async () => {
    const gate = deferred<undefined>();
    let observed: Record<string, unknown> | undefined;
    const inputSchema = z
      .object({
        payload: z.unknown(),
        first: z.unknown(),
        second: z.unknown(),
        zero: z.number()
      })
      .strict() as z.ZodType<Record<string, unknown>>;
    const capability = createKernelFixture({
      inputSchema,
      handler: async (input) => {
        observed = input;
        await gate.promise;
        return { echoed: 'safe' };
      }
    });
    const dispatcher = dispatcherFor([capability]);
    const alias = { nested: { value: 'original' } };
    const callerArguments = { payload: alias, first: alias, second: alias, zero: -0 };

    const pending = dispatcher.dispatch(request('kernel_read', callerArguments), stdioContext());
    alias.nested.value = 'SENTINEL-MUTATION';
    gate.resolve(undefined);
    const result = await pending;

    expect(result).toEqual({ kind: 'success', output: { echoed: 'safe' } });
    if (observed === undefined) throw new Error('Handler did not receive input');
    const payload = observed.payload as { nested: { value: string } };
    expect(payload.nested.value).toBe('original');
    expect(observed.first).not.toBe(observed.second);
    expect(Object.is(observed.zero, -0)).toBe(false);
    expect(Object.isFrozen(observed)).toBe(true);
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.nested)).toBe(true);
  });

  it('copies and deeply freezes validated handler output', async () => {
    const handlerOwned = { payload: { value: 'safe' } };
    const capability = createKernelFixture({
      outputSchema: z.object({ payload: z.unknown() }).strict(),
      handler: () => Promise.resolve(handlerOwned)
    });
    const result = await dispatcherFor([capability]).dispatch(request(), stdioContext());
    handlerOwned.payload.value = 'SENTINEL-MUTATION';

    expect(result).toEqual({ kind: 'success', output: { payload: { value: 'safe' } } });
    if (result.kind !== 'success') throw new Error('Expected a success result');
    expect(Object.isFrozen(result.output)).toBe(true);
    expect(Object.isFrozen(result.output.payload)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('SENTINEL');
  });
});

describe('effect-aware cancellation and timeout handling', () => {
  it('keeps the first observed read abort cause and cleans caller listeners and timers', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const listenerBaseline = getEventListeners(controller.signal, 'abort').length;
    const handler = vi.fn(
      (_input: Record<string, unknown>, context: CapabilityExecutionContext) =>
        new Promise<Record<string, unknown>>((_resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => {
              reject(new Error('SENTINEL-LATE-READ-ABORT'));
            },
            { once: true }
          );
        })
    );
    const capability = createKernelFixture({ timeoutMs: 50, handler });
    const dispatcher = dispatcherFor([capability]);

    const callerFirst = dispatcher.dispatch(request(), stdioContext({ signal: controller.signal }));
    controller.abort();
    expectRefusal(await callerFirst, 'CANCELLED');
    await vi.advanceTimersByTimeAsync(100);

    expect(handler).toHaveBeenCalledOnce();
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(listenerBaseline);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps timeout when timeout is observed before a later caller abort', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const listenerBaseline = getEventListeners(controller.signal, 'abort').length;
    const capability = createKernelFixture({
      timeoutMs: 50,
      handler: (_input, context) =>
        new Promise<Record<string, unknown>>((_resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => {
              reject(new Error('late timeout'));
            },
            { once: true }
          );
        })
    });
    const pending = dispatcherFor([capability]).dispatch(
      request(),
      stdioContext({ signal: controller.signal })
    );

    await vi.advanceTimersByTimeAsync(50);
    const result = await pending;
    controller.abort();

    expectRefusal(result, 'TIMEOUT');
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(listenerBaseline);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { effect: 'read' as const, expected: 'CANCELLED' as const },
    { effect: 'local-write' as const, expected: 'OUTCOME_INDETERMINATE' as const }
  ])(
    'aborts the internal signal with $effect settlement semantics',
    async ({ effect, expected }) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const observedAbort = deferred<undefined>();
      const capability = createKernelFixture({
        effect,
        handler: (_input, context) =>
          new Promise<Record<string, unknown>>((_resolve, reject) => {
            context.signal.addEventListener(
              'abort',
              () => {
                observedAbort.resolve(undefined);
                reject(new Error('SENTINEL-INTERNAL-ABORT'));
              },
              { once: true }
            );
          })
      });
      const pending = dispatcherFor([capability]).dispatch(
        request(),
        stdioContext({ signal: controller.signal })
      );

      controller.abort();
      await observedAbort.promise;
      const result = await pending;

      expectRefusal(result, expected);
      expect(JSON.stringify(result)).not.toContain('SENTINEL');
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('waits for an ignored-signal write to settle before reporting an indeterminate outcome', async () => {
    vi.useFakeTimers();
    let sideEffects = 0;
    const capability = createKernelFixture({
      effect: 'firewall-write',
      timeoutMs: 10,
      handler: () =>
        new Promise<Record<string, unknown>>((resolve) => {
          setTimeout(() => {
            sideEffects += 1;
            resolve({ echoed: 'SENTINEL-LATE-SUCCESS' });
          }, 100);
        })
    });
    const pending = dispatcherFor([capability]).dispatch(request(), stdioContext());
    let dispatchSettled = false;
    const observed = pending.then((result) => {
      dispatchSettled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(dispatchSettled).toBe(false);
    expect(sideEffects).toBe(0);
    await vi.advanceTimersByTimeAsync(90);
    const result = await observed;

    expectRefusal(result, 'OUTCOME_INDETERMINATE');
    expect(sideEffects).toBe(1);
    expect(JSON.stringify(result)).not.toContain('SENTINEL');
    await vi.advanceTimersByTimeAsync(100);
    expect(sideEffects).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns promptly for an ignored-signal read while observing its late rejection', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const capability = createKernelFixture({
      timeoutMs: 10,
      handler: () =>
        new Promise<Record<string, unknown>>((_resolve, reject) => {
          setTimeout(() => {
            reject(new Error('SENTINEL-LATE-REJECTION'));
          }, 100);
        })
    });
    const pending = dispatcherFor([capability]).dispatch(
      request(),
      stdioContext({ signal: controller.signal })
    );
    controller.abort();

    const result = await pending;
    expectRefusal(result, 'CANCELLED');
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('awaits an ignored-signal read when the injected settlement retainer fails', async () => {
    const controller = new AbortController();
    const started = deferred<undefined>();
    const release = deferred<undefined>();
    const retain = vi.fn(() => {
      throw new Error('SENTINEL-RETAINER-FAILURE');
    });
    const capability = createKernelFixture({
      handler: async () => {
        started.resolve(undefined);
        await release.promise;
        return { echoed: 'late-success' };
      }
    });
    const dispatcher = Reflect.apply(createCapabilityDispatcher, undefined, [
      new CapabilityCatalog([capability]),
      policyOptions(),
      undefined,
      {},
      { retain }
    ]);
    const execution = dispatcher.dispatch(request(), stdioContext({ signal: controller.signal }));

    try {
      await started.promise;
      controller.abort();
      let dispatchSettled = false;
      void execution.finally(() => {
        dispatchSettled = true;
      });
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

      expect(retain).toHaveBeenCalledOnce();
      expect(dispatchSettled).toBe(false);

      release.resolve(undefined);
      expectRefusal(await execution, 'CANCELLED');
    } finally {
      release.resolve(undefined);
      await execution;
    }
  });

  it('snapshots the internal settlement retainer at dispatcher construction', async () => {
    const controller = new AbortController();
    const started = deferred<undefined>();
    const release = deferred<undefined>();
    const initialRetain = vi.fn((settlement: Promise<unknown>) => {
      void settlement.then(() => undefined);
    });
    const replacementRetain = vi.fn((settlement: Promise<unknown>) => {
      void settlement.then(() => undefined);
    });
    const hooks = { retain: initialRetain };
    const capability = createKernelFixture({
      handler: async () => {
        started.resolve(undefined);
        await release.promise;
        return { echoed: 'late-success' };
      }
    });
    const dispatcher = Reflect.apply(createCapabilityDispatcher, undefined, [
      new CapabilityCatalog([capability]),
      policyOptions(),
      undefined,
      {},
      hooks
    ]);
    hooks.retain = replacementRetain;

    try {
      const execution = dispatcher.dispatch(request(), stdioContext({ signal: controller.signal }));
      await started.promise;
      controller.abort();
      expectRefusal(await execution, 'CANCELLED');
      expect(initialRetain).toHaveBeenCalledOnce();
      expect(replacementRetain).not.toHaveBeenCalled();
    } finally {
      release.resolve(undefined);
    }
  });

  it('cleans listeners and timers on success, synchronous throw, and rejection', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const baseline = getEventListeners(controller.signal, 'abort').length;
    const definitions = [
      createKernelFixture({ id: 'clean.success', mcpName: 'clean_success' }),
      createKernelFixture({
        id: 'clean.sync',
        mcpName: 'clean_sync',
        handler: () => {
          throw new Error('SENTINEL-SYNC');
        }
      }),
      createKernelFixture({
        id: 'clean.reject',
        mcpName: 'clean_reject',
        handler: () => Promise.reject(new Error('SENTINEL-REJECT'))
      })
    ];
    const dispatcher = dispatcherFor(definitions);

    const results = await Promise.all(
      definitions.map((definition) =>
        dispatcher.dispatch(
          request(definition.mcpName),
          stdioContext({ signal: controller.signal })
        )
      )
    );

    expect(results.map((result) => result.kind)).toEqual(['success', 'refused', 'refused']);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(baseline);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let abort races replace genuine synchronous or immediate handler failures', async () => {
    vi.useFakeTimers();
    const syncController = new AbortController();
    const rejectController = new AbortController();
    const synchronous = createKernelFixture({
      id: 'race.sync',
      mcpName: 'race_sync',
      handler: () => {
        throw new Error('SENTINEL-GENUINE-SYNC');
      }
    });
    const rejected = createKernelFixture({
      id: 'race.reject',
      mcpName: 'race_reject',
      handler: () => Promise.reject(new Error('SENTINEL-GENUINE-REJECT'))
    });
    const dispatcher = dispatcherFor([synchronous, rejected]);

    const syncPending = dispatcher.dispatch(
      request('race_sync'),
      stdioContext({ signal: syncController.signal })
    );
    syncController.abort();
    const rejectPending = dispatcher.dispatch(
      request('race_reject'),
      stdioContext({ signal: rejectController.signal })
    );
    await Promise.resolve();
    rejectController.abort();

    expectRefusal(await syncPending, 'EXECUTION_FAILED');
    expectRefusal(await rejectPending, 'EXECUTION_FAILED');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { effect: 'read' as const, expected: 'CANCELLED' as const },
    { effect: 'firewall-write' as const, expected: 'OUTCOME_INDETERMINATE' as const }
  ])(
    'keeps an abort observed inside a throwing $effect handler as the winning cause',
    async ({ effect, expected }) => {
      const controller = new AbortController();
      const capability = createKernelFixture({
        effect,
        handler: () => {
          controller.abort();
          throw new Error('SENTINEL-THROW-AFTER-ABORT');
        }
      });

      const result = await dispatcherFor([capability]).dispatch(
        request(),
        stdioContext({ signal: controller.signal })
      );

      expectRefusal(result, expected);
      expect(JSON.stringify(result)).not.toContain('SENTINEL');
    }
  );
});

interface ConfirmationHarness {
  readonly dispatcher: CapabilityDispatcher;
  complete(
    decision: ConfirmationDecision,
    claims: ConfirmationClaims,
    repeatedRequest: CapabilityRequest,
    context: CapabilityInvocationContext
  ): Promise<CapabilityResult>;
}

function deterministicRandomBytes() {
  let counter = 0;
  return (size: number) => {
    const bytes = new Uint8Array(size);
    bytes[size - 1] = counter;
    counter += 1;
    return bytes;
  };
}

function confirmationHarness(
  capability: CapabilityDefinition,
  options: CapabilityPolicyOptions = policyOptions(),
  runtime: CapabilityKernelRuntime = {}
): ConfirmationHarness {
  let completion: ConfirmationCompletion | undefined;
  const dispatcher = createCapabilityDispatcher(
    new CapabilityCatalog([capability]),
    options,
    (installed) => {
      completion = installed;
    },
    {
      now: () => 1000,
      randomBytes: deterministicRandomBytes(),
      ...runtime
    }
  );

  return {
    dispatcher,
    complete(decision, claims, repeatedRequest, context) {
      if (completion === undefined) throw new Error('Confirmation completion was not installed');
      return completion(decision, claims, repeatedRequest, context);
    }
  };
}

async function issueChallenge(
  dispatcher: CapabilityDispatcher,
  repeatedRequest: CapabilityRequest = request(),
  context: CapabilityInvocationContext = stdioContext()
) {
  const result = await dispatcher.dispatch(repeatedRequest, context);
  if (result.kind !== 'confirmation-required') {
    throw new Error(`Expected confirmation-required, received ${result.kind}`);
  }
  return result.challenge;
}

function claimsFor(challenge: {
  readonly confirmationId: string;
  readonly capabilityId: string;
  readonly argumentsSha256: string;
}): ConfirmationClaims {
  return {
    confirmationId: challenge.confirmationId,
    capabilityId: challenge.capabilityId,
    argumentsSha256: challenge.argumentsSha256
  };
}

describe('bounded one-shot confirmation ledger', () => {
  it('issues only a frozen primitive challenge with a 32-byte base64url ID and exact TTL', async () => {
    const handler = vi.fn(() => Promise.resolve({ echoed: 'safe' }));
    const harness = confirmationHarness(
      createKernelFixture({ confirmation: 'elicitation', handler })
    );
    const challenge = await issueChallenge(harness.dispatcher);

    expect(challenge.confirmationId).toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(challenge.capabilityId).toBe('kernel.read');
    expect(challenge.argumentsSha256).toMatch(/^[a-f\d]{64}$/u);
    expect(challenge.expiresAt).toBe(new Date(301_000).toISOString());
    expect(Object.keys(challenge).sort()).toEqual([
      'argumentsSha256',
      'capabilityId',
      'confirmationId',
      'expiresAt'
    ]);
    expect(Object.isFrozen(challenge)).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(challenge)).not.toContain('handler');
    expect(JSON.stringify(challenge)).not.toContain('definition');
  });

  it('executes an exact acceptance once and rejects sequential replay', async () => {
    const handler = vi.fn((input: Record<string, unknown>) =>
      Promise.resolve({ echoed: input.value })
    );
    const harness = confirmationHarness(
      createKernelFixture({ confirmation: 'elicitation', handler })
    );
    const repeatedRequest = request();
    const context = stdioContext({ principalId: 'alice' });
    const challenge = await issueChallenge(harness.dispatcher, repeatedRequest, context);
    const claims = claimsFor(challenge);

    expect(await harness.complete('accept', claims, repeatedRequest, context)).toEqual({
      kind: 'success',
      output: { echoed: 'safe' }
    });
    expectRefusal(
      await harness.complete('accept', claims, repeatedRequest, context),
      'CONFIRMATION_INVALID'
    );
    expect(handler).toHaveBeenCalledOnce();
  });

  it('declines an exact challenge once and rejects replay without invoking the handler', async () => {
    const handler = vi.fn(() => Promise.resolve({ echoed: 'unsafe' }));
    const harness = confirmationHarness(
      createKernelFixture({ confirmation: 'elicitation', handler })
    );
    const challenge = await issueChallenge(harness.dispatcher);
    const claims = claimsFor(challenge);

    expectRefusal(
      await harness.complete('decline', claims, request(), stdioContext()),
      'CONFIRMATION_DECLINED'
    );
    expectRefusal(
      await harness.complete('decline', claims, request(), stdioContext()),
      'CONFIRMATION_INVALID'
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('leaves a real challenge intact after an unknown confirmation ID', async () => {
    const handler = vi.fn((input: Record<string, unknown>) =>
      Promise.resolve({ echoed: input.value })
    );
    const harness = confirmationHarness(
      createKernelFixture({ confirmation: 'elicitation', handler })
    );
    const challenge = await issueChallenge(harness.dispatcher);
    const claims = claimsFor(challenge);

    expectRefusal(
      await harness.complete(
        'accept',
        { ...claims, confirmationId: 'unknown-id' },
        request(),
        stdioContext()
      ),
      'CONFIRMATION_INVALID'
    );
    expect(await harness.complete('accept', claims, request(), stdioContext())).toEqual({
      kind: 'success',
      output: { echoed: 'safe' }
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('consumes a known challenge and sanitizes a throwing claim accessor', async () => {
    const handler = vi.fn(() => Promise.resolve({ echoed: 'unsafe' }));
    const harness = confirmationHarness(
      createKernelFixture({ confirmation: 'elicitation', handler })
    );
    const challenge = await issueChallenge(harness.dispatcher);
    const malformedClaims = Object.defineProperty(
      {
        confirmationId: challenge.confirmationId,
        argumentsSha256: challenge.argumentsSha256
      },
      'capabilityId',
      {
        enumerable: true,
        get: () => {
          throw new Error('SENTINEL-CLAIM-GETTER');
        }
      }
    ) as ConfirmationClaims;

    const malformed = await harness.complete('accept', malformedClaims, request(), stdioContext());

    expectRefusal(malformed, 'CONFIRMATION_INVALID');
    expect(JSON.stringify(malformed)).not.toContain('SENTINEL');
    expectRefusal(
      await harness.complete('accept', claimsFor(challenge), request(), stdioContext()),
      'CONFIRMATION_INVALID'
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'capability', claims: { capabilityId: 'other.capability' } },
    { label: 'digest', claims: { argumentsSha256: '0'.repeat(64) } }
  ])('consumes a known challenge after a wrong $label claim', async ({ claims: override }) => {
    const handler = vi.fn(() => Promise.resolve({ echoed: 'unsafe' }));
    const harness = confirmationHarness(
      createKernelFixture({ confirmation: 'elicitation', handler })
    );
    const challenge = await issueChallenge(harness.dispatcher);
    const claims = claimsFor(challenge);

    expectRefusal(
      await harness.complete('accept', { ...claims, ...override }, request(), stdioContext()),
      'CONFIRMATION_INVALID'
    );
    expectRefusal(
      await harness.complete('accept', claims, request(), stdioContext()),
      'CONFIRMATION_INVALID'
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'repeated arguments',
      repeatedRequest: request('kernel_read', { value: 'different' }),
      context: stdioContext()
    },
    {
      label: 'MCP name',
      repeatedRequest: request('different_name'),
      context: stdioContext()
    },
    {
      label: 'transport',
      repeatedRequest: request(),
      context: { transport: 'http' as const, principalId: 'alice' }
    },
    {
      label: 'principal',
      repeatedRequest: request(),
      context: stdioContext({ principalId: 'bob' })
    }
  ])(
    'consumes a known challenge after a wrong $label binding',
    async ({ repeatedRequest, context }) => {
      const handler = vi.fn(() => Promise.resolve({ echoed: 'unsafe' }));
      const harness = confirmationHarness(
        createKernelFixture({ confirmation: 'elicitation', handler })
      );
      const originalContext = stdioContext({ principalId: 'alice' });
      const challenge = await issueChallenge(harness.dispatcher, request(), originalContext);
      const claims = claimsFor(challenge);

      expectRefusal(
        await harness.complete('accept', claims, repeatedRequest, context),
        'CONFIRMATION_INVALID'
      );
      expectRefusal(
        await harness.complete('accept', claims, request(), originalContext),
        'CONFIRMATION_INVALID'
      );
      expect(handler).not.toHaveBeenCalled();
    }
  );

  it('hashes and executes only a fresh repeated-argument snapshot', async () => {
    const gate = deferred<undefined>();
    let observed: Record<string, unknown> | undefined;
    const capability = createKernelFixture({
      confirmation: 'elicitation',
      inputSchema: z.object({ payload: z.unknown() }).strict(),
      handler: async (input) => {
        observed = input;
        await gate.promise;
        return { echoed: 'safe' };
      }
    });
    const harness = confirmationHarness(capability);
    const firstPayload = { nested: { value: 'original' } };
    const challenge = await issueChallenge(
      harness.dispatcher,
      request('kernel_read', { payload: firstPayload })
    );
    firstPayload.nested.value = 'SENTINEL-FIRST-ROUND';
    const repeatedPayload = { nested: { value: 'original' } };
    const repeatedRequest = request('kernel_read', { payload: repeatedPayload });

    const pending = harness.complete(
      'accept',
      claimsFor(challenge),
      repeatedRequest,
      stdioContext()
    );
    repeatedPayload.nested.value = 'SENTINEL-SETTLEMENT';
    gate.resolve(undefined);
    const result = await pending;

    expect(result).toEqual({ kind: 'success', output: { echoed: 'safe' } });
    if (observed === undefined) throw new Error('Handler did not receive repeated input');
    const payload = observed.payload as { nested: { value: string } };
    expect(payload.nested.value).toBe('original');
    expect(Object.isFrozen(payload.nested)).toBe(true);
  });

  it('invalidates expired challenges', async () => {
    let now = 1000;
    const handler = vi.fn(() => Promise.resolve({ echoed: 'unsafe' }));
    const harness = confirmationHarness(
      createKernelFixture({ confirmation: 'elicitation', handler }),
      policyOptions(),
      { now: () => now }
    );
    const challenge = await issueChallenge(harness.dispatcher);
    now = 301_001;

    expectRefusal(
      await harness.complete('accept', claimsFor(challenge), request(), stdioContext()),
      'CONFIRMATION_INVALID'
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows exactly one concurrent completion to reach the handler', async () => {
    const gate = deferred<undefined>();
    const handler = vi.fn(async () => {
      await gate.promise;
      return { echoed: 'safe' };
    });
    const harness = confirmationHarness(
      createKernelFixture({ confirmation: 'elicitation', handler })
    );
    const challenge = await issueChallenge(harness.dispatcher);
    const claims = claimsFor(challenge);

    const first = harness.complete('accept', claims, request(), stdioContext());
    const second = harness.complete('accept', claims, request(), stdioContext());
    gate.resolve(undefined);
    const results = await Promise.all([first, second]);

    expect(results.filter((result) => result.kind === 'success')).toHaveLength(1);
    expect(
      results.filter(
        (result) => result.kind === 'refused' && result.code === 'CONFIRMATION_INVALID'
      )
    ).toHaveLength(1);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('consumes a challenge when the accepted handler fails', async () => {
    const handler = vi.fn(() => Promise.reject(new Error('SENTINEL-CONFIRMATION-FAILURE')));
    const harness = confirmationHarness(
      createKernelFixture({ confirmation: 'elicitation', handler })
    );
    const challenge = await issueChallenge(harness.dispatcher);
    const claims = claimsFor(challenge);

    expectRefusal(
      await harness.complete('accept', claims, request(), stdioContext()),
      'EXECUTION_FAILED'
    );
    expectRefusal(
      await harness.complete('accept', claims, request(), stdioContext()),
      'CONFIRMATION_INVALID'
    );
    expect(handler).toHaveBeenCalledOnce();
  });

  it('refuses a full ledger, never evicts live entries, and prunes expired entries', async () => {
    let now = 0;
    const capability = createKernelFixture({ confirmation: 'elicitation' });
    const harness = confirmationHarness(capability, policyOptions(), {
      now: () => now,
      confirmationTtlMs: 10,
      ledgerCapacity: 1
    });
    const first = await issueChallenge(
      harness.dispatcher,
      request('kernel_read', { value: 'first' })
    );

    expectRefusal(
      await harness.dispatcher.dispatch(
        request('kernel_read', { value: 'second' }),
        stdioContext()
      ),
      'CONFIRMATION_UNAVAILABLE'
    );
    now = 11;
    const afterPrune = await issueChallenge(
      harness.dispatcher,
      request('kernel_read', { value: 'third' })
    );
    expect(afterPrune.confirmationId).not.toBe(first.confirmationId);
  });

  it('gives up after exactly four unique-ID allocation collisions', async () => {
    const randomBytes = vi.fn((size: number) => new Uint8Array(size));
    const harness = confirmationHarness(
      createKernelFixture({ confirmation: 'elicitation' }),
      policyOptions(),
      { randomBytes, ledgerCapacity: 2 }
    );
    await issueChallenge(harness.dispatcher, request('kernel_read', { value: 'first' }));

    expectRefusal(
      await harness.dispatcher.dispatch(
        request('kernel_read', { value: 'second' }),
        stdioContext()
      ),
      'CONFIRMATION_UNAVAILABLE'
    );
    expect(randomBytes).toHaveBeenCalledTimes(5);
    expect(randomBytes).toHaveBeenNthCalledWith(5, 32);
  });

  it('refuses elicitation when no adapter completion closure was installed', async () => {
    const handler = vi.fn(() => Promise.resolve({ echoed: 'unsafe' }));
    const dispatcher = createCapabilityDispatcher(
      new CapabilityCatalog([createKernelFixture({ confirmation: 'elicitation', handler })]),
      policyOptions()
    );

    expectRefusal(await dispatcher.dispatch(request(), stdioContext()), 'CONFIRMATION_UNAVAILABLE');
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    { confirmationTtlMs: 0 },
    { confirmationTtlMs: Number.NaN },
    { confirmationTtlMs: 300_001 },
    { ledgerCapacity: 0 },
    { ledgerCapacity: 1.5 },
    { ledgerCapacity: 1025 }
  ] as readonly CapabilityKernelRuntime[])(
    'rejects invalid injected runtime bounds %#',
    (runtime) => {
      expect(() =>
        confirmationHarness(
          createKernelFixture({ confirmation: 'elicitation' }),
          policyOptions(),
          runtime
        )
      ).toThrow('Invalid capability kernel runtime');
    }
  );

  it('does not attach settlement fields to requests, contexts, dispatchers, or results', async () => {
    const repeatedRequest = request();
    const context = stdioContext();
    const harness = confirmationHarness(createKernelFixture({ confirmation: 'elicitation' }));
    const challengeResult = await harness.dispatcher.dispatch(repeatedRequest, context);

    expect(Reflect.has(repeatedRequest, 'confirmation')).toBe(false);
    expect(Reflect.has(context, 'confirmation')).toBe(false);
    expect(Reflect.has(harness.dispatcher, 'confirmation')).toBe(false);
    expect(Reflect.has(challengeResult, 'completeConfirmation')).toBe(false);
    expect(Object.keys(harness.dispatcher).sort()).toEqual(['dispatch', 'listExposed']);
  });
});

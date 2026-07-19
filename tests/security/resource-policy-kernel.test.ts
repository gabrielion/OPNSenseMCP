// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod/v4';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import {
  createCapabilityDispatcher,
  defineCapability,
  defineResourceCapability,
  type CapabilityPolicyOptions,
  type TypedResourceCapabilityDefinition
} from '../../src/capabilities/kernel.js';
import type {
  ResourceCapabilityExecutionContext,
  ResourceResolution
} from '../../src/capabilities/types.js';

interface ParsedInput extends Record<string, unknown> {
  readonly resource: string;
  readonly payload?: unknown;
}

interface ResolvedInput extends Record<string, unknown> {
  readonly resource: string;
  readonly normalized?: string;
}

interface Output extends Record<string, unknown> {
  readonly resource: string;
  readonly scopes?: readonly string[] | undefined;
}

interface FixtureOptions {
  readonly selectableResourceScopes?: readonly string[];
  readonly inputSchema?: z.ZodType<ParsedInput>;
  readonly resolver?: (
    input: ParsedInput,
    context: { readonly visibleResourceScopes: readonly string[] }
  ) => ResourceResolution<ResolvedInput>;
  readonly handler?: (
    input: ResolvedInput,
    context: ResourceCapabilityExecutionContext
  ) => Promise<Output>;
}

function resourceDefinition(
  options: FixtureOptions = {}
): TypedResourceCapabilityDefinition<ParsedInput, ResolvedInput, Output> {
  return {
    id: 'test.resource.get',
    mcpName: 'test_resource_get',
    title: 'Test resource get',
    description: 'Read one resource from a closed synthetic catalog.',
    inputSchema: options.inputSchema ?? z.object({ resource: z.string() }).strict(),
    outputSchema: z
      .object({ resource: z.string(), scopes: z.array(z.string()).readonly().optional() })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    transports: ['stdio'],
    selectableResourceScopes: options.selectableResourceScopes ?? [
      'resource.alpha',
      'resource.beta'
    ],
    resolver:
      options.resolver ??
      ((input, { visibleResourceScopes }) =>
        visibleResourceScopes.includes(input.resource)
          ? { kind: 'resolved', input, effectiveResourceScopes: [input.resource] }
          : {
              kind: 'refused',
              code: 'UNKNOWN_RESOURCE',
              details: { suggestions: visibleResourceScopes }
            }),
    policy: {
      effect: 'read',
      requiredFeatureFlags: [],
      backup: 'none',
      audit: 'none',
      confirmation: 'none',
      timeoutMs: 1000,
      redactFields: []
    },
    handler: options.handler ?? (({ resource }) => Promise.resolve({ resource }))
  };
}

function dispatcherFor(
  capability: ReturnType<typeof defineResourceCapability>,
  overrides: Partial<CapabilityPolicyOptions> = {}
) {
  return createCapabilityDispatcher(new CapabilityCatalog([capability]), {
    readOnly: true,
    allowedResourceScopes: null,
    enabledFeatureFlags: new Set(),
    ...overrides
  });
}

describe('closed generic-resource authorization', () => {
  it.each([
    { label: 'empty selectable scopes', scopes: [] },
    { label: 'duplicate selectable scopes', scopes: ['resource.alpha', 'resource.alpha'] },
    { label: 'unsafe selectable scope', scopes: ['SENTINEL SECRET VALUE'] }
  ])('rejects $label at trusted definition time', ({ scopes }) => {
    expect(() =>
      defineResourceCapability(resourceDefinition({ selectableResourceScopes: scopes }))
    ).toThrow(/^Invalid capability definition$/);
  });

  it('rejects extra resolver-policy authority and proxied callbacks', () => {
    const extraPolicy = resourceDefinition();
    Reflect.set(extraPolicy.policy, 'resourceScopes', ['resource.alpha']);
    expect(() => defineResourceCapability(extraPolicy)).toThrow(/^Invalid capability definition$/);

    const proxied = resourceDefinition();
    Reflect.set(proxied, 'resolver', new Proxy(proxied.resolver, {}));
    expect(() => defineResourceCapability(proxied)).toThrow(/^Invalid capability definition$/);
  });

  it('lists a generic tool for one visible resource and authorizes only the selected scope', async () => {
    const resolver = vi.fn(resourceDefinition().resolver);
    const handler = vi.fn(
      ({ resource }: ResolvedInput, context: ResourceCapabilityExecutionContext) =>
        Promise.resolve({ resource, scopes: context.effectiveResourceScopes })
    );
    const capability = defineResourceCapability(resourceDefinition({ resolver, handler }));
    const dispatcher = dispatcherFor(capability, {
      allowedResourceScopes: new Set(['resource.alpha'])
    });

    expect(dispatcher.listExposed('stdio')).toEqual([capability]);
    await expect(
      dispatcher.dispatch(
        { name: capability.mcpName, arguments: { resource: 'resource.alpha' } },
        { transport: 'stdio' }
      )
    ).resolves.toEqual({
      kind: 'success',
      output: { resource: 'resource.alpha', scopes: ['resource.alpha'] }
    });
    expect(resolver).toHaveBeenCalledWith(
      { resource: 'resource.alpha' },
      { visibleResourceScopes: ['resource.alpha'] }
    );
    expect(Object.isFrozen(resolver.mock.calls[0]?.[1].visibleResourceScopes)).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('refuses a forged hidden selection and suggests at most three visible resources deterministically', async () => {
    const resolver = vi.fn(
      (
        input: ParsedInput,
        { visibleResourceScopes }: { visibleResourceScopes: readonly string[] }
      ) =>
        visibleResourceScopes.includes(input.resource)
          ? { kind: 'resolved' as const, input, effectiveResourceScopes: [input.resource] }
          : {
              kind: 'refused' as const,
              code: 'UNKNOWN_RESOURCE' as const,
              details: {
                suggestions: [
                  'resource.zeta',
                  'resource.hidden',
                  'resource.gamma',
                  'resource.beta',
                  'resource.alpha'
                ]
              }
            }
    );
    const handler = vi.fn(() => Promise.resolve({ resource: 'unsafe' }));
    const capability = defineResourceCapability(
      resourceDefinition({
        selectableResourceScopes: [
          'resource.zeta',
          'resource.hidden',
          'resource.gamma',
          'resource.beta',
          'resource.alpha'
        ],
        resolver,
        handler
      })
    );
    const dispatcher = dispatcherFor(capability, {
      allowedResourceScopes: new Set([
        'resource.zeta',
        'resource.gamma',
        'resource.beta',
        'resource.alpha'
      ])
    });

    const result = await dispatcher.dispatch(
      { name: capability.mcpName, arguments: { resource: 'SENTINEL_UNKNOWN_RESOURCE' } },
      { transport: 'stdio' }
    );

    expect(result).toEqual({
      kind: 'refused',
      code: 'UNKNOWN_RESOURCE',
      message: 'Resource is not available.',
      details: { suggestions: ['resource.alpha', 'resource.beta', 'resource.gamma'] }
    });
    expect(resolver.mock.calls[0]?.[1].visibleResourceScopes).not.toContain('resource.hidden');
    expect(JSON.stringify(result)).not.toContain('SENTINEL');
    expect(handler).not.toHaveBeenCalled();
  });

  it('strictly parses and snapshots input before the resolver, then gives the handler only normalized input', async () => {
    let resolverInput: ParsedInput | undefined;
    let handlerInput: ResolvedInput | undefined;
    let handlerContext: ResourceCapabilityExecutionContext | undefined;
    const resolver = vi.fn((input: ParsedInput) => {
      resolverInput = input;
      const payload = input.payload as { nested: { value: string } };
      return {
        kind: 'resolved' as const,
        input: { resource: input.resource, normalized: payload.nested.value },
        effectiveResourceScopes: [input.resource]
      };
    });
    const handler = vi.fn((input: ResolvedInput, context: ResourceCapabilityExecutionContext) => {
      handlerInput = input;
      handlerContext = context;
      return Promise.resolve({ resource: input.normalized ?? input.resource });
    });
    const capability = defineResourceCapability(
      resourceDefinition({
        inputSchema: z.object({ resource: z.string(), payload: z.unknown() }).strict(),
        resolver,
        handler
      })
    );
    const dispatcher = dispatcherFor(capability, {
      allowedResourceScopes: new Set(['resource.alpha'])
    });
    const payload = { nested: { value: 'original' } };

    await expect(
      dispatcher.dispatch(
        { name: capability.mcpName, arguments: { resource: 'resource.alpha', payload } },
        { transport: 'stdio' }
      )
    ).resolves.toEqual({ kind: 'success', output: { resource: 'original' } });
    payload.nested.value = 'SENTINEL_MUTATION';

    expect(resolverInput).not.toBeUndefined();
    expect(resolverInput?.payload).not.toBe(payload);
    expect(Object.isFrozen(resolverInput)).toBe(true);
    expect(Object.isFrozen(resolverInput?.payload)).toBe(true);
    expect(handlerInput).toEqual({ resource: 'resource.alpha', normalized: 'original' });
    expect(handlerInput).not.toHaveProperty('payload');
    expect(Object.isFrozen(handlerInput)).toBe(true);
    expect(handlerContext?.effectiveResourceScopes).toEqual(['resource.alpha']);
    expect(Object.isFrozen(handlerContext?.effectiveResourceScopes)).toBe(true);

    resolver.mockClear();
    await expect(
      dispatcher.dispatch(
        {
          name: capability.mcpName,
          arguments: { resource: 'resource.alpha', payload: {}, SENTINEL_EXTRA: true }
        },
        { transport: 'stdio' }
      )
    ).resolves.toMatchObject({ kind: 'refused', code: 'INVALID_INPUT' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each([
    { scopes: [] },
    { scopes: ['resource.alpha', 'resource.alpha'] },
    { scopes: ['resource.hidden'] }
  ])('rechecks forged resolver scopes $scopes before handler execution', async ({ scopes }) => {
    const handler = vi.fn(() => Promise.resolve({ resource: 'unsafe' }));
    const capability = defineResourceCapability(
      resourceDefinition({
        resolver: (input) => ({
          kind: 'resolved',
          input,
          effectiveResourceScopes: scopes
        }),
        handler
      })
    );
    const dispatcher = dispatcherFor(capability, {
      allowedResourceScopes: new Set(['resource.alpha'])
    });

    await expect(
      dispatcher.dispatch(
        { name: capability.mcpName, arguments: { resource: 'resource.alpha' } },
        { transport: 'stdio' }
      )
    ).resolves.toMatchObject({ kind: 'refused', code: 'RESOURCE_NOT_ALLOWED' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('captures resolver, handler, and selectable scopes without exposing their authority', async () => {
    const originalResolver = vi.fn(resourceDefinition().resolver);
    const replacementResolver = vi.fn(() => {
      throw new Error('SENTINEL_REPLACEMENT');
    });
    const originalHandler = vi.fn(({ resource }: ResolvedInput) => Promise.resolve({ resource }));
    const replacementHandler = vi.fn(() => Promise.resolve({ resource: 'unsafe' }));
    const selectableResourceScopes = ['resource.alpha', 'resource.beta'];
    const source = resourceDefinition({
      selectableResourceScopes,
      resolver: originalResolver,
      handler: originalHandler
    });
    const capability = defineResourceCapability(source);

    Reflect.set(source, 'resolver', replacementResolver);
    Reflect.set(source, 'handler', replacementHandler);
    selectableResourceScopes.splice(0, selectableResourceScopes.length, 'resource.hidden');

    const result = await dispatcherFor(capability, {
      allowedResourceScopes: new Set(['resource.alpha'])
    }).dispatch(
      { name: capability.mcpName, arguments: { resource: 'resource.alpha' } },
      { transport: 'stdio' }
    );

    expect(result).toEqual({ kind: 'success', output: { resource: 'resource.alpha' } });
    expect(originalResolver).toHaveBeenCalledOnce();
    expect(replacementResolver).not.toHaveBeenCalled();
    expect(originalHandler).toHaveBeenCalledOnce();
    expect(replacementHandler).not.toHaveBeenCalled();
    expect(Object.keys(capability)).toEqual([
      'id',
      'mcpName',
      'title',
      'description',
      'inputSchema',
      'outputSchema',
      'annotations',
      'transports',
      'policy',
      'parseInput',
      'parseOutput'
    ]);
    expect(capability.policy.resourceScopes).toEqual(['resource.alpha', 'resource.beta']);
    expect(Reflect.has(capability, 'resolver')).toBe(false);
    expect(Reflect.has(capability, 'selectableResourceScopes')).toBe(false);
  });

  it.each([
    {
      code: 'OPERATION_NOT_AVAILABLE' as const,
      details: { resource: 'resource.alpha', availableOperations: ['list', 'get'] },
      expected: { resource: 'resource.alpha', availableOperations: ['get', 'list'] }
    },
    {
      code: 'INVALID_RESOURCE_INPUT' as const,
      details: { resource: 'resource.alpha', operation: 'get', fields: ['page', 'query'] },
      expected: { resource: 'resource.alpha', operation: 'get', fields: ['page', 'query'] }
    },
    {
      code: 'TARGET_UNAVAILABLE' as const,
      details: { resource: 'resource.alpha', operation: 'get' },
      expected: { resource: 'resource.alpha', operation: 'get' }
    }
  ])('returns bounded $code details from the resolver', async ({ code, details, expected }) => {
    const capability = defineResourceCapability(
      resourceDefinition({
        resolver: () => ({ kind: 'refused', code, details }) as ResourceResolution<ResolvedInput>
      })
    );

    await expect(
      dispatcherFor(capability).dispatch(
        { name: capability.mcpName, arguments: { resource: 'resource.alpha' } },
        { transport: 'stdio' }
      )
    ).resolves.toMatchObject({ kind: 'refused', code, details: expected });
  });

  it('sanitizes malformed resolver results without reflecting rejected values or exceptions', async () => {
    const handler = vi.fn(() => Promise.resolve({ resource: 'unsafe' }));
    const malformed = defineResourceCapability(
      resourceDefinition({
        resolver: () =>
          ({
            kind: 'refused',
            code: 'INVALID_RESOURCE_INPUT',
            details: {
              resource: 'resource.alpha',
              operation: 'get',
              fields: ['SENTINEL SECRET VALUE']
            }
          }) as ResourceResolution<ResolvedInput>,
        handler
      })
    );
    const throwing = defineResourceCapability({
      ...resourceDefinition({ handler }),
      id: 'test.resource.throwing',
      mcpName: 'test_resource_throwing',
      resolver: () => {
        throw new Error('SENTINEL_RESOLVER_EXCEPTION');
      }
    });
    const dispatcher = createCapabilityDispatcher(new CapabilityCatalog([malformed, throwing]), {
      readOnly: true,
      allowedResourceScopes: null,
      enabledFeatureFlags: new Set()
    });

    for (const name of [malformed.mcpName, throwing.mcpName]) {
      const result = await dispatcher.dispatch(
        { name, arguments: { resource: 'resource.alpha' } },
        { transport: 'stdio' }
      );
      expect(result).toEqual({
        kind: 'refused',
        code: 'INVALID_RESOURCE_INPUT',
        message: 'Resource input is invalid.'
      });
      expect(JSON.stringify(result)).not.toContain('SENTINEL');
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('preserves fixed-scope visibility and pre-parse authorization ordering', async () => {
    const parse = vi.fn((value: unknown) => z.object({ value: z.string() }).strict().parse(value));
    const staticCapability = defineCapability({
      id: 'test.static',
      mcpName: 'test_static',
      title: 'Static capability',
      description: 'Retain the foundation all-scopes authorization rule.',
      inputSchema: { parse } as unknown as z.ZodType<{ value: string }>,
      outputSchema: z.object({ value: z.string() }).strict(),
      annotations: { readOnlyHint: true },
      transports: ['stdio'],
      policy: {
        effect: 'read',
        resourceScopes: ['resource.alpha', 'resource.beta'],
        requiredFeatureFlags: [],
        backup: 'none',
        audit: 'none',
        confirmation: 'none',
        timeoutMs: 1000,
        redactFields: []
      },
      handler: (input: { value: string }) => Promise.resolve(input)
    });
    const catalog = new CapabilityCatalog([staticCapability]);
    const dispatcher = createCapabilityDispatcher(catalog, {
      readOnly: true,
      allowedResourceScopes: new Set(['resource.alpha']),
      enabledFeatureFlags: new Set()
    });

    expect(dispatcher.listExposed('stdio')).toEqual([]);
    await expect(
      dispatcher.dispatch(
        { name: staticCapability.mcpName, arguments: { value: 'SENTINEL' } },
        { transport: 'stdio' }
      )
    ).resolves.toMatchObject({ kind: 'refused', code: 'RESOURCE_NOT_ALLOWED' });
    expect(parse).not.toHaveBeenCalled();
  });
});

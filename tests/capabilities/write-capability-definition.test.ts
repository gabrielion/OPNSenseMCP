// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import { describe, expect, it } from 'vitest';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import {
  createCapabilityDispatcher,
  defineWriteCapability,
  isKernelDefinedCapability
} from '../../src/capabilities/kernel.js';
import type { MutationEnvelopeServices } from '../../src/capabilities/types.js';

function baseWriteDefinition(
  overrides: Record<string, unknown> = {}
): Parameters<typeof defineWriteCapability>[0] {
  return {
    id: 'test.envelope-write',
    mcpName: 'test_envelope_write',
    title: 'Test envelope write',
    description: 'Exercise the mutation envelope with synthetic process-local state.',
    inputSchema: z.object({ value: z.string() }).strict(),
    outputSchema: z.object({ applied: z.string() }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    },
    transports: ['stdio', 'http'],
    policy: {
      effect: 'firewall-write',
      resourceScopes: ['test.envelope'],
      requiredFeatureFlags: [],
      backup: 'strict',
      audit: 'required',
      confirmation: 'elicitation',
      timeoutMs: 1000,
      redactFields: []
    },
    preflight: () => Promise.resolve({ effectPlanDigest: 'plan', observedStateDigest: 'state' }),
    handler: ({ value }: { readonly value: string }) => Promise.resolve({ applied: value }),
    verifyOutcome: () => Promise.resolve(true),
    ...overrides
  } as unknown as Parameters<typeof defineWriteCapability>[0];
}

function services(): MutationEnvelopeServices {
  return {
    lock: { acquire: () => Promise.resolve(null) },
    backup: {
      create: () => Promise.resolve({ backupId: 'b' }),
      exists: () => Promise.resolve(true)
    },
    audit: { record: () => undefined }
  };
}

describe('defineWriteCapability', () => {
  it('accepts a well-formed firewall-write and returns a data-only kernel capability', () => {
    const capability = defineWriteCapability(baseWriteDefinition());
    expect(isKernelDefinedCapability(capability)).toBe(true);
    expect(capability.policy.effect).toBe('firewall-write');
    expect(Object.keys(capability)).not.toContain('preflight');
    expect(Object.keys(capability)).not.toContain('verifyOutcome');
    expect(Reflect.get(capability, 'preflight')).toBeUndefined();
    expect(Reflect.get(capability, 'verifyOutcome')).toBeUndefined();
  });

  it('rejects a firewall-write without a strict backup', () => {
    expect(() =>
      defineWriteCapability(
        baseWriteDefinition({
          policy: { ...baseWriteDefinition().policy, backup: 'none' }
        })
      )
    ).toThrow('Invalid capability definition');
  });

  it('rejects a write without required audit', () => {
    expect(() =>
      defineWriteCapability(
        baseWriteDefinition({
          policy: { ...baseWriteDefinition().policy, audit: 'none' }
        })
      )
    ).toThrow('Invalid capability definition');
  });

  it('rejects a read effect', () => {
    expect(() =>
      defineWriteCapability(
        baseWriteDefinition({
          policy: { ...baseWriteDefinition().policy, effect: 'read', backup: 'none' }
        })
      )
    ).toThrow('Invalid capability definition');
  });

  it('rejects a missing or non-function preflight', () => {
    expect(() => defineWriteCapability(baseWriteDefinition({ preflight: 'nope' }))).toThrow(
      'Invalid capability definition'
    );
  });

  it('rejects a missing or non-function verifyOutcome', () => {
    const definition = baseWriteDefinition();
    delete (definition as unknown as Record<string, unknown>).verifyOutcome;
    expect(() => defineWriteCapability(definition)).toThrow('Invalid capability definition');
  });
});

describe('mutation envelope services invariant', () => {
  function options() {
    return {
      readOnly: false,
      allowedResourceScopes: null,
      enabledFeatureFlags: new Set<never>()
    };
  }

  it('throws when a catalog exposes an envelope capability without services', () => {
    const catalog = new CapabilityCatalog([defineWriteCapability(baseWriteDefinition())]);
    expect(() => createCapabilityDispatcher(catalog, options())).toThrow(
      /mutation envelope services/i
    );
  });

  it('accepts an exposed envelope capability when services are supplied', () => {
    const catalog = new CapabilityCatalog([defineWriteCapability(baseWriteDefinition())]);
    expect(() =>
      createCapabilityDispatcher(catalog, options(), undefined, {}, {}, services())
    ).not.toThrow();
  });
});

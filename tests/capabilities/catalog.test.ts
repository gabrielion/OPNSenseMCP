// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import {
  CAPABILITY_CATALOG,
  CapabilityCatalog,
  getCapability
} from '../../src/capabilities/catalog.js';
import { areDeclaredResourceScopesAllowed } from '../../src/capabilities/exposure.js';
import { defineResourceCapability } from '../../src/capabilities/kernel.js';
import type { FeatureFlag } from '../../src/config/feature-flags.js';
import { createMutationFixture, createReadFixture } from '../fixtures/capabilities.js';

describe('CapabilityCatalog', () => {
  it('indexes stable IDs and MCP names', () => {
    const read = createReadFixture();
    const catalog = new CapabilityCatalog([read]);

    expect(catalog.getById('test.read')).toBe(read);
    expect(catalog.getByMcpName('test_read')).toBe(read);
    expect(catalog.getByMcpName('missing')).toBeUndefined();
  });

  it('rejects duplicate IDs and duplicate MCP names', () => {
    const read = createReadFixture();
    const duplicateName = createMutationFixture(() => undefined, { mcpName: read.mcpName });

    expect(() => new CapabilityCatalog([read, read])).toThrow('Duplicate capability id: test.read');
    expect(() => new CapabilityCatalog([read, duplicateName])).toThrow(
      'Duplicate MCP capability name: test_read'
    );
  });

  it('freezes the catalog instance after constructing its indexes', () => {
    const catalog = new CapabilityCatalog([createReadFixture()]);
    const all = catalog.all;

    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Reflect.set(catalog, 'all', [])).toBe(false);
    expect(catalog.all).toBe(all);
  });

  it('hides writes in read-only mode and keeps direct metadata immutable', () => {
    const read = createReadFixture();
    const write = createMutationFixture();
    const catalog = new CapabilityCatalog([read, write]);

    const exposed = catalog.listExposed({
      readOnly: true,
      transport: 'stdio',
      enabledFeatureFlags: new Set(),
      allowedResourceScopes: null
    });

    expect(exposed).toEqual([read]);
    expect(Object.isFrozen(exposed)).toBe(true);
    expect(Object.isFrozen(catalog.all)).toBe(true);
    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(read.annotations)).toBe(true);
    expect(Object.isFrozen(read.policy)).toBe(true);
    expect(Object.isFrozen(read.policy.resourceScopes)).toBe(true);
  });

  it('filters capabilities unavailable on the selected transport', () => {
    const httpOnly = createReadFixture({ transports: ['http'] });
    const catalog = new CapabilityCatalog([httpOnly]);

    expect(
      catalog.listExposed({
        readOnly: false,
        transport: 'stdio',
        enabledFeatureFlags: new Set(),
        allowedResourceScopes: null
      })
    ).toEqual([]);
  });

  it('filters capabilities whose feature flags are disabled', () => {
    const sshOnly = createReadFixture({ requiredFeatureFlags: ['ssh'] });
    const catalog = new CapabilityCatalog([sshOnly]);

    expect(
      catalog.listExposed({
        readOnly: false,
        transport: 'stdio',
        enabledFeatureFlags: new Set(),
        allowedResourceScopes: null
      })
    ).toEqual([]);
  });

  it.each([
    {
      label: 'partially allowed',
      scopes: ['test.read', 'restricted'],
      allowed: new Set(['test.read'])
    },
    { label: 'disallowed', scopes: ['restricted'], allowed: new Set(['test.read']) },
    { label: 'empty', scopes: [], allowed: new Set(['test.read']) }
  ])('filters $label declared scopes with an active resource allow-list', ({ scopes, allowed }) => {
    const capability = createReadFixture({ resourceScopes: scopes });
    const catalog = new CapabilityCatalog([capability]);

    expect(
      catalog.listExposed({
        readOnly: false,
        transport: 'stdio',
        enabledFeatureFlags: new Set(),
        allowedResourceScopes: allowed
      })
    ).toEqual([]);
  });

  it('exposes only fully allowed declared scopes when an allow-list is active', () => {
    const capability = createReadFixture({ resourceScopes: ['test.read', 'test.related'] });
    const catalog = new CapabilityCatalog([capability]);

    expect(
      catalog.listExposed({
        readOnly: false,
        transport: 'stdio',
        enabledFeatureFlags: new Set(),
        allowedResourceScopes: new Set(['test.read', 'test.related'])
      })
    ).toEqual([capability]);
  });

  it('exposes a closed resource capability when any selectable scope is allowed', () => {
    const capability = defineResourceCapability({
      id: 'test.resource.catalog',
      mcpName: 'test_resource_catalog',
      title: 'Resource catalog fixture',
      description: 'Exercise selectable resource scope exposure.',
      inputSchema: z.object({ resource: z.string() }).strict(),
      outputSchema: z.object({ resource: z.string() }).strict(),
      annotations: { readOnlyHint: true },
      transports: ['stdio'],
      selectableResourceScopes: ['resource.alpha', 'resource.beta'],
      resolver: (input, { visibleResourceScopes }) => ({
        kind: 'resolved',
        input,
        effectiveResourceScopes: visibleResourceScopes.includes(input.resource)
          ? [input.resource]
          : []
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
      handler: ({ resource }) => Promise.resolve({ resource })
    });
    const catalog = new CapabilityCatalog([capability]);
    const context = {
      readOnly: true,
      transport: 'stdio' as const,
      enabledFeatureFlags: new Set<FeatureFlag>()
    };

    expect(
      catalog.listExposed({
        ...context,
        allowedResourceScopes: new Set(['resource.alpha'])
      })
    ).toEqual([capability]);
    expect(
      catalog.listExposed({ ...context, allowedResourceScopes: new Set(['resource.hidden']) })
    ).toEqual([]);
  });

  it('keeps empty declared scopes eligible when no allow-list is active', () => {
    const capability = createReadFixture({ resourceScopes: [] });
    const catalog = new CapabilityCatalog([capability]);

    expect(
      catalog.listExposed({
        readOnly: false,
        transport: 'stdio',
        enabledFeatureFlags: new Set(),
        allowedResourceScopes: null
      })
    ).toEqual([capability]);
  });

  it('shares the exact resource-scope predicate used by dispatch authorization', () => {
    expect(areDeclaredResourceScopesAllowed([], null)).toBe(true);
    expect(areDeclaredResourceScopesAllowed([], new Set())).toBe(false);
    expect(areDeclaredResourceScopesAllowed(['one', 'two'], new Set(['one', 'two']))).toBe(true);
    expect(areDeclaredResourceScopesAllowed(['one', 'two'], new Set(['one']))).toBe(false);
  });

  it('ships only the read-only server status capability', () => {
    expect(CAPABILITY_CATALOG.all.map((capability) => capability.mcpName)).toEqual([
      'server_status'
    ]);
    expect(getCapability('server_status')?.policy.effect).toBe('read');
    expect(getCapability('missing')).toBeUndefined();
  });
});

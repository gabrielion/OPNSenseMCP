// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import {
  CAPABILITY_CATALOG,
  CapabilityCatalog,
  createProductCapabilityCatalog,
  getCapability
} from '../../src/capabilities/catalog.js';
import { areDeclaredResourceScopesAllowed } from '../../src/capabilities/exposure.js';
import {
  createCapabilityDispatcher,
  defineResourceCapability
} from '../../src/capabilities/kernel.js';
import type { FeatureFlag } from '../../src/config/feature-flags.js';
import type { OPNsenseReadAdapter } from '../../src/opnsense/read-adapter.js';
import type { OPNsenseAliasAdapter } from '../../src/opnsense/alias-adapter.js';
import type { MutationEnvelopeServices } from '../../src/capabilities/types.js';
import { createMutationFixture, createReadFixture } from '../fixtures/capabilities.js';
import { KNOWN_RESOURCE_SCOPES } from '../../src/capabilities/resource-scopes.js';

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
      refusalDetailVocabulary: { operations: [], fields: [] },
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

  it('ships the final four-tool Product 1A read-only surface', () => {
    expect(CAPABILITY_CATALOG.all.map((capability) => capability.mcpName)).toEqual([
      'server_status',
      'opn_describe',
      'opn_get',
      'opn_list'
    ]);
    for (const name of ['server_status', 'opn_describe', 'opn_get', 'opn_list']) {
      expect(getCapability(name)?.policy.effect).toBe('read');
    }
    expect(getCapability('missing')).toBeUndefined();
  });
});

describe('product catalog write surface', () => {
  const readAdapter: OPNsenseReadAdapter = {
    available: true,
    getSystemStatus: () => Promise.reject(new Error('unused')),
    listServices: () => Promise.reject(new Error('unused'))
  };
  const aliasAdapter: OPNsenseAliasAdapter = {
    available: true,
    searchHostAliases: () => Promise.reject(new Error('unused')),
    createHostAlias: () => Promise.reject(new Error('unused')),
    deleteHostAlias: () => Promise.reject(new Error('unused'))
  };
  const services: MutationEnvelopeServices = {
    lock: { acquire: () => Promise.resolve({ release: () => Promise.resolve() }) },
    backup: {
      create: () => Promise.resolve({ backupId: 'b' }),
      exists: () => Promise.resolve(true)
    },
    audit: { record: () => undefined }
  };
  const options = {
    readOnly: false,
    allowedResourceScopes: null,
    enabledFeatureFlags: new Set<never>()
  };

  it('registers the create and delete verbs when the alias adapter is available', () => {
    expect(
      createProductCapabilityCatalog(readAdapter, aliasAdapter).all.map((c) => c.mcpName)
    ).toEqual(['server_status', 'opn_describe', 'opn_get', 'opn_list', 'opn_create', 'opn_delete']);
  });

  it('omits the write verbs when the alias adapter is unavailable', () => {
    expect(createProductCapabilityCatalog(readAdapter).all.map((c) => c.mcpName)).toEqual([
      'server_status',
      'opn_describe',
      'opn_get',
      'opn_list'
    ]);
  });

  it('hides the write verbs under READ_ONLY', () => {
    const exposed = createProductCapabilityCatalog(readAdapter, aliasAdapter).listExposed({
      readOnly: true,
      transport: 'stdio',
      enabledFeatureFlags: new Set(),
      allowedResourceScopes: null
    });
    expect(exposed.map((c) => c.mcpName)).toEqual([
      'server_status',
      'opn_describe',
      'opn_get',
      'opn_list'
    ]);
  });

  it('refuses to construct a dispatcher exposing write verbs without envelope services', () => {
    const catalog = createProductCapabilityCatalog(readAdapter, aliasAdapter);
    expect(() => createCapabilityDispatcher(catalog, options)).toThrow(
      'Mutation envelope services are required to expose a write capability'
    );
  });

  it('constructs a dispatcher exposing write verbs when services are provided', () => {
    const catalog = createProductCapabilityCatalog(readAdapter, aliasAdapter);
    expect(() =>
      createCapabilityDispatcher(catalog, options, undefined, {}, {}, services)
    ).not.toThrow();
  });
});

describe('write containment (P0-B)', () => {
  const aliasAdapter = {
    available: true,
    listHostAliases: () => Promise.resolve({ items: [], total: 0 }),
    createHostAlias: () => Promise.resolve({ item: { uuid: 'u', name: 'n' } }),
    deleteHostAlias: () => Promise.resolve({ item: { id: 'u' } }),
    reconfigure: () => Promise.resolve()
  } as unknown as OPNsenseAliasAdapter;
  const readAdapter = { available: true } as unknown as OPNsenseReadAdapter;
  const catalog = createProductCapabilityCatalog(readAdapter, aliasAdapter);
  const expose = (
    allowedResourceScopes: ReadonlySet<string> | null,
    enabledFeatureFlags: ReadonlySet<FeatureFlag>
  ): readonly string[] =>
    catalog
      .listExposed({
        readOnly: false,
        transport: 'stdio',
        enabledFeatureFlags,
        allowedResourceScopes
      })
      .map(({ mcpName }) => mcpName);

  it('authorizes every read but no write when the allow-list is absent', () => {
    // An absent allow-list still means "every catalogued scope" for reads, but a write must always
    // be authorized by an explicitly named scope.
    expect(expose(null, new Set(['experimental-alias-write']))).toEqual([
      'server_status',
      'opn_describe',
      'opn_get',
      'opn_list'
    ]);
  });

  it('exposes alias writes only with the flag and an explicit firewall.alias scope', () => {
    const scopes = new Set(['firewall.alias']);

    expect(expose(scopes, new Set())).not.toContain('opn_create');
    expect(expose(scopes, new Set(['experimental-alias-write']))).toContain('opn_create');
    expect(expose(scopes, new Set(['experimental-alias-write']))).toContain('opn_delete');
  });

  it('keeps every declared capability scope inside the sealed vocabulary', () => {
    const declared = new Set<string>();
    for (const capability of catalog.all) {
      for (const scope of capability.policy.resourceScopes) declared.add(scope);
    }
    for (const scope of ['firewall.alias', 'core.services', 'system.status']) declared.add(scope);

    // A scope a capability declares but ALLOWED_RESOURCES cannot name is a trap: the operator
    // writes the obvious list and a tool silently disappears.
    for (const scope of declared) expect(KNOWN_RESOURCE_SCOPES.has(scope)).toBe(true);
  });
});

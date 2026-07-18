// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_CATALOG,
  CapabilityCatalog,
  getCapability
} from '../../src/capabilities/catalog.js';
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
    const duplicateName = { ...createMutationFixture(), mcpName: read.mcpName };

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
    const read = createReadFixture();
    const httpOnly = { ...read, transports: ['http'] as const };
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
    const read = createReadFixture();
    const sshOnly = {
      ...read,
      policy: { ...read.policy, requiredFeatureFlags: ['ssh'] as const }
    };
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

  it('filters capabilities outside the active resource scope allow-list', () => {
    const read = createReadFixture();
    const restricted = {
      ...read,
      policy: { ...read.policy, resourceScopes: ['restricted'] as const }
    };
    const catalog = new CapabilityCatalog([restricted]);

    expect(
      catalog.listExposed({
        readOnly: false,
        transport: 'stdio',
        enabledFeatureFlags: new Set(),
        allowedResourceScopes: new Set(['test.read'])
      })
    ).toEqual([]);
  });

  it('ships only the read-only server status capability', () => {
    expect(CAPABILITY_CATALOG.all.map((capability) => capability.mcpName)).toEqual([
      'server_status'
    ]);
    expect(getCapability('server_status')?.policy.effect).toBe('read');
    expect(getCapability('missing')).toBeUndefined();
  });
});

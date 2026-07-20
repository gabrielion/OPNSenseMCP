// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import { createCapabilityDispatcher } from '../../src/capabilities/kernel.js';
import { createOPNsenseListCapability } from '../../src/capabilities/opnsense/list.js';
import {
  UNAVAILABLE_OPNSENSE_ALIAS_ADAPTER,
  type OPNsenseAliasAdapter
} from '../../src/opnsense/alias-adapter.js';
import {
  UNAVAILABLE_OPNSENSE_READ_ADAPTER,
  type OPNsenseReadAdapter
} from '../../src/opnsense/read-adapter.js';
import type { CapabilityResult } from '../../src/capabilities/types.js';

const UUID = '11111111-2222-3333-4444-555555555555';

function dispatch(
  readAdapter: OPNsenseReadAdapter,
  aliasAdapter: OPNsenseAliasAdapter,
  args: Record<string, unknown>
): Promise<CapabilityResult> {
  const dispatcher = createCapabilityDispatcher(
    new CapabilityCatalog([createOPNsenseListCapability(readAdapter, aliasAdapter)]),
    { readOnly: false, allowedResourceScopes: null, enabledFeatureFlags: new Set<never>() },
    undefined,
    {},
    {}
  );
  return dispatcher.dispatch({ name: 'opn_list', arguments: args }, { transport: 'stdio' });
}

function readAdapterWith(listServices: OPNsenseReadAdapter['listServices']): OPNsenseReadAdapter {
  return { available: true, getSystemStatus: vi.fn(), listServices };
}

function aliasAdapterWith(
  searchHostAliases: OPNsenseAliasAdapter['searchHostAliases']
): OPNsenseAliasAdapter {
  return { available: true, searchHostAliases, createHostAlias: vi.fn(), deleteHostAlias: vi.fn() };
}

describe('opn_list multi-resource dispatch', () => {
  it('dispatches firewall.alias to the alias adapter and returns alias rows', async () => {
    const searchHostAliases = vi.fn().mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 1,
      items: [{ uuid: UUID, name: 'lab_hosts', type: 'host', description: 'lab' }]
    });
    const result = await dispatch(
      UNAVAILABLE_OPNSENSE_READ_ADAPTER,
      aliasAdapterWith(searchHostAliases),
      { resource: 'firewall.alias', page: 1, pageSize: 10, query: 'lab' }
    );
    expect(result).toEqual({
      kind: 'success',
      output: {
        page: 1,
        pageSize: 10,
        total: 1,
        items: [{ uuid: UUID, name: 'lab_hosts', type: 'host', description: 'lab' }]
      }
    });
    expect(searchHostAliases).toHaveBeenCalledWith(
      { page: 1, pageSize: 10, query: 'lab' },
      expect.anything()
    );
  });

  it('still dispatches core.services to the read adapter', async () => {
    const listServices = vi.fn().mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 1,
      items: [{ id: 'svc-1', name: 'dnsmasq', description: 'DNS', status: 'running' }]
    });
    const result = await dispatch(
      readAdapterWith(listServices),
      UNAVAILABLE_OPNSENSE_ALIAS_ADAPTER,
      { resource: 'core.services', page: 1, pageSize: 10, query: '' }
    );
    expect(result).toMatchObject({
      kind: 'success',
      output: { items: [{ id: 'svc-1', name: 'dnsmasq', description: 'DNS', status: 'running' }] }
    });
    expect(listServices).toHaveBeenCalledOnce();
  });

  it('refuses firewall.alias when the alias adapter is unavailable', async () => {
    const result = await dispatch(
      UNAVAILABLE_OPNSENSE_READ_ADAPTER,
      UNAVAILABLE_OPNSENSE_ALIAS_ADAPTER,
      { resource: 'firewall.alias', page: 1, pageSize: 10, query: '' }
    );
    expect(result).toMatchObject({
      kind: 'refused',
      code: 'TARGET_UNAVAILABLE',
      details: { resource: 'firewall.alias', operation: 'list' }
    });
  });

  it('refuses list on a resource without a list operation', async () => {
    const result = await dispatch(readAdapterWith(vi.fn()), aliasAdapterWith(vi.fn()), {
      resource: 'system.status',
      page: 1,
      pageSize: 10,
      query: ''
    });
    expect(result).toMatchObject({
      kind: 'refused',
      code: 'OPERATION_NOT_AVAILABLE',
      details: { resource: 'system.status', availableOperations: ['get'] }
    });
  });
});

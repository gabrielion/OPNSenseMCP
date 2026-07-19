// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import {
  createApplicationContext,
  dispatchApplicationCapability,
  listApplicationCapabilities
} from '../../src/app/application-context.js';
import { createProductCapabilityCatalog } from '../../src/capabilities/catalog.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';
import {
  UNAVAILABLE_OPNSENSE_READ_ADAPTER,
  type OPNsenseReadAdapter
} from '../../src/opnsense/read-adapter.js';

function config(allowedResourceScopes: ReadonlySet<string> | null = null): RuntimeConfig {
  return {
    readOnly: true,
    allowedResourceScopes,
    enabledFeatureFlags: new Set(),
    requestStateKey: new TextEncoder().encode('0123456789abcdef0123456789abcdef'),
    http: {
      enabled: false,
      host: '127.0.0.1',
      port: 3000,
      allowedHosts: ['localhost'],
      allowedOrigins: [],
      legacySseEnabled: false
    }
  };
}

function dispatch(
  name: string,
  argumentsValue: unknown,
  adapter: OPNsenseReadAdapter = UNAVAILABLE_OPNSENSE_READ_ADAPTER,
  allowedResourceScopes: ReadonlySet<string> | null = null
) {
  const application = createApplicationContext(
    config(allowedResourceScopes),
    createProductCapabilityCatalog(adapter)
  );
  return dispatchApplicationCapability(
    application,
    { name, arguments: argumentsValue },
    { transport: 'stdio' }
  );
}

describe('closed Product 1A read capabilities', () => {
  it('keeps all four read tools discoverable under READ_ONLY without target configuration', async () => {
    const application = createApplicationContext(config());
    for (const transport of ['stdio', 'http'] as const) {
      expect(
        listApplicationCapabilities(application, transport).map(({ mcpName }) => mcpName)
      ).toEqual(['server_status', 'opn_describe', 'opn_get', 'opn_list']);
    }
    await expect(dispatch('opn_get', { resource: 'system.status' })).resolves.toMatchObject({
      kind: 'refused',
      code: 'TARGET_UNAVAILABLE',
      details: { resource: 'system.status', operation: 'get' }
    });
    await expect(
      dispatch('opn_list', { resource: 'core.services', page: 1, pageSize: 10, query: '' })
    ).resolves.toMatchObject({
      kind: 'refused',
      code: 'TARGET_UNAVAILABLE',
      details: { resource: 'core.services', operation: 'list' }
    });
  });

  it('returns operation availability only for a visible known wrong verb', async () => {
    await expect(dispatch('opn_get', { resource: 'core.services' })).resolves.toMatchObject({
      kind: 'refused',
      code: 'OPERATION_NOT_AVAILABLE',
      details: { resource: 'core.services', availableOperations: ['list'] }
    });
    await expect(
      dispatch('opn_list', { resource: 'system.status', page: 1, pageSize: 10, query: '' })
    ).resolves.toMatchObject({
      kind: 'refused',
      code: 'OPERATION_NOT_AVAILABLE',
      details: { resource: 'system.status', availableOperations: ['get'] }
    });
  });

  it('uses visible-only unknown-resource refusals for hidden and unknown forged calls', async () => {
    const sentinel = 'SENTINEL_HIDDEN_OR_UNKNOWN';
    for (const resource of ['core.services', sentinel]) {
      const result = await dispatch(
        'opn_get',
        { resource },
        UNAVAILABLE_OPNSENSE_READ_ADAPTER,
        new Set(['system.status'])
      );
      expect(result).toMatchObject({
        kind: 'refused',
        code: 'UNKNOWN_RESOURCE',
        details: { suggestions: ['system.status'] }
      });
      expect(JSON.stringify(result)).not.toContain(sentinel);
      expect(JSON.stringify(result)).not.toContain('core.services');
    }
  });

  it('strictly rejects extra or malformed generic inputs before the adapter', async () => {
    const getSystemStatus = vi.fn().mockResolvedValue({ item: { status: 'ok' } });
    const listServices = vi.fn().mockResolvedValue({ page: 1, pageSize: 10, total: 0, items: [] });
    const adapter: OPNsenseReadAdapter = {
      available: true,
      getSystemStatus,
      listServices
    };
    await expect(
      dispatch('opn_get', { resource: 'system.status', extra: 'SENTINEL' }, adapter)
    ).resolves.toMatchObject({ kind: 'refused', code: 'INVALID_INPUT' });
    await expect(
      dispatch(
        'opn_list',
        { resource: 'core.services', page: 0, pageSize: 101, query: '', extra: true },
        adapter
      )
    ).resolves.toMatchObject({ kind: 'refused', code: 'INVALID_INPUT' });
    expect(getSystemStatus).not.toHaveBeenCalled();
    expect(listServices).not.toHaveBeenCalled();
  });

  it('authorizes only the selected visible resource on direct calls', async () => {
    const getSystemStatus = vi.fn().mockResolvedValue({ item: { status: 'ok' } });
    const listServices = vi.fn().mockResolvedValue({ page: 1, pageSize: 10, total: 0, items: [] });
    const adapter: OPNsenseReadAdapter = {
      available: true,
      getSystemStatus,
      listServices
    };
    await expect(
      dispatch('opn_get', { resource: 'system.status' }, adapter, new Set(['system.status']))
    ).resolves.toEqual({ kind: 'success', output: { item: { status: 'ok' } } });
    await expect(
      dispatch(
        'opn_list',
        { resource: 'core.services', page: 1, pageSize: 10, query: '' },
        adapter,
        new Set(['system.status'])
      )
    ).resolves.toMatchObject({ kind: 'refused', code: 'UNKNOWN_RESOURCE' });
    expect(getSystemStatus).toHaveBeenCalledOnce();
    expect(listServices).not.toHaveBeenCalled();
  });

  it('projects runtime adapter failures to the fixed kernel refusal', async () => {
    const adapter: OPNsenseReadAdapter = {
      available: true,
      getSystemStatus: vi.fn().mockRejectedValue(new Error('SENTINEL_TLS_OR_UPSTREAM_ERROR')),
      listServices: vi.fn().mockRejectedValue(new Error('SENTINEL_TLS_OR_UPSTREAM_ERROR'))
    };
    const result = await dispatch('opn_get', { resource: 'system.status' }, adapter);
    expect(result).toEqual({
      kind: 'refused',
      code: 'EXECUTION_FAILED',
      message: 'Capability execution failed.'
    });
    expect(JSON.stringify(result)).not.toContain('SENTINEL');
  });
});

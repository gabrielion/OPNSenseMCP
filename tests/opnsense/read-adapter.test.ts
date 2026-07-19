// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { OPNsenseHttpsClient } from '../../src/opnsense/https-client.js';
import { createOPNsenseReadAdapter } from '../../src/opnsense/read-adapter.js';

describe('reviewed OPNsense read adapter', () => {
  it('normalizes status and service fields and sends the exact Bootgrid request', async () => {
    const request = vi
      .fn<OPNsenseHttpsClient['request']>()
      .mockResolvedValueOnce({ status: 'ok', secret: 'SENTINEL_DROP' })
      .mockResolvedValueOnce({
        total: 1,
        rowCount: 25,
        current: 2,
        rows: [
          {
            id: 'svc-1',
            name: 'unbound',
            description: 'Resolver',
            status: 'running',
            secret: 'SENTINEL_DROP'
          }
        ],
        secret: 'SENTINEL_DROP'
      });
    const adapter = createOPNsenseReadAdapter({ request, close: vi.fn() });
    const signal = new AbortController().signal;

    await expect(adapter.getSystemStatus(signal)).resolves.toEqual({ item: { status: 'ok' } });
    await expect(
      adapter.listServices({ page: 2, pageSize: 25, query: 'dns' }, signal)
    ).resolves.toEqual({
      page: 2,
      pageSize: 25,
      total: 1,
      items: [{ id: 'svc-1', name: 'unbound', description: 'Resolver', status: 'running' }]
    });
    expect(request).toHaveBeenNthCalledWith(1, {
      operation: 'system.status/get',
      signal
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      operation: 'core.services/list',
      payload: { current: 2, rowCount: 25, sort: {}, searchPhrase: 'dns' },
      signal
    });
  });

  it.each([
    { total: 1, rowCount: 10, current: 2, rows: [] },
    { total: 1, rowCount: 11, current: 1, rows: [] },
    {
      total: 2,
      rowCount: 1,
      current: 1,
      rows: [
        { id: 'a', name: 'a', description: '', status: 'running' },
        { id: 'b', name: 'b', description: '', status: 'running' }
      ]
    },
    { total: 1_000_001, rowCount: 10, current: 1, rows: [] }
  ])('rejects an invalid upstream page without exposing it', async (response) => {
    const adapter = createOPNsenseReadAdapter({
      request: vi.fn().mockResolvedValue(response),
      close: vi.fn()
    });
    await expect(
      adapter.listServices(
        { page: 1, pageSize: response.rowCount === 1 ? 1 : 10, query: '' },
        new AbortController().signal
      )
    ).rejects.toThrow();
  });
});

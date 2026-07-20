// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { OPNsenseHttpsClient } from '../../src/opnsense/https-client.js';
import { createOPNsenseAliasAdapter } from '../../src/opnsense/alias-adapter.js';

const UUID = '11111111-2222-3333-4444-555555555555';

describe('reviewed OPNsense firewall-alias adapter', () => {
  it('creates a host alias by adding then reconfiguring and returns the created uuid', async () => {
    const request = vi
      .fn<OPNsenseHttpsClient['request']>()
      .mockResolvedValueOnce({ result: 'saved', uuid: UUID })
      .mockResolvedValueOnce({ status: 'ok' });
    const adapter = createOPNsenseAliasAdapter({ request, close: vi.fn() });
    const signal = new AbortController().signal;

    await expect(
      adapter.createHostAlias(
        {
          name: 'lab_hosts',
          type: 'host',
          content: ['192.0.2.10', 'host.example'],
          description: 'lab'
        },
        signal
      )
    ).resolves.toEqual({
      item: {
        uuid: UUID,
        name: 'lab_hosts',
        type: 'host',
        content: ['192.0.2.10', 'host.example'],
        description: 'lab'
      }
    });
    expect(request).toHaveBeenNthCalledWith(1, {
      operation: 'firewall.alias/create',
      payload: {
        alias: {
          enabled: '1',
          name: 'lab_hosts',
          type: 'host',
          content: '192.0.2.10\nhost.example',
          description: 'lab'
        }
      },
      signal
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      operation: 'firewall.alias/reconfigure',
      signal
    });
  });

  it('rejects a failed add without reconfiguring', async () => {
    const request = vi
      .fn<OPNsenseHttpsClient['request']>()
      .mockResolvedValueOnce({ result: 'failed', validations: { 'alias.name': 'in use' } });
    const adapter = createOPNsenseAliasAdapter({ request, close: vi.fn() });

    await expect(
      adapter.createHostAlias(
        { name: 'dup', type: 'host', content: ['192.0.2.1'], description: '' },
        new AbortController().signal
      )
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects when reconfigure does not report an applied status', async () => {
    const request = vi
      .fn<OPNsenseHttpsClient['request']>()
      .mockResolvedValueOnce({ result: 'saved', uuid: UUID })
      .mockResolvedValueOnce({ status: 'error' });
    const adapter = createOPNsenseAliasAdapter({ request, close: vi.fn() });

    await expect(
      adapter.createHostAlias(
        { name: 'x', type: 'host', content: ['192.0.2.1'], description: '' },
        new AbortController().signal
      )
    ).rejects.toThrow();
  });

  it('deletes an alias by delItem then reconfigure and echoes the id', async () => {
    const request = vi
      .fn<OPNsenseHttpsClient['request']>()
      .mockResolvedValueOnce({ result: 'deleted' })
      .mockResolvedValueOnce({ status: 'ok' });
    const adapter = createOPNsenseAliasAdapter({ request, close: vi.fn() });
    const signal = new AbortController().signal;

    await expect(adapter.deleteHostAlias(UUID, signal)).resolves.toEqual({ item: { id: UUID } });
    expect(request).toHaveBeenNthCalledWith(1, {
      operation: 'firewall.alias/delete',
      id: UUID,
      signal
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      operation: 'firewall.alias/reconfigure',
      signal
    });
  });

  it('searches host aliases into a bounded page and drops upstream extras', async () => {
    const request = vi.fn<OPNsenseHttpsClient['request']>().mockResolvedValueOnce({
      total: 1,
      rowCount: 25,
      current: 2,
      rows: [
        {
          uuid: UUID,
          name: 'lab_hosts',
          type: 'host',
          description: 'lab',
          enabled: '1',
          secret: 'SENTINEL_DROP'
        }
      ]
    });
    const adapter = createOPNsenseAliasAdapter({ request, close: vi.fn() });
    const signal = new AbortController().signal;

    await expect(
      adapter.searchHostAliases({ page: 2, pageSize: 25, query: 'lab' }, signal)
    ).resolves.toEqual({
      page: 2,
      pageSize: 25,
      total: 1,
      items: [{ uuid: UUID, name: 'lab_hosts', type: 'host', description: 'lab' }]
    });
    expect(request).toHaveBeenNthCalledWith(1, {
      operation: 'firewall.alias/list',
      payload: { current: 2, rowCount: 25, sort: {}, searchPhrase: 'lab' },
      signal
    });
  });

  it('rejects a malformed alias row without exposing it', async () => {
    const request = vi.fn<OPNsenseHttpsClient['request']>().mockResolvedValueOnce({
      total: 1,
      rowCount: 25,
      current: 1,
      rows: [{ uuid: UUID, name: '', type: 'host', description: 'x' }]
    });
    const adapter = createOPNsenseAliasAdapter({ request, close: vi.fn() });

    await expect(
      adapter.searchHostAliases({ page: 1, pageSize: 25, query: '' }, new AbortController().signal)
    ).rejects.toThrow();
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { OPNsenseHttpsClient } from '../../src/opnsense/https-client.js';
import { createOPNsenseReadAdapter } from '../../src/opnsense/read-adapter.js';

describe('reviewed OPNsense read adapter', () => {
  it('normalizes status and service fields and sends the exact Bootgrid request', async () => {
    const request = vi
      .fn<OPNsenseHttpsClient['request']>()
      .mockResolvedValueOnce({
        metadata: {
          system: { status: 'ok', title: 'System status', message: 'Ready' },
          translations: { dialogTitle: 'Details', dialogCloseButton: 'Close' },
          subsystems: []
        },
        subsystems: {},
        secret: 'SENTINEL_DROP'
      })
      .mockResolvedValueOnce({
        total: 1,
        rowCount: 25,
        current: 2,
        rows: [
          {
            id: 'svc-1',
            name: 'unbound',
            description: 'Resolver',
            running: 1,
            locked: 0,
            secret: 'SENTINEL_DROP'
          }
        ],
        secret: 'SENTINEL_DROP'
      });
    const adapter = createOPNsenseReadAdapter({
      request,
      close: vi.fn(),
      downloadConfigBackup: vi.fn()
    });
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
        { id: 'a', name: 'a', description: '', running: 1, locked: 0 },
        { id: 'b', name: 'b', description: '', running: 1, locked: 0 }
      ]
    },
    { total: 1_000_001, rowCount: 10, current: 1, rows: [] }
  ])('rejects an invalid upstream page without exposing it', async (response) => {
    const adapter = createOPNsenseReadAdapter({
      request: vi.fn().mockResolvedValue(response),
      close: vi.fn(),
      downloadConfigBackup: vi.fn()
    });
    await expect(
      adapter.listServices(
        { page: 1, pageSize: response.rowCount === 1 ? 1 : 10, query: '' },
        new AbortController().signal
      )
    ).rejects.toThrow();
  });

  // OPNsense clamps the Bootgrid `rowCount` it echoes down to the number of rows it actually
  // returned, so a legitimate request routinely comes back with a smaller rowCount than was
  // asked for. Observed on the disposable OPNsense 26.7 VM, which serves 12 services:
  //   requested rowCount=13/25/100 → total=12 rowCount=12 rows=12
  //   requested current=3 rowCount=5 → total=12 rowCount=2  rows=2   (last partial page)
  //   requested current=4 rowCount=5 → total=12 rowCount=0  rows=0   (past the end)
  // The sibling alias adapter already tolerates this; the services path did not, so every
  // `opn_list core.services` asking for more rows than exist — including the schema's own
  // advertised maximum of 100 — failed as EXECUTION_FAILED.
  it.each([
    {
      label: 'a page larger than the collection',
      response: { total: 12, rowCount: 12, current: 1, rows: 12 },
      input: { page: 1, pageSize: 100, query: '' },
      expectedItems: 12
    },
    {
      label: 'the last partial page',
      response: { total: 12, rowCount: 2, current: 3, rows: 2 },
      input: { page: 3, pageSize: 5, query: '' },
      expectedItems: 2
    },
    {
      label: 'a page past the end of the collection',
      response: { total: 12, rowCount: 0, current: 4, rows: 0 },
      input: { page: 4, pageSize: 5, query: '' },
      expectedItems: 0
    }
  ])(
    'accepts a clamped upstream rowCount for $label',
    async ({ response, input, expectedItems }) => {
      const rows = Array.from({ length: response.rows }, (_unused, index) => ({
        id: `svc-${String(index)}`,
        name: `svc-${String(index)}`,
        description: '',
        running: 1,
        locked: 0
      }));
      const adapter = createOPNsenseReadAdapter({
        request: vi.fn().mockResolvedValue({ ...response, rows }),
        close: vi.fn(),
        downloadConfigBackup: vi.fn()
      });

      const page = await adapter.listServices(input, new AbortController().signal);

      // The page reports the size that was requested, not the clamped echo: the caller asked for
      // pages of `pageSize`, and `total` is what tells them how many rows exist.
      expect(page).toEqual({
        page: input.page,
        pageSize: input.pageSize,
        total: response.total,
        items: rows.map(({ id, name, description }) => ({
          id,
          name,
          description,
          status: 'running'
        }))
      });
      expect(page.items).toHaveLength(expectedItems);
    }
  );

  // OPNsense 26.7 makes metadata.system.status polymorphic: the controller seeds it with the
  // raw SystemStatusCode enum VALUE (an integer) and only replaces it with the enum NAME once a
  // subsystem has posted a status. A least-privilege API client on a freshly booted firewall
  // therefore receives the integer, which a string-only schema rejects.
  // Enum: ERROR = -1, WARNING = 0, NOTICE = 1, OK = 2.
  it.each([
    [2, 'OK'],
    [1, 'NOTICE'],
    [0, 'WARNING'],
    [-1, 'ERROR']
  ])('maps the numeric system status %i to %s', async (code, expected) => {
    const adapter = createOPNsenseReadAdapter({
      request: vi.fn().mockResolvedValue({
        metadata: {
          system: { status: code, title: 'System', message: 'No pending messages' },
          translations: { dialogTitle: 'System Status', dialogCloseButton: 'Close' },
          subsystems: []
        }
      }),
      close: vi.fn(),
      downloadConfigBackup: vi.fn()
    });
    await expect(adapter.getSystemStatus(new AbortController().signal)).resolves.toEqual({
      item: { status: expected }
    });
  });

  it('still passes a string system status through unchanged', async () => {
    const adapter = createOPNsenseReadAdapter({
      request: vi.fn().mockResolvedValue({
        metadata: { system: { status: 'WARNING' }, translations: {}, subsystems: [] }
      }),
      close: vi.fn(),
      downloadConfigBackup: vi.fn()
    });
    await expect(adapter.getSystemStatus(new AbortController().signal)).resolves.toEqual({
      item: { status: 'WARNING' }
    });
  });

  it('rejects a numeric system status outside the documented enum', async () => {
    const adapter = createOPNsenseReadAdapter({
      request: vi.fn().mockResolvedValue({
        metadata: { system: { status: 7 }, translations: {}, subsystems: [] }
      }),
      close: vi.fn(),
      downloadConfigBackup: vi.fn()
    });
    await expect(adapter.getSystemStatus(new AbortController().signal)).rejects.toThrow();
  });
});

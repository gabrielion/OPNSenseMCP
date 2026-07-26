// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElicitResult } from '@modelcontextprotocol/client';
import { createDefaultApplicationRuntime } from '../../src/app/default-application.js';
import { MCP_ERAS } from '../helpers/connect.js';
import {
  startSyntheticOPNsenseTarget,
  type RecordedHttpsRequest,
  type SyntheticOPNsenseHandler,
  type SyntheticOPNsenseResponse
} from '../support/https-opnsense-mock.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

const CREATE_ARGS = {
  resource: 'firewall.alias',
  attributes: { name: 'lab_hosts', type: 'host', content: ['192.0.2.10'], description: 'lab' }
};
const CREATED_UUID = '00000000-0000-0000-0000-000000000001';

interface AliasRow {
  readonly uuid: string;
  readonly name: string;
  readonly type: string;
  readonly description: string;
}

interface MockOptions {
  readonly backupStatus?: number;
  readonly reconfigureStatus?: number;
}

function statefulMock(options: MockOptions = {}): SyntheticOPNsenseHandler {
  const aliases = new Map<string, AliasRow>();
  let counter = 0;
  return (request: RecordedHttpsRequest): SyntheticOPNsenseResponse => {
    if (request.path === '/api/core/backup/download/this') {
      if (options.backupStatus !== undefined) return { statusCode: options.backupStatus, body: '' };
      return {
        headers: { 'content-type': 'application/xml' },
        body: '<?xml version="1.0"?><opnsense><system><hostname>lab</hostname></system></opnsense>'
      };
    }
    if (request.path === '/api/firewall/alias/searchItem') {
      const query = JSON.parse(request.body) as { current: number; rowCount: number };
      return {
        body: JSON.stringify({
          total: aliases.size,
          rowCount: query.rowCount,
          current: query.current,
          rows: [...aliases.values()]
        })
      };
    }
    if (request.path === '/api/firewall/alias/addItem') {
      counter += 1;
      const uuid = `00000000-0000-0000-0000-${String(counter).padStart(12, '0')}`;
      const parsed = JSON.parse(request.body) as { alias: Omit<AliasRow, 'uuid'> };
      aliases.set(uuid, {
        uuid,
        name: parsed.alias.name,
        type: parsed.alias.type,
        description: parsed.alias.description
      });
      return { body: JSON.stringify({ result: 'saved', uuid }) };
    }
    if (request.path === '/api/firewall/alias/reconfigure') {
      if (options.reconfigureStatus !== undefined) {
        return { statusCode: options.reconfigureStatus, body: '' };
      }
      return { body: JSON.stringify({ status: 'ok' }) };
    }
    if (request.path.startsWith('/api/firewall/alias/delItem/')) {
      aliases.delete(request.path.slice('/api/firewall/alias/delItem/'.length));
      return { body: JSON.stringify({ result: 'deleted' }) };
    }
    return { statusCode: 404, body: '{}' };
  };
}

async function withTarget(
  handler: SyntheticOPNsenseHandler,
  connect: (typeof MCP_ERAS)[number]['connect'],
  run: (input: {
    readonly client: Awaited<ReturnType<(typeof MCP_ERAS)[number]['connect']>>['client'];
    readonly requests: readonly RecordedHttpsRequest[];
    readonly elicitationMessages: readonly string[];
  }) => Promise<void>
): Promise<void> {
  const target = await startSyntheticOPNsenseTarget(handler);
  const directory = await mkdtemp(join(tmpdir(), 'opnsense-alias-mutation-'));
  const caFile = join(directory, 'ca.pem');
  const configFile = join(directory, 'config.json');
  await writeFile(caFile, target.ca, { mode: 0o600 });
  await writeFile(
    configFile,
    JSON.stringify({ url: target.url, apiKey: 'test-key', apiSecret: 'test-secret', caFile }),
    { mode: 0o600 }
  );
  vi.stubEnv('OPNSENSE_CONFIG_FILE', configFile);
  vi.stubEnv('READ_ONLY', 'false');
  // Alias writes are experimental: they require the exact flag and an explicitly named scope, the
  // same triple the disposable-VM runner uses.
  vi.stubEnv('ENABLED_FEATURE_FLAGS', 'experimental-alias-write');
  vi.stubEnv('ALLOWED_RESOURCES', 'server.status,system.status,core.services,firewall.alias');

  const runtime = createDefaultApplicationRuntime();
  const connection = await connect(runtime.application, {
    capabilities: { elicitation: { form: {} } }
  });
  const elicitationMessages: string[] = [];
  connection.client.setRequestHandler('elicitation/create', (request) => {
    elicitationMessages.push(request.params.message);
    return Promise.resolve({ action: 'accept', content: { confirm: true } } as ElicitResult);
  });
  try {
    await run({ client: connection.client, requests: target.requests, elicitationMessages });
  } finally {
    await connection.close();
    await runtime.close();
    await target.close();
    await rm(directory, { recursive: true, force: true });
  }
}

describe.each(MCP_ERAS)('$label firewall-alias reversible mutation', ({ connect }) => {
  it('describes the exact pending change in the human confirmation', async () => {
    await withTarget(statefulMock(), connect, async ({ client, elicitationMessages }) => {
      await client.callTool({ name: 'opn_create', arguments: CREATE_ARGS });
      await client.callTool({
        name: 'opn_delete',
        arguments: { resource: 'firewall.alias', id: CREATED_UUID }
      });

      // A human approving a firewall change must be told which change. A fixed question makes the
      // gate that justifies allowing writes a blind yes/no.
      expect(elicitationMessages).toEqual([
        'Apply this exact OPNsense change? create firewall.alias "lab_hosts" (1 entry)',
        `Apply this exact OPNsense change? delete firewall.alias "${CREATED_UUID}"`
      ]);
    });
  });

  it('runs the full create, read-back, delete, prove-absence lifecycle', async () => {
    await withTarget(statefulMock(), connect, async ({ client, requests }) => {
      expect((await client.listTools()).tools.map(({ name }) => name)).toEqual([
        'server_status',
        'opn_describe',
        'opn_get',
        'opn_list',
        'opn_create',
        'opn_delete'
      ]);

      const list = (): Promise<unknown> =>
        client.callTool({
          name: 'opn_list',
          arguments: { resource: 'firewall.alias', page: 1, pageSize: 10, query: '' }
        });

      await expect(list()).resolves.toMatchObject({ structuredContent: { total: 0, items: [] } });

      await expect(
        client.callTool({ name: 'opn_create', arguments: CREATE_ARGS })
      ).resolves.toEqual(
        expect.objectContaining({
          structuredContent: {
            item: {
              uuid: CREATED_UUID,
              name: 'lab_hosts',
              type: 'host',
              content: ['192.0.2.10'],
              description: 'lab'
            }
          }
        })
      );

      await expect(list()).resolves.toMatchObject({
        structuredContent: {
          total: 1,
          items: [{ uuid: CREATED_UUID, name: 'lab_hosts', type: 'host', description: 'lab' }]
        }
      });

      await expect(
        client.callTool({
          name: 'opn_delete',
          arguments: { resource: 'firewall.alias', id: CREATED_UUID }
        })
      ).resolves.toMatchObject({ structuredContent: { item: { id: CREATED_UUID } } });

      await expect(list()).resolves.toMatchObject({ structuredContent: { total: 0, items: [] } });

      const paths = requests.map(({ method, path }) => `${method} ${path}`);
      const backupIndex = paths.indexOf('GET /api/core/backup/download/this');
      const firstAdd = paths.indexOf('POST /api/firewall/alias/addItem');
      expect(backupIndex).toBeGreaterThanOrEqual(0);
      expect(backupIndex).toBeLessThan(firstAdd);
    });
  });

  it('refuses with BACKUP_FAILED and performs no write when the configuration backup fails', async () => {
    await withTarget(statefulMock({ backupStatus: 500 }), connect, async ({ client, requests }) => {
      await expect(
        client.callTool({ name: 'opn_create', arguments: CREATE_ARGS })
      ).resolves.toMatchObject({ isError: true, structuredContent: { code: 'BACKUP_FAILED' } });
      expect(requests.map(({ path }) => path)).not.toContain('/api/firewall/alias/addItem');
    });
  });

  it('preserves the backup and never leaks a backupId when the apply cannot complete', async () => {
    await withTarget(
      statefulMock({ reconfigureStatus: 500 }),
      connect,
      async ({ client, requests }) => {
        const result = await client.callTool({ name: 'opn_create', arguments: CREATE_ARGS });
        expect(result).toMatchObject({
          isError: true,
          structuredContent: { code: 'EXECUTION_FAILED' }
        });
        expect(JSON.stringify(result)).not.toContain('backup');
        expect(requests.map(({ path }) => path)).toContain('/api/core/backup/download/this');
      }
    );
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApplicationContext } from '../../src/app/application-context.js';
import { createDefaultApplicationRuntime } from '../../src/app/default-application.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';
import { MCP_ERAS } from '../helpers/connect.js';
import { startSyntheticOPNsenseTarget } from '../support/https-opnsense-mock.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

function unavailableConfig(): RuntimeConfig {
  return {
    readOnly: true,
    allowedResourceScopes: null,
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

describe.each(MCP_ERAS)('$label Product 1A secure read composition', ({ connect }) => {
  it('stays protocol-clean and returns sealed target refusals without configuration', async () => {
    const connection = await connect(createApplicationContext(unavailableConfig()));
    try {
      expect((await connection.client.listTools()).tools.map(({ name }) => name)).toEqual([
        'server_status',
        'opn_describe',
        'opn_get',
        'opn_list'
      ]);
      await expect(
        connection.client.callTool({ name: 'opn_get', arguments: { resource: 'system.status' } })
      ).resolves.toMatchObject({
        isError: true,
        structuredContent: {
          code: 'TARGET_UNAVAILABLE',
          details: { resource: 'system.status', operation: 'get' }
        }
      });
      await expect(
        connection.client.callTool({
          name: 'opn_list',
          arguments: { resource: 'core.services', page: 1, pageSize: 10, query: '' }
        })
      ).resolves.toMatchObject({
        isError: true,
        structuredContent: {
          code: 'TARGET_UNAVAILABLE',
          details: { resource: 'core.services', operation: 'list' }
        }
      });
    } finally {
      await connection.close();
    }
  });

  it('discovers and executes the two closed OPNsense reads against synthetic HTTPS', async () => {
    const target = await startSyntheticOPNsenseTarget((request) => {
      if (request.path === '/api/core/system/status') {
        return { body: JSON.stringify({ status: 'ok', ignored: 'drop-me' }) };
      }
      return {
        body: JSON.stringify({
          total: 1,
          rowCount: 10,
          current: 1,
          rows: [
            {
              id: 'svc-1',
              name: 'dnsmasq',
              description: 'DNS forwarder',
              status: 'running',
              ignored: 'drop-me'
            }
          ],
          ignored: 'drop-me'
        })
      };
    });
    const directory = await mkdtemp(join(tmpdir(), 'opnsense-product-read-'));
    const caFile = join(directory, 'ca.pem');
    const configFile = join(directory, 'config.json');
    await writeFile(caFile, target.ca, { mode: 0o600 });
    await writeFile(
      configFile,
      JSON.stringify({
        url: target.url,
        apiKey: 'test-key',
        apiSecret: 'test-secret',
        caFile
      }),
      { mode: 0o600 }
    );
    vi.stubEnv('OPNSENSE_CONFIG_FILE', configFile);
    vi.stubEnv('READ_ONLY', 'true');

    const runtime = createDefaultApplicationRuntime();
    const connection = await connect(runtime.application);
    try {
      expect((await connection.client.listTools()).tools.map(({ name }) => name)).toEqual([
        'server_status',
        'opn_describe',
        'opn_get',
        'opn_list'
      ]);
      await expect(
        connection.client.callTool({
          name: 'opn_describe',
          arguments: { resource: 'system.status' }
        })
      ).resolves.toMatchObject({
        structuredContent: { mode: 'resource', resource: { key: 'system.status' } }
      });
      await expect(
        connection.client.callTool({ name: 'opn_get', arguments: { resource: 'system.status' } })
      ).resolves.toMatchObject({ structuredContent: { item: { status: 'ok' } } });
      await expect(
        connection.client.callTool({
          name: 'opn_list',
          arguments: { resource: 'core.services', page: 1, pageSize: 10, query: '' }
        })
      ).resolves.toMatchObject({
        structuredContent: {
          page: 1,
          pageSize: 10,
          total: 1,
          items: [
            {
              id: 'svc-1',
              name: 'dnsmasq',
              description: 'DNS forwarder',
              status: 'running'
            }
          ]
        }
      });
      expect(target.requests).toHaveLength(2);
      expect(target.requests[0]).toMatchObject({
        method: 'GET',
        path: '/api/core/system/status',
        body: ''
      });
      expect(target.requests[0]?.headers.authorization).toBe('Basic dGVzdC1rZXk6dGVzdC1zZWNyZXQ=');
      expect(target.requests[0]?.headers['content-type']).toBeUndefined();
      expect(target.requests[1]).toMatchObject({
        method: 'POST',
        path: '/api/core/service/search',
        body: JSON.stringify({ current: 1, rowCount: 10, sort: {}, searchPhrase: '' })
      });
      expect(JSON.stringify(await connection.client.listTools())).not.toContain('test-secret');
    } finally {
      await connection.close();
      await runtime.close();
      await target.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

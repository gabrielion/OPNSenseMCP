// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApplicationContext } from '../../src/app/application-context.js';
import { dispatchApplicationCapability } from '../../src/app/application-context.js';
import { getCapability } from '../../src/capabilities/catalog.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';
import { sha256Json } from '../../src/security/canonical-json.js';

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

function call(argumentsValue: unknown, allowedResourceScopes: ReadonlySet<string> | null = null) {
  return dispatchApplicationCapability(
    createApplicationContext(config(allowedResourceScopes)),
    { name: 'opn_describe', arguments: argumentsValue },
    { transport: 'stdio' }
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

describe('opn_describe', () => {
  it('uses a strict exactly-one-mode input contract', async () => {
    expect(getCapability('opn_describe')).toBeDefined();
    for (const invalid of [
      {},
      { query: '', resource: 'system.status' },
      { query: '', extra: true },
      { resource: '' },
      { resource: 'r'.repeat(129) },
      { query: 'q'.repeat(65) }
    ]) {
      await expect(call(invalid)).resolves.toMatchObject({
        kind: 'refused',
        code: 'INVALID_INPUT'
      });
    }
  });

  it('browses at most five visible summaries in stable key order', async () => {
    const result = await call({ query: '' });
    expect(result).toEqual({
      kind: 'success',
      output: {
        mode: 'query',
        resources: [
          {
            key: 'core.services',
            label: 'Services',
            category: 'Core',
            description: 'Review the bounded status summary for configured core services.',
            operations: [{ name: 'list', effect: 'read' }]
          },
          {
            key: 'system.status',
            label: 'System status',
            category: 'System',
            description: 'Read the bounded health status reported by the OPNsense system API.',
            operations: [{ name: 'get', effect: 'read' }]
          }
        ]
      }
    });
  });

  it('filters query results using only the authorized effective scopes', async () => {
    await expect(call({ query: '' }, new Set(['system.status']))).resolves.toMatchObject({
      kind: 'success',
      output: {
        mode: 'query',
        resources: [{ key: 'system.status' }]
      }
    });
    await expect(call({ query: 'services' }, new Set(['system.status']))).resolves.toEqual({
      kind: 'success',
      output: { mode: 'query', resources: [] }
    });
  });

  it('returns exact safe metadata with bounded schemas and reproducible digests', async () => {
    expect(existsSync('src/operations/operation-contract.v1.json')).toBe(true);
    if (!existsSync('src/operations/operation-contract.v1.json')) return;
    const contract = JSON.parse(
      readFileSync('src/operations/operation-contract.v1.json', 'utf8')
    ) as {
      $defs: Record<string, unknown>;
    };
    const result = await call({ resource: 'system.status' });
    expect(result).toMatchObject({
      kind: 'success',
      output: {
        mode: 'resource',
        resource: {
          key: 'system.status',
          label: 'System status',
          category: 'System',
          description: 'Read the bounded health status reported by the OPNsense system API.',
          requiredPlugin: null,
          requiredFeatures: [],
          operations: [
            {
              name: 'get',
              effect: 'read',
              inputSchema: contract.$defs.systemStatusGetInput,
              outputSchema: contract.$defs.systemStatusGetOutput,
              inputSchemaDigest: sha256Json(contract.$defs.systemStatusGetInput),
              outputSchemaDigest: sha256Json(contract.$defs.systemStatusGetOutput)
            }
          ],
          contractDigest: sha256Json(contract)
        }
      }
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/\/api\/|apiKey|apiSecret|credentials|"method"|"path"/u);
    const output = result.kind === 'success' ? result.output : undefined;
    const resource = output?.resource;
    expect(isRecord(resource)).toBe(true);
    if (!isRecord(resource)) return;
    expect(Object.keys(resource)).toEqual([
      'category',
      'contractDigest',
      'description',
      'key',
      'label',
      'operations',
      'requiredFeatures',
      'requiredPlugin'
    ]);
  });

  it('does not resolve hidden or unknown exact names and never echoes the unknown input', async () => {
    const hidden = await call({ resource: 'system.status' }, new Set(['core.services']));
    expect(hidden).toEqual({
      kind: 'refused',
      code: 'UNKNOWN_RESOURCE',
      message: 'Resource is not available.',
      details: { suggestions: ['core.services'] }
    });

    const sentinel = 'SENTINEL_UNKNOWN_RESOURCE_DO_NOT_ECHO';
    const unknown = await call({ resource: sentinel });
    expect(unknown).toMatchObject({
      kind: 'refused',
      code: 'UNKNOWN_RESOURCE',
      details: { suggestions: ['core.services', 'system.status'] }
    });
    expect(JSON.stringify(unknown)).not.toContain(sentinel);
    expect(Reflect.get(Reflect.get(unknown, 'details'), 'suggestions')).toHaveLength(2);
  });
});

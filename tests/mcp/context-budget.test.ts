// SPDX-License-Identifier: AGPL-3.0-or-later
import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApplicationContext } from '../../src/app/application-context.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';
import { canonicalJson } from '../../src/security/canonical-json.js';
import { MCP_ERAS } from '../helpers/connect.js';

const FIXTURE_PATH = 'tests/fixtures/context-budget.product1a-task2.json';
const TOTAL_LIMIT = 131_072;
const TOOL_LIMIT = 16_384;

interface ContextEvidence {
  readonly schemaVersion: 1;
  readonly scope: 'product-1a-task-2-partial';
  readonly tools: readonly ['opn_describe', 'server_status'];
  readonly toolCount: 2;
  readonly totalBytes: number;
  readonly largestTool: { readonly name: string; readonly bytes: number };
  readonly limits: { readonly totalBytes: 131072; readonly perToolBytes: 16384 };
}

function config(): RuntimeConfig {
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

describe.each(MCP_ERAS)('$label partial Product 1A Task 2 context budget', ({ connect }) => {
  it('records the canonical two-tool listing within the fixed limits', async () => {
    expect(existsSync(FIXTURE_PATH)).toBe(true);
    if (!existsSync(FIXTURE_PATH)) return;
    const evidence = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as ContextEvidence;
    const connection = await connect(createApplicationContext(config()));
    try {
      const tools = (await connection.client.listTools()).tools.sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0
      );
      const measurements = tools.map((tool) => ({
        name: tool.name,
        bytes: Buffer.byteLength(canonicalJson(tool), 'utf8')
      }));
      const totalBytes = Buffer.byteLength(canonicalJson(tools), 'utf8');
      const largestTool = [...measurements].sort((left, right) => right.bytes - left.bytes)[0];

      expect(tools.map(({ name }) => name)).toEqual(['opn_describe', 'server_status']);
      expect(totalBytes).toBeLessThanOrEqual(TOTAL_LIMIT);
      expect(measurements.every(({ bytes }) => bytes <= TOOL_LIMIT)).toBe(true);
      expect(canonicalJson(tools)).not.toContain('/api/');
      expect(evidence).toEqual({
        schemaVersion: 1,
        scope: 'product-1a-task-2-partial',
        tools: ['opn_describe', 'server_status'],
        toolCount: 2,
        totalBytes,
        largestTool,
        limits: { totalBytes: TOTAL_LIMIT, perToolBytes: TOOL_LIMIT }
      });
    } finally {
      await connection.close();
    }
  });
});

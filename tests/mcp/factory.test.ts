// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { createApplicationContext } from '../../src/app/application-context.js';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';
import { SERVER_INSTRUCTIONS } from '../../src/mcp/instructions.js';
import { PROMPT_NAMES } from '../../src/mcp/prompts.js';
import { createMutationFixture, createReadFixture } from '../fixtures/capabilities.js';
import { MCP_ERAS } from '../helpers/connect.js';

function config(readOnly = true): RuntimeConfig {
  return {
    readOnly,
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

describe.each(MCP_ERAS)('$label MCP server factory', ({ connect }) => {
  it('initializes with exact identity and instructions', async () => {
    const connection = await connect(createApplicationContext(config()));
    try {
      expect(connection.client.getServerVersion()).toEqual({
        name: 'opnsense-mcp',
        version: '0.1.0'
      });
      expect(connection.client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    } finally {
      await connection.close();
    }
  });

  it('lists immutable exposed tools, hides read-only writes, and registers prompts', async () => {
    const read = createReadFixture();
    const write = createMutationFixture();
    const application = createApplicationContext(
      config(true),
      new CapabilityCatalog([read, write])
    );
    const connection = await connect(application);
    try {
      const tools = await connection.client.listTools();
      expect(tools.tools.map(({ name }) => name)).toEqual([read.mcpName]);
      expect(tools.tools[0]).toMatchObject({
        name: read.mcpName,
        title: read.title,
        description: read.description,
        annotations: read.annotations
      });
      expect((await connection.client.listPrompts()).prompts.map(({ name }) => name)).toEqual(
        PROMPT_NAMES
      );
    } finally {
      await connection.close();
    }
  });

  it('returns textual and structured status and sanitizes invalid input and forged names', async () => {
    const application = createApplicationContext(config());
    const connection = await connect(application);
    try {
      const result = await connection.client.callTool({ name: 'server_status', arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ status: 'ok', readOnly: true, version: '0.1.0' });
      expect(result.content).toEqual([
        { type: 'text', text: JSON.stringify(result.structuredContent) }
      ]);

      const invalid = await connection.client.callTool({
        name: 'server_status',
        arguments: { sentinelSecret: 'DO_NOT_LEAK' }
      });
      expect(invalid.isError).toBe(true);
      expect(JSON.stringify(invalid)).not.toContain('DO_NOT_LEAK');

      await expect(
        connection.client.callTool({ name: 'forged_cached_tool', arguments: {} })
      ).rejects.toThrow();
    } finally {
      await connection.close();
    }
  });
});

it('does not create process-global listeners while connecting or closing', async () => {
  const before = process.eventNames().map(String).sort();
  for (const { connect } of MCP_ERAS) {
    const connection = await connect(createApplicationContext(config()));
    await connection.close();
  }
  expect(process.eventNames().map(String).sort()).toEqual(before);
});

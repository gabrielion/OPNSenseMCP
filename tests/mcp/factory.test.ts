// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { createApplicationContext } from '../../src/app/application-context.js';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import { defineCapability } from '../../src/capabilities/kernel.js';
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
        version: '0.1.1'
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
      expect(result.structuredContent).toEqual({ status: 'ok', readOnly: true, version: '0.1.1' });
      expect(result.content).toEqual([
        { type: 'text', text: JSON.stringify(result.structuredContent) }
      ]);

      const invalid = await connection.client.callTool({
        name: 'server_status',
        arguments: { SENTINEL_SECRET_PROPERTY: 'DO_NOT_LEAK' }
      });
      expect(invalid.isError).toBe(true);
      expect(JSON.stringify(invalid)).not.toContain('DO_NOT_LEAK');
      expect(JSON.stringify(invalid)).not.toContain('SENTINEL_SECRET_PROPERTY');

      await expect(
        connection.client.callTool({ name: 'forged_cached_tool', arguments: {} })
      ).resolves.toEqual({
        isError: true,
        content: [{ type: 'text', text: 'Capability is not available.' }],
        structuredContent: { code: 'UNKNOWN_CAPABILITY' }
      });
    } finally {
      await connection.close();
    }
  });

  it('executes capability input transforms and refinements exactly once at the kernel boundary', async () => {
    const counters = { inputRefine: 0, inputTransform: 0, outputRefine: 0, handler: 0 };
    let receivedPort: number | undefined;
    const transformed = defineCapability({
      id: 'test.transformed',
      mcpName: 'transformed_read',
      title: 'Transformed read',
      description: 'Prove the capability kernel owns schema execution.',
      inputSchema: z
        .object({
          port: z
            .string()
            .refine((value) => {
              counters.inputRefine += 1;
              return /^\d+$/u.test(value);
            })
            .transform((value) => {
              counters.inputTransform += 1;
              return Number(value);
            })
        })
        .strict(),
      outputSchema: z
        .object({
          port: z.number().refine((value) => {
            counters.outputRefine += 1;
            return Number.isInteger(value);
          })
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      transports: ['stdio', 'http'],
      policy: {
        effect: 'read',
        resourceScopes: ['test.transformed'],
        requiredFeatureFlags: [],
        backup: 'none',
        audit: 'none',
        confirmation: 'none',
        timeoutMs: 1000,
        redactFields: []
      },
      handler: ({ port }) => {
        counters.handler += 1;
        receivedPort = port;
        return Promise.resolve({ port });
      }
    });
    const application = createApplicationContext(config(), new CapabilityCatalog([transformed]));
    const connection = await connect(application);
    try {
      await expect(
        connection.client.callTool({
          name: transformed.mcpName,
          arguments: { port: '443' }
        })
      ).resolves.toMatchObject({ structuredContent: { port: 443 } });
      expect(receivedPort).toBe(443);
      expect(counters).toEqual({
        inputRefine: 1,
        inputTransform: 1,
        outputRefine: 1,
        handler: 1
      });
    } finally {
      await connection.close();
    }
  });

  it('normalizes an object-valued discriminated-union input root without parsing outside the kernel', async () => {
    let receivedInput: unknown;
    const unionInput = defineCapability({
      id: 'test.union.input',
      mcpName: 'union_input_read',
      title: 'Union input read',
      description: 'Exercise object-valued discriminated-union input discovery.',
      inputSchema: z.discriminatedUnion('kind', [
        z
          .object({
            kind: z.literal('port'),
            port: z.string().transform((value) => Number(value))
          })
          .strict(),
        z.object({ kind: z.literal('name'), name: z.string() }).strict()
      ]),
      outputSchema: z.object({ accepted: z.string() }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      transports: ['stdio', 'http'],
      policy: {
        effect: 'read',
        resourceScopes: ['test.union.input'],
        requiredFeatureFlags: [],
        backup: 'none',
        audit: 'none',
        confirmation: 'none',
        timeoutMs: 1000,
        redactFields: []
      },
      handler: (input) => {
        receivedInput = input;
        return Promise.resolve({ accepted: input.kind });
      }
    });
    const connection = await connect(
      createApplicationContext(config(), new CapabilityCatalog([unionInput]))
    );
    try {
      const listed = await connection.client.listTools();
      expect(listed.tools[0]?.inputSchema).toMatchObject({ type: 'object' });
      expect(Array.isArray(listed.tools[0]?.inputSchema.oneOf)).toBe(true);

      const result = await connection.client.callTool({
        name: unionInput.mcpName,
        arguments: { kind: 'port', port: '443' }
      });
      expect(receivedInput).toEqual({ kind: 'port', port: 443 });
      expect(result.structuredContent).toEqual({ accepted: 'port' });
    } finally {
      await connection.close();
    }
  });

  it('advertises and projects a union-of-object output as an object root', async () => {
    const unionOutput = defineCapability({
      id: 'test.union.output',
      mcpName: 'union_output_read',
      title: 'Union output read',
      description: 'Exercise union-of-object output discovery and projection.',
      inputSchema: z.object({ port: z.number() }).strict(),
      outputSchema: z.union([
        z.object({ kind: z.literal('port'), port: z.number() }).strict(),
        z.object({ kind: z.literal('name'), name: z.string() }).strict()
      ]),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      transports: ['stdio', 'http'],
      policy: {
        effect: 'read',
        resourceScopes: ['test.union.output'],
        requiredFeatureFlags: [],
        backup: 'none',
        audit: 'none',
        confirmation: 'none',
        timeoutMs: 1000,
        redactFields: []
      },
      handler: ({ port }) => Promise.resolve({ kind: 'port' as const, port })
    });
    const connection = await connect(
      createApplicationContext(config(), new CapabilityCatalog([unionOutput]))
    );
    try {
      const listed = await connection.client.listTools();
      expect(listed.tools[0]?.outputSchema).toMatchObject({ type: 'object' });
      expect(Array.isArray(listed.tools[0]?.outputSchema?.anyOf)).toBe(true);

      const result = await connection.client.callTool({
        name: unionOutput.mcpName,
        arguments: { port: 443 }
      });
      expect(result.structuredContent).toEqual({ kind: 'port', port: 443 });
      expect(result.structuredContent).not.toHaveProperty('result');
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

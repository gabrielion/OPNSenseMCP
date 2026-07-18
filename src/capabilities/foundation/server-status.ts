// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import { defineCapability } from '../kernel.js';

export const serverStatusCapability = defineCapability({
  id: 'server.status',
  mcpName: 'server_status',
  title: 'Server status',
  description: 'Report whether the MCP server is healthy and operating in read-only mode.',
  inputSchema: z.object({}).strict(),
  outputSchema: z
    .object({
      status: z.literal('ok'),
      readOnly: z.boolean(),
      version: z.literal('0.1.0')
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
    resourceScopes: ['server.status'],
    requiredFeatureFlags: [],
    backup: 'none',
    audit: 'none',
    confirmation: 'none',
    timeoutMs: 1000,
    redactFields: []
  },
  handler: (_input, context) =>
    Promise.resolve({
      status: 'ok' as const,
      readOnly: context.readOnly,
      version: '0.1.0' as const
    })
});

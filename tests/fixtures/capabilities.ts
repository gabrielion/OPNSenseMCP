// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import { defineCapability } from '../../src/capabilities/types.js';

export function createReadFixture() {
  return defineCapability({
    id: 'test.read',
    mcpName: 'test_read',
    title: 'Test read',
    description: 'Return a test value without changing state.',
    inputSchema: z.object({ value: z.string() }).strict(),
    outputSchema: z.object({ echoed: z.string() }).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    transports: ['stdio', 'http'],
    policy: {
      effect: 'read',
      resourceScopes: ['test.read'],
      requiredFeatureFlags: [],
      backup: 'none',
      audit: 'none',
      confirmation: 'none',
      timeoutMs: 1000,
      redactFields: []
    },
    handler: ({ value }) => Promise.resolve({ echoed: value })
  });
}

export function createMutationFixture(onCall: () => void = () => undefined) {
  return defineCapability({
    id: 'test.write',
    mcpName: 'test_write',
    title: 'Test write',
    description: 'Exercise the confirmation boundary using process-local test state.',
    inputSchema: z.object({ value: z.string() }).strict(),
    outputSchema: z.object({ accepted: z.string() }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    transports: ['stdio', 'http'],
    policy: {
      effect: 'local-write',
      resourceScopes: ['test.write'],
      requiredFeatureFlags: [],
      backup: 'none',
      audit: 'none',
      confirmation: 'elicitation',
      timeoutMs: 1000,
      redactFields: []
    },
    handler: ({ value }) => {
      onCall();
      return Promise.resolve({ accepted: value });
    }
  });
}

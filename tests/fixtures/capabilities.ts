// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import { defineCapability } from '../../src/capabilities/kernel.js';
import type { FeatureFlag } from '../../src/config/feature-flags.js';

interface ReadFixtureOptions {
  readonly id?: string;
  readonly mcpName?: string;
  readonly transports?: readonly ('stdio' | 'http')[];
  readonly resourceScopes?: readonly string[];
  readonly requiredFeatureFlags?: readonly FeatureFlag[];
}

export function createReadFixture(options: ReadFixtureOptions = {}) {
  return defineCapability({
    id: options.id ?? 'test.read',
    mcpName: options.mcpName ?? 'test_read',
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
    transports: options.transports ?? ['stdio', 'http'],
    policy: {
      effect: 'read',
      resourceScopes: options.resourceScopes ?? ['test.read'],
      requiredFeatureFlags: options.requiredFeatureFlags ?? [],
      backup: 'none',
      audit: 'none',
      confirmation: 'none',
      timeoutMs: 1000,
      redactFields: []
    },
    handler: ({ value }) => Promise.resolve({ echoed: value })
  });
}

interface MutationFixtureOptions {
  readonly id?: string;
  readonly mcpName?: string;
}

export function createMutationFixture(
  onCall: () => void = () => undefined,
  options: MutationFixtureOptions = {}
) {
  return defineCapability({
    id: options.id ?? 'test.write',
    mcpName: options.mcpName ?? 'test_write',
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

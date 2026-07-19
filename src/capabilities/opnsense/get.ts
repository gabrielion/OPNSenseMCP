// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import { OPERATION_DESCRIPTORS, getOperationDescriptor } from '../../operations/loader.js';
import type { OPNsenseReadAdapter, SystemStatusOutput } from '../../opnsense/read-adapter.js';
import { defineResourceCapability } from '../kernel.js';

const GetInput = z.object({ resource: z.string().min(1).max(128) }).strict();
const GetOutput = z
  .object({ item: z.object({ status: z.string().min(1).max(64) }).strict() })
  .strict();

type GetInputValue = z.infer<typeof GetInput>;
interface GetResolvedInput extends Record<string, unknown> {
  readonly resource: 'system.status';
}

export function createOPNsenseGetCapability(adapter: OPNsenseReadAdapter) {
  return defineResourceCapability<GetInputValue, GetResolvedInput, SystemStatusOutput>({
    id: 'opnsense.get',
    mcpName: 'opn_get',
    title: 'Get an OPNsense resource',
    description: 'Read one exact visible OPNsense singleton resource from the reviewed catalog.',
    inputSchema: GetInput,
    outputSchema: GetOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    transports: ['stdio', 'http'],
    selectableResourceScopes: OPERATION_DESCRIPTORS.map(({ key }) => key),
    refusalDetailVocabulary: { operations: ['get', 'list'], fields: ['resource'] },
    resolver: (input, { visibleResourceScopes }) => {
      if (!visibleResourceScopes.includes(input.resource)) {
        return {
          kind: 'refused',
          code: 'UNKNOWN_RESOURCE',
          details: { suggestions: visibleResourceScopes }
        };
      }
      const descriptor = getOperationDescriptor(input.resource);
      const operations = descriptor?.operations.map(({ name }) => name) ?? [];
      if (!operations.includes('get')) {
        return {
          kind: 'refused',
          code: 'OPERATION_NOT_AVAILABLE',
          details: { resource: input.resource, availableOperations: operations }
        };
      }
      if (!adapter.available) {
        return {
          kind: 'refused',
          code: 'TARGET_UNAVAILABLE',
          details: { resource: input.resource, operation: 'get' }
        };
      }
      return {
        kind: 'resolved',
        input: { resource: 'system.status' },
        effectiveResourceScopes: ['system.status']
      };
    },
    policy: {
      effect: 'read',
      requiredFeatureFlags: [],
      backup: 'none',
      audit: 'none',
      confirmation: 'none',
      timeoutMs: 300_000,
      redactFields: []
    },
    handler: (_input, context) => adapter.getSystemStatus(context.signal)
  });
}

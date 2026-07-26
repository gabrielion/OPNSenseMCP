// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import { sha256Json } from '../../security/canonical-json.js';
import { getOperationDescriptor } from '../../operations/loader.js';
import type { AliasDeleteOutput, OPNsenseAliasAdapter } from '../../opnsense/alias-adapter.js';
import { defineWriteResourceCapability } from '../kernel.js';
import {
  ALIAS_UUID_PATTERN,
  aliasStateDigest,
  readHostAliases,
  resourcesSupporting
} from './alias-schema.js';

const DeleteInput = z
  .object({
    resource: z.string().min(1).max(128),
    id: z.string().min(1).max(64)
  })
  .strict();
const DeleteOutput = z
  .object({ item: z.object({ id: z.string().min(1).max(64) }).strict() })
  .strict();

type DeleteInputValue = z.infer<typeof DeleteInput>;
interface DeleteResolvedInput extends Record<string, unknown> {
  readonly resource: string;
  readonly id: string;
}

export function createOPNsenseDeleteCapability(aliasAdapter: OPNsenseAliasAdapter) {
  return defineWriteResourceCapability<DeleteInputValue, DeleteResolvedInput, AliasDeleteOutput>({
    id: 'opnsense.delete',
    mcpName: 'opn_delete',
    title: 'Delete an OPNsense resource',
    description:
      'Delete one exact visible OPNsense resource through the reviewed, backed-up mutation envelope.',
    inputSchema: DeleteInput,
    outputSchema: DeleteOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    transports: ['stdio', 'http'],
    selectableResourceScopes: resourcesSupporting('delete'),
    refusalDetailVocabulary: { operations: ['delete'], fields: ['resource', 'id'] },
    policy: {
      effect: 'firewall-write',
      requiredFeatureFlags: [],
      backup: 'strict',
      audit: 'required',
      confirmation: 'elicitation',
      timeoutMs: 300_000,
      redactFields: []
    },
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
      if (!operations.includes('delete')) {
        return {
          kind: 'refused',
          code: 'OPERATION_NOT_AVAILABLE',
          details: { resource: input.resource, availableOperations: operations }
        };
      }
      if (!aliasAdapter.available) {
        return {
          kind: 'refused',
          code: 'TARGET_UNAVAILABLE',
          details: { resource: input.resource, operation: 'delete' }
        };
      }
      if (!ALIAS_UUID_PATTERN.test(input.id)) {
        return {
          kind: 'refused',
          code: 'INVALID_RESOURCE_INPUT',
          details: { resource: input.resource, operation: 'delete', fields: ['id'] }
        };
      }
      return {
        kind: 'resolved',
        input: { resource: input.resource, id: input.id },
        effectiveResourceScopes: [input.resource]
      };
    },
    preflight: async (input, context) => {
      const items = await readHostAliases(aliasAdapter, context.signal);
      return {
        observedStateDigest: aliasStateDigest(items),
        effectPlanDigest: sha256Json({
          resource: input.resource,
          operation: 'delete',
          id: input.id
        })
      };
    },
    handler: (input, context) => aliasAdapter.deleteHostAlias(input.id, context.signal),
    summarizeChange: (input) => ({ operation: 'delete', subject: input.id, detail: '' }),
    verifyOutcome: async (input, _output, context) => {
      const items = await readHostAliases(aliasAdapter, context.signal);
      return !items.some((item) => item.uuid === input.id);
    }
  });
}

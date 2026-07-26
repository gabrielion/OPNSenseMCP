// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import { sha256Json } from '../../security/canonical-json.js';
import { getOperationDescriptor } from '../../operations/loader.js';
import type { AliasCreateOutput, OPNsenseAliasAdapter } from '../../opnsense/alias-adapter.js';
import { defineWriteResourceCapability } from '../kernel.js';
import {
  AliasCreateAttributesSchema,
  aliasStateDigest,
  invalidAttributeFields,
  readHostAliases,
  resourcesSupporting,
  type AliasCreateAttributes
} from './alias-schema.js';

const CreateInput = z
  .object({
    resource: z.string().min(1).max(128),
    attributes: z.record(z.string(), z.unknown())
  })
  .strict();
const CreateOutput = z
  .object({
    item: z
      .object({
        uuid: z.string().min(1).max(64),
        name: z.string().min(1).max(32),
        type: z.string().min(1).max(32),
        content: z.array(z.string().min(1).max(253)).min(1).max(64).readonly(),
        description: z.string().max(255)
      })
      .strict()
  })
  .strict();

type CreateInputValue = z.infer<typeof CreateInput>;
interface CreateResolvedInput extends Record<string, unknown> {
  readonly resource: string;
  readonly attributes: AliasCreateAttributes;
}

export function createOPNsenseCreateCapability(aliasAdapter: OPNsenseAliasAdapter) {
  return defineWriteResourceCapability<CreateInputValue, CreateResolvedInput, AliasCreateOutput>({
    id: 'opnsense.create',
    mcpName: 'opn_create',
    title: 'Create an OPNsense resource',
    description:
      'Create one exact visible OPNsense resource through the reviewed, backed-up mutation envelope.',
    inputSchema: CreateInput,
    outputSchema: CreateOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    transports: ['stdio', 'http'],
    selectableResourceScopes: resourcesSupporting('create'),
    refusalDetailVocabulary: {
      operations: ['create'],
      fields: ['resource', 'attributes', 'name', 'type', 'content', 'description']
    },
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
      if (!operations.includes('create')) {
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
          details: { resource: input.resource, operation: 'create' }
        };
      }
      const parsed = AliasCreateAttributesSchema.safeParse(input.attributes);
      if (!parsed.success) {
        return {
          kind: 'refused',
          code: 'INVALID_RESOURCE_INPUT',
          details: {
            resource: input.resource,
            operation: 'create',
            fields: invalidAttributeFields(parsed.error)
          }
        };
      }
      return {
        kind: 'resolved',
        input: { resource: input.resource, attributes: parsed.data },
        effectiveResourceScopes: [input.resource]
      };
    },
    preflight: async (input, context) => {
      const items = await readHostAliases(aliasAdapter, context.signal);
      return {
        observedStateDigest: aliasStateDigest(items),
        effectPlanDigest: sha256Json({
          resource: input.resource,
          operation: 'create',
          attributes: input.attributes
        })
      };
    },
    handler: (input, context) => aliasAdapter.createHostAlias(input.attributes, context.signal),
    summarizeChange: (input) => ({
      operation: 'create',
      subject: input.attributes.name,
      detail: `${String(input.attributes.content.length)} ${
        input.attributes.content.length === 1 ? 'entry' : 'entries'
      }`
    }),
    verifyOutcome: async (input, output, context) => {
      const items = await readHostAliases(aliasAdapter, context.signal);
      return items.some((item) => item.uuid === output.item.uuid && item.name === output.item.name);
    }
  });
}

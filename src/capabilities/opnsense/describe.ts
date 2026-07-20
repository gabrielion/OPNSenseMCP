// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import { OPERATION_DESCRIPTORS, getOperationDescriptor } from '../../operations/loader.js';
import type { OperationDescriptor, PublicOperationDescriptor } from '../../operations/types.js';
import { defineResourceCapability } from '../kernel.js';

const MAX_QUERY_RESULTS = 5;

const JsonSchema: z.ZodType<Readonly<Record<string, unknown>>> = z.record(z.string(), z.json());
const PublicOperation = z
  .object({
    name: z.string().min(1).max(64),
    effect: z.enum(['read', 'firewall-write']),
    inputSchema: JsonSchema,
    outputSchema: JsonSchema,
    inputSchemaDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    outputSchemaDigest: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict();
const RequiredPlugin = z
  .object({ name: z.string().min(1).max(128), versionRange: z.string().min(1).max(64) })
  .strict();
const OperationSummary = PublicOperation.pick({ name: true, effect: true });
const ResourceSummary = z
  .object({
    key: z.string().min(1).max(128),
    label: z.string().min(1).max(128),
    category: z.string().min(1).max(128),
    description: z.string().min(1).max(512),
    operations: z.array(OperationSummary).max(16).readonly()
  })
  .strict();
const ResourceDescription = ResourceSummary.extend({
  requiredPlugin: RequiredPlugin.nullable(),
  requiredFeatures: z.array(z.string().min(1).max(128)).max(16).readonly(),
  operations: z.array(PublicOperation).max(16).readonly(),
  contractDigest: z.string().regex(/^[a-f0-9]{64}$/u)
}).strict();

const DescribeInput = z.union([
  z.object({ query: z.string().max(64) }).strict(),
  z.object({ resource: z.string().min(1).max(128) }).strict()
]);
const DescribeOutput = z.discriminatedUnion('mode', [
  z
    .object({ mode: z.literal('query'), resources: z.array(ResourceSummary).max(5).readonly() })
    .strict(),
  z.object({ mode: z.literal('resource'), resource: ResourceDescription }).strict()
]);

type DescribeInputValue = z.infer<typeof DescribeInput>;
type DescribeOutputValue = z.infer<typeof DescribeOutput>;
type DescribeResolvedInput =
  | { readonly mode: 'query'; readonly query: string }
  | { readonly mode: 'resource'; readonly resource: string };

function operationSummary(operation: PublicOperationDescriptor) {
  return Object.freeze({ name: operation.name, effect: operation.effect });
}

function resourceSummary(descriptor: OperationDescriptor) {
  return Object.freeze({
    key: descriptor.key,
    label: descriptor.label,
    category: descriptor.category,
    description: descriptor.description,
    operations: Object.freeze(descriptor.operations.map(operationSummary))
  });
}

function resourceDescription(descriptor: OperationDescriptor) {
  return Object.freeze({
    key: descriptor.key,
    label: descriptor.label,
    category: descriptor.category,
    description: descriptor.description,
    requiredPlugin: descriptor.requiredPlugin,
    requiredFeatures: descriptor.requiredFeatures,
    operations: descriptor.operations,
    contractDigest: descriptor.contractDigest
  });
}

function visibleDescriptors(scopes: readonly string[]): readonly OperationDescriptor[] {
  const visible = new Set(scopes);
  return OPERATION_DESCRIPTORS.filter((descriptor) => visible.has(descriptor.key));
}

function matchesQuery(descriptor: OperationDescriptor, query: string): boolean {
  if (query.length === 0) return true;
  const haystack = [
    descriptor.key,
    descriptor.label,
    descriptor.category,
    descriptor.description,
    ...descriptor.operations.map(({ name }) => name)
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export const opnDescribeCapability = defineResourceCapability<
  DescribeInputValue,
  DescribeResolvedInput,
  DescribeOutputValue
>({
  id: 'opnsense.describe',
  mcpName: 'opn_describe',
  title: 'Describe OPNsense resources',
  description:
    'Browse visible OPNsense resource summaries or inspect one exact resource schema before use.',
  inputSchema: DescribeInput,
  outputSchema: DescribeOutput,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  },
  transports: ['stdio', 'http'],
  selectableResourceScopes: OPERATION_DESCRIPTORS.map(({ key }) => key),
  refusalDetailVocabulary: {
    operations: ['get', 'list'],
    fields: ['query', 'resource']
  },
  resolver: (input, { visibleResourceScopes }) => {
    if ('query' in input) {
      return {
        kind: 'resolved',
        input: { mode: 'query', query: input.query },
        effectiveResourceScopes: [...visibleResourceScopes]
      };
    }
    if (visibleResourceScopes.includes(input.resource)) {
      return {
        kind: 'resolved',
        input: { mode: 'resource', resource: input.resource },
        effectiveResourceScopes: [input.resource]
      };
    }
    return {
      kind: 'refused',
      code: 'UNKNOWN_RESOURCE',
      details: {
        suggestions: visibleDescriptors(visibleResourceScopes)
          .map(({ key }) => key)
          .slice(0, 3)
      }
    };
  },
  policy: {
    effect: 'read',
    requiredFeatureFlags: [],
    backup: 'none',
    audit: 'none',
    confirmation: 'none',
    timeoutMs: 1000,
    redactFields: []
  },
  handler: (input, context) => {
    if (input.mode === 'query') {
      const resources = visibleDescriptors(context.effectiveResourceScopes)
        .filter((descriptor) => matchesQuery(descriptor, input.query))
        .slice(0, MAX_QUERY_RESULTS)
        .map(resourceSummary);
      return Promise.resolve({ mode: 'query', resources });
    }
    const descriptor = getOperationDescriptor(input.resource);
    if (descriptor === undefined || !context.effectiveResourceScopes.includes(descriptor.key)) {
      throw new Error('Invalid resolved resource');
    }
    return Promise.resolve({ mode: 'resource', resource: resourceDescription(descriptor) });
  }
});

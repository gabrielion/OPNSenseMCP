// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import { OPERATION_DESCRIPTORS, getOperationDescriptor } from '../../operations/loader.js';
import type { OPNsenseReadAdapter } from '../../opnsense/read-adapter.js';
import {
  UNAVAILABLE_OPNSENSE_ALIAS_ADAPTER,
  type OPNsenseAliasAdapter
} from '../../opnsense/alias-adapter.js';
import { defineResourceCapability } from '../kernel.js';

const ListInput = z
  .object({
    resource: z.string().min(1).max(128),
    page: z.number().int().min(1).max(1000),
    pageSize: z.number().int().min(1).max(100),
    query: z.string().max(128)
  })
  .strict();
const ServiceItem = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(128),
    description: z.string().max(512),
    status: z.string().min(1).max(64)
  })
  .strict();
const AliasItem = z
  .object({
    uuid: z.string().min(1).max(64),
    name: z.string().min(1).max(32),
    type: z.string().min(1).max(32),
    description: z.string().max(255)
  })
  .strict();
const ListOutput = z
  .object({
    page: z.number().int().min(1).max(1000),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0).max(1_000_000),
    items: z
      .array(z.union([ServiceItem, AliasItem]))
      .max(100)
      .readonly()
  })
  .strict();

type ListInputValue = z.infer<typeof ListInput>;
type ListOutputValue = z.infer<typeof ListOutput>;
type ListResource = 'core.services' | 'firewall.alias';
interface ListResolvedInput extends Record<string, unknown> {
  readonly resource: ListResource;
  readonly page: number;
  readonly pageSize: number;
  readonly query: string;
}

const LISTABLE_RESOURCES: readonly string[] = ['core.services', 'firewall.alias'];

function isListResource(value: string): value is ListResource {
  return LISTABLE_RESOURCES.includes(value);
}

export function createOPNsenseListCapability(
  readAdapter: OPNsenseReadAdapter,
  aliasAdapter: OPNsenseAliasAdapter = UNAVAILABLE_OPNSENSE_ALIAS_ADAPTER
) {
  const isTargetAvailable = (resource: ListResource): boolean =>
    resource === 'core.services' ? readAdapter.available : aliasAdapter.available;
  return defineResourceCapability<ListInputValue, ListResolvedInput, ListOutputValue>({
    id: 'opnsense.list',
    mcpName: 'opn_list',
    title: 'List an OPNsense resource',
    description: 'Page one exact visible OPNsense collection resource from the reviewed catalog.',
    inputSchema: ListInput,
    outputSchema: ListOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    transports: ['stdio', 'http'],
    selectableResourceScopes: OPERATION_DESCRIPTORS.map(({ key }) => key),
    refusalDetailVocabulary: {
      operations: ['get', 'list', 'create', 'delete'],
      fields: ['page', 'pageSize', 'query', 'resource']
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
      if (!operations.includes('list') || !isListResource(input.resource)) {
        return {
          kind: 'refused',
          code: 'OPERATION_NOT_AVAILABLE',
          details: { resource: input.resource, availableOperations: operations }
        };
      }
      if (!isTargetAvailable(input.resource)) {
        return {
          kind: 'refused',
          code: 'TARGET_UNAVAILABLE',
          details: { resource: input.resource, operation: 'list' }
        };
      }
      return {
        kind: 'resolved',
        input: {
          resource: input.resource,
          page: input.page,
          pageSize: input.pageSize,
          query: input.query
        },
        effectiveResourceScopes: [input.resource]
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
    handler: (input, context) => {
      const page = { page: input.page, pageSize: input.pageSize, query: input.query };
      return input.resource === 'core.services'
        ? readAdapter.listServices(page, context.signal)
        : aliasAdapter.searchHostAliases(page, context.signal);
    }
  });
}

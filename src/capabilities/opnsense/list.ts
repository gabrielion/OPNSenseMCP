// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import { OPERATION_DESCRIPTORS, getOperationDescriptor } from '../../operations/loader.js';
import type { OPNsenseReadAdapter, ServiceListOutput } from '../../opnsense/read-adapter.js';
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
const ListOutput = z
  .object({
    page: z.number().int().min(1).max(1000),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0).max(1_000_000),
    items: z.array(ServiceItem).max(100).readonly()
  })
  .strict();

type ListInputValue = z.infer<typeof ListInput>;
interface ListResolvedInput extends Record<string, unknown> {
  readonly resource: 'core.services';
  readonly page: number;
  readonly pageSize: number;
  readonly query: string;
}

export function createOPNsenseListCapability(adapter: OPNsenseReadAdapter) {
  return defineResourceCapability<ListInputValue, ListResolvedInput, ServiceListOutput>({
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
      operations: ['get', 'list'],
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
      if (!operations.includes('list')) {
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
          details: { resource: input.resource, operation: 'list' }
        };
      }
      return {
        kind: 'resolved',
        input: {
          resource: 'core.services',
          page: input.page,
          pageSize: input.pageSize,
          query: input.query
        },
        effectiveResourceScopes: ['core.services']
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
    handler: (input, context) => adapter.listServices(input, context.signal)
  });
}

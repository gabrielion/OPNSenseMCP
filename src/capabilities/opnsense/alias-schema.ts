// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import { sha256Json } from '../../security/canonical-json.js';
import { OPERATION_DESCRIPTORS } from '../../operations/loader.js';
import type { AliasListItem, OPNsenseAliasAdapter } from '../../opnsense/alias-adapter.js';

export const AliasCreateAttributesSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9_]{1,32}$/u),
    type: z.literal('host'),
    content: z.array(z.string().min(1).max(253)).min(1).max(64),
    description: z.string().max(255)
  })
  .strict();

export type AliasCreateAttributes = z.infer<typeof AliasCreateAttributesSchema>;

export const ALIAS_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const ATTRIBUTE_FIELDS: readonly string[] = ['name', 'type', 'content', 'description'];

export function invalidAttributeFields(error: z.ZodError): readonly string[] {
  const fields = new Set<string>();
  for (const issue of error.issues) {
    const head = issue.path[0];
    if (typeof head === 'string' && ATTRIBUTE_FIELDS.includes(head)) fields.add(head);
  }
  return fields.size > 0 ? [...fields].sort() : ['attributes'];
}

export function resourcesSupporting(operation: string): readonly string[] {
  return OPERATION_DESCRIPTORS.filter((descriptor) =>
    descriptor.operations.some(({ name }) => name === operation)
  ).map(({ key }) => key);
}

const ALL_HOST_ALIASES = Object.freeze({ page: 1, pageSize: 100, query: '' });

export async function readHostAliases(
  adapter: OPNsenseAliasAdapter,
  signal: AbortSignal
): Promise<readonly AliasListItem[]> {
  const response = await adapter.searchHostAliases(ALL_HOST_ALIASES, signal);
  return response.items;
}

export function aliasStateDigest(items: readonly AliasListItem[]): string {
  return sha256Json([...items].map((item) => item.uuid).sort());
}

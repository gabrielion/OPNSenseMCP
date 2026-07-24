// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import type { OPNsenseHttpsClient } from './https-client.js';

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);

const AddItemResponse = z.object({ result: z.literal('saved'), uuid: UUID });
const ReconfigureResponse = z.object({ status: z.literal('ok') });
const DelItemResponse = z.object({ result: z.literal('deleted') });
const AliasRow = z.object({
  uuid: UUID,
  name: z.string().min(1).max(32),
  type: z.string().min(1).max(32),
  description: z.string().max(255)
});
const SearchResponse = z.object({
  total: z.number().int().min(0).max(1_000_000),
  rowCount: z.number().int().min(0).max(100),
  current: z.number().int().min(1).max(1000),
  rows: z.array(AliasRow).max(100)
});

export interface AliasListInput {
  readonly page: number;
  readonly pageSize: number;
  readonly query: string;
}

export interface AliasListItem {
  readonly uuid: string;
  readonly name: string;
  readonly type: string;
  readonly description: string;
}

export interface AliasListOutput extends Record<string, unknown> {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly items: readonly AliasListItem[];
}

export interface AliasCreateAttributes {
  readonly name: string;
  readonly type: 'host';
  readonly content: readonly string[];
  readonly description: string;
}

export interface AliasCreateOutput extends Record<string, unknown> {
  readonly item: {
    readonly uuid: string;
    readonly name: string;
    readonly type: string;
    readonly content: readonly string[];
    readonly description: string;
  };
}

export interface AliasDeleteOutput extends Record<string, unknown> {
  readonly item: { readonly id: string };
}

export interface OPNsenseAliasAdapter {
  readonly available: boolean;
  searchHostAliases(input: AliasListInput, signal: AbortSignal): Promise<AliasListOutput>;
  createHostAlias(
    attributes: AliasCreateAttributes,
    signal: AbortSignal
  ): Promise<AliasCreateOutput>;
  deleteHostAlias(id: string, signal: AbortSignal): Promise<AliasDeleteOutput>;
}

export const UNAVAILABLE_OPNSENSE_ALIAS_ADAPTER: OPNsenseAliasAdapter = Object.freeze({
  available: false,
  searchHostAliases: () => Promise.reject(new Error('OPNsense target is unavailable')),
  createHostAlias: () => Promise.reject(new Error('OPNsense target is unavailable')),
  deleteHostAlias: () => Promise.reject(new Error('OPNsense target is unavailable'))
});

export function createOPNsenseAliasAdapter(client: OPNsenseHttpsClient): OPNsenseAliasAdapter {
  return Object.freeze({
    available: true,
    async searchHostAliases(input: AliasListInput, signal: AbortSignal): Promise<AliasListOutput> {
      const response = SearchResponse.parse(
        await client.request({
          operation: 'firewall.alias/list',
          payload: {
            current: input.page,
            rowCount: input.pageSize,
            sort: {},
            searchPhrase: input.query,
            type: ['host']
          },
          signal
        })
      );
      if (
        response.current !== input.page ||
        (response.rowCount !== response.rows.length && response.rowCount !== input.pageSize) ||
        response.rows.length > input.pageSize
      ) {
        throw new Error('Invalid OPNsense response');
      }
      return Object.freeze({
        page: response.current,
        pageSize: input.pageSize,
        total: response.total,
        items: Object.freeze(
          response.rows.map((row) =>
            Object.freeze({
              uuid: row.uuid,
              name: row.name,
              type: row.type,
              description: row.description
            })
          )
        )
      });
    },
    async createHostAlias(
      attributes: AliasCreateAttributes,
      signal: AbortSignal
    ): Promise<AliasCreateOutput> {
      const added = AddItemResponse.parse(
        await client.request({
          operation: 'firewall.alias/create',
          payload: {
            alias: {
              enabled: '1',
              name: attributes.name,
              type: attributes.type,
              content: attributes.content.join('\n'),
              description: attributes.description
            }
          },
          signal
        })
      );
      ReconfigureResponse.parse(
        await client.request({ operation: 'firewall.alias/reconfigure', signal })
      );
      return Object.freeze({
        item: Object.freeze({
          uuid: added.uuid,
          name: attributes.name,
          type: attributes.type,
          content: Object.freeze([...attributes.content]),
          description: attributes.description
        })
      });
    },
    async deleteHostAlias(id: string, signal: AbortSignal): Promise<AliasDeleteOutput> {
      DelItemResponse.parse(
        await client.request({ operation: 'firewall.alias/delete', id, signal })
      );
      ReconfigureResponse.parse(
        await client.request({ operation: 'firewall.alias/reconfigure', signal })
      );
      return Object.freeze({ item: Object.freeze({ id }) });
    }
  });
}

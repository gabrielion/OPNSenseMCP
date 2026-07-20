// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import type { OPNsenseHttpsClient } from './https-client.js';

const SystemStatusResponse = z.object({
  metadata: z.object({
    system: z.object({ status: z.string().min(1).max(64) })
  })
});
const ServiceRow = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  description: z.string().max(512),
  running: z.number().int().min(0).max(1)
});
const ServicesResponse = z.object({
  total: z.number().int().min(0).max(1_000_000),
  rowCount: z.number().int().min(1).max(100),
  current: z.number().int().min(1).max(1000),
  rows: z.array(ServiceRow).max(100)
});

export interface ServiceListInput {
  readonly page: number;
  readonly pageSize: number;
  readonly query: string;
}

export interface SystemStatusOutput extends Record<string, unknown> {
  readonly item: { readonly status: string };
}

export interface ServiceListOutput extends Record<string, unknown> {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly items: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly status: string;
  }[];
}

export interface OPNsenseReadAdapter {
  readonly available: boolean;
  getSystemStatus(signal: AbortSignal): Promise<SystemStatusOutput>;
  listServices(input: ServiceListInput, signal: AbortSignal): Promise<ServiceListOutput>;
}

export const UNAVAILABLE_OPNSENSE_READ_ADAPTER: OPNsenseReadAdapter = Object.freeze({
  available: false,
  getSystemStatus: () => Promise.reject(new Error('OPNsense target is unavailable')),
  listServices: () => Promise.reject(new Error('OPNsense target is unavailable'))
});

export function createOPNsenseReadAdapter(client: OPNsenseHttpsClient): OPNsenseReadAdapter {
  return Object.freeze({
    available: true,
    async getSystemStatus(signal: AbortSignal): Promise<SystemStatusOutput> {
      const response = SystemStatusResponse.parse(
        await client.request({
          operation: 'system.status/get',
          signal
        })
      );
      return Object.freeze({
        item: Object.freeze({ status: response.metadata.system.status })
      });
    },
    async listServices(input: ServiceListInput, signal: AbortSignal): Promise<ServiceListOutput> {
      const response = ServicesResponse.parse(
        await client.request({
          operation: 'core.services/list',
          payload: {
            current: input.page,
            rowCount: input.pageSize,
            sort: {},
            searchPhrase: input.query
          },
          signal
        })
      );
      if (
        response.current !== input.page ||
        response.rowCount !== input.pageSize ||
        response.rows.length > input.pageSize
      ) {
        throw new Error('Invalid OPNsense response');
      }
      return Object.freeze({
        page: response.current,
        pageSize: response.rowCount,
        total: response.total,
        items: Object.freeze(
          response.rows.map(({ id, name, description, running }) =>
            Object.freeze({
              id,
              name,
              description,
              status: running === 1 ? 'running' : 'stopped'
            })
          )
        )
      });
    }
  });
}

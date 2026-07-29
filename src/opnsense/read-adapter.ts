// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import type { OPNsenseHttpsClient } from './https-client.js';

/**
 * `metadata.system.status` is polymorphic on OPNsense 26.7. The core controller seeds the field
 * with the raw `SystemStatusCode` enum value (an integer) and only overwrites it with the enum
 * name once a subsystem has posted a status, so a client polling a freshly booted firewall sees
 * the integer and a client reading a settled one sees the name. Both are accepted and normalized
 * to the documented name.
 *
 * https://github.com/opnsense/core/blob/26.7/src/opnsense/mvc/app/library/OPNsense/System/SystemStatusCode.php
 */
const SYSTEM_STATUS_NAMES: Readonly<Record<number, string>> = Object.freeze({
  [-1]: 'ERROR',
  [0]: 'WARNING',
  [1]: 'NOTICE',
  [2]: 'OK'
});

const SystemStatusResponse = z.object({
  metadata: z.object({
    system: z.object({
      status: z.union([z.string().min(1).max(64), z.number().int().min(-1).max(2)])
    })
  })
});

function systemStatusName(status: string | number): string {
  if (typeof status === 'string') return status;
  const name = SYSTEM_STATUS_NAMES[status];
  // Unreachable while the schema bounds the enum, but a widened upstream range must fail closed
  // rather than surface a bare integer as a health status.
  if (name === undefined) throw new Error('Invalid OPNsense response');
  return name;
}
const ServiceRow = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  description: z.string().max(512),
  running: z.number().int().min(0).max(1)
});
const ServicesResponse = z.object({
  total: z.number().int().min(0).max(1_000_000),
  // Clamped down to the number of rows actually returned, so a page past the end reports 0.
  rowCount: z.number().int().min(0).max(100),
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
        item: Object.freeze({ status: systemStatusName(response.metadata.system.status) })
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
      // OPNsense clamps the echoed rowCount to the rows it returned, so accept either the
      // requested size or that clamp. A rowCount above the requested size is still a protocol
      // violation and must fail.
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

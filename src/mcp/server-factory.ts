// SPDX-License-Identifier: AGPL-3.0-or-later
import type { McpServerFactory } from '@modelcontextprotocol/server';
import type { ApplicationContext } from '../app/application-context.js';
import type { TransportKind } from '../capabilities/types.js';
import { buildServer } from '../server/build-server.js';

export function createServerFactory(
  application: ApplicationContext,
  transport: TransportKind
): McpServerFactory {
  return () => buildServer(application, transport);
}

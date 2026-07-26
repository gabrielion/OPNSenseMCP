// SPDX-License-Identifier: AGPL-3.0-or-later
import { OPERATION_DESCRIPTORS } from '../operations/loader.js';

/**
 * Server health is a capability scope without an OPNsense operation descriptor: it describes this
 * process, not the firewall. It is nonetheless a legal ALLOWED_RESOURCES token, because
 * `server_status` declares it and an operator naming every scope must be able to name this one.
 */
export const SERVER_HEALTH_SCOPE = 'server.status';

/**
 * The sealed vocabulary of resource-scope tokens. An ALLOWED_RESOURCES value outside it is a
 * configuration error, not a silently narrower surface.
 */
export const KNOWN_RESOURCE_SCOPES: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    SERVER_HEALTH_SCOPE,
    ...OPERATION_DESCRIPTORS.map((descriptor) => descriptor.key)
  ])
);

/**
 * Every MCP tool name this product can ever register. A name in here that is not currently
 * registered means its adapter has no configured target — not that the client invented a tool.
 * Kept in this leaf module so the kernel can consult it without importing the catalogue.
 */
export const PRODUCT_MCP_NAMES: ReadonlySet<string> = Object.freeze(
  new Set(['server_status', 'opn_describe', 'opn_get', 'opn_list', 'opn_create', 'opn_delete'])
);

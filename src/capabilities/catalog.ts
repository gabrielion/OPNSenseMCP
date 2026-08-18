// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CapabilityDefinition, ExposureContext } from './types.js';
import { serverStatusCapability } from './foundation/server-status.js';
import { opnDescribeCapability } from './opnsense/describe.js';
import { createOPNsenseGetCapability } from './opnsense/get.js';
import { createOPNsenseListCapability } from './opnsense/list.js';
import { createOPNsenseCreateCapability } from './opnsense/create.js';
import { createOPNsenseDeleteCapability } from './opnsense/delete.js';
import {
  UNAVAILABLE_OPNSENSE_READ_ADAPTER,
  type OPNsenseReadAdapter
} from '../opnsense/read-adapter.js';
import {
  UNAVAILABLE_OPNSENSE_ALIAS_ADAPTER,
  type OPNsenseAliasAdapter
} from '../opnsense/alias-adapter.js';
import {
  hasVisibleResourceScopes,
  isKernelDefinedCapability,
  sealUnavailableCapabilities
} from './kernel.js';

function isExposed(capability: CapabilityDefinition, context: ExposureContext): boolean {
  if (context.readOnly && capability.policy.effect !== 'read') return false;
  if (
    capability.policy.requiredFeatureFlags.some((flag) => !context.enabledFeatureFlags.has(flag))
  ) {
    return false;
  }
  if (!hasVisibleResourceScopes(capability, context.allowedResourceScopes)) {
    return false;
  }
  if (!capability.transports.includes(context.transport)) return false;
  return true;
}

export class CapabilityCatalog {
  readonly all: readonly CapabilityDefinition[];
  readonly #byId = new Map<string, CapabilityDefinition>();
  readonly #byMcpName = new Map<string, CapabilityDefinition>();

  constructor(definitions: readonly CapabilityDefinition[]) {
    for (const definition of definitions) {
      if (!isKernelDefinedCapability(definition)) {
        throw new Error('Capability definition was not created by the policy kernel');
      }
      if (this.#byId.has(definition.id)) {
        throw new Error(`Duplicate capability id: ${definition.id}`);
      }
      if (this.#byMcpName.has(definition.mcpName)) {
        throw new Error(`Duplicate MCP capability name: ${definition.mcpName}`);
      }
      this.#byId.set(definition.id, definition);
      this.#byMcpName.set(definition.mcpName, definition);
    }
    this.all = Object.freeze([...definitions]);
    Object.freeze(this);
  }

  getById(id: string): CapabilityDefinition | undefined {
    return this.#byId.get(id);
  }

  getByMcpName(name: string): CapabilityDefinition | undefined {
    return this.#byMcpName.get(name);
  }

  listExposed(context: ExposureContext): readonly CapabilityDefinition[] {
    return Object.freeze(this.all.filter((capability) => isExposed(capability, context)));
  }

  listAll(): readonly CapabilityDefinition[] {
    return this.all;
  }
}

/**
 * Builds the product catalogue from two independent facts.
 *
 * `aliasAdapter` carries target-REACHABILITY: it governs the alias reads, through the availability
 * check `list.ts` makes for itself. `exposeAliasWrites` carries write-AVAILABILITY: it alone decides
 * whether the alias writes are catalogued or sealed. They coincide by default, and only by default:
 * a caller that reached the target but could not own the local machinery a protected write needs
 * passes a reachable adapter with the writes withheld, and the reads keep answering.
 */
export function createProductCapabilityCatalog(
  adapter: OPNsenseReadAdapter = UNAVAILABLE_OPNSENSE_READ_ADAPTER,
  aliasAdapter: OPNsenseAliasAdapter = UNAVAILABLE_OPNSENSE_ALIAS_ADAPTER,
  exposeAliasWrites = aliasAdapter.available
): CapabilityCatalog {
  const capabilities: CapabilityDefinition[] = [
    serverStatusCapability,
    opnDescribeCapability,
    createOPNsenseGetCapability(adapter),
    createOPNsenseListCapability(adapter, aliasAdapter)
  ];
  const writes = [
    createOPNsenseCreateCapability(aliasAdapter),
    createOPNsenseDeleteCapability(aliasAdapter)
  ];
  if (exposeAliasWrites) capabilities.push(...writes);
  const catalog = new CapabilityCatalog(capabilities);
  if (!exposeAliasWrites) sealUnavailableCapabilities(catalog, writes);
  return catalog;
}

export const CAPABILITY_CATALOG = createProductCapabilityCatalog();

export function getCapability(name: string): CapabilityDefinition | undefined {
  return CAPABILITY_CATALOG.getByMcpName(name);
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CapabilityDefinition, ExposureContext } from './types.js';
import { areDeclaredResourceScopesAllowed } from './exposure.js';
import { serverStatusCapability } from './foundation/server-status.js';
import { isKernelDefinedCapability } from './kernel.js';

function isExposed(capability: CapabilityDefinition, context: ExposureContext): boolean {
  if (!capability.transports.includes(context.transport)) return false;
  if (context.readOnly && capability.policy.effect !== 'read') return false;
  if (
    capability.policy.requiredFeatureFlags.some((flag) => !context.enabledFeatureFlags.has(flag))
  ) {
    return false;
  }
  if (
    !areDeclaredResourceScopesAllowed(
      capability.policy.resourceScopes,
      context.allowedResourceScopes
    )
  ) {
    return false;
  }
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
}

export const CAPABILITY_CATALOG = new CapabilityCatalog([serverStatusCapability]);

export function getCapability(name: string): CapabilityDefinition | undefined {
  return CAPABILITY_CATALOG.getByMcpName(name);
}

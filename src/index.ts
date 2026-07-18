// SPDX-License-Identifier: AGPL-3.0-or-later
export { CapabilityCatalog } from './capabilities/catalog.js';
export { CAPABILITY_CATALOG, getCapability } from './capabilities/catalog.js';
export type {
  CapabilityDefinition,
  CapabilityExecutionContext,
  CapabilityPolicy,
  TransportKind
} from './capabilities/types.js';
export { loadRuntimeConfig } from './config/runtime-config.js';
export type { RuntimeConfig } from './config/runtime-config.js';

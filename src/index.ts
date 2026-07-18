// SPDX-License-Identifier: AGPL-3.0-or-later
export { CapabilityCatalog } from './capabilities/catalog.js';
export { CAPABILITY_CATALOG, getCapability } from './capabilities/catalog.js';
export { dispatchCapability } from './capabilities/dispatch.js';
export type {
  CapabilityDefinition,
  CapabilityExecutionContext,
  CapabilityPolicy,
  CapabilityRequest,
  CapabilityResult,
  ConfirmationChallenge,
  RefusalCode,
  ServerContext,
  TransportKind
} from './capabilities/types.js';
export { loadRuntimeConfig } from './config/runtime-config.js';
export type { RuntimeConfig } from './config/runtime-config.js';

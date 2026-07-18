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
export { startStdio } from './entrypoints/stdio.js';
export type { StdioRuntime } from './entrypoints/stdio.js';
export { startHttp } from './http/runtime.js';
export type { HttpRuntime, HttpStartOptions } from './http/runtime.js';
export { DEFAULT_HTTP_LIMITS } from './http/limits.js';
export type { HttpLimits } from './http/limits.js';

// SPDX-License-Identifier: AGPL-3.0-or-later
import { dispatchApplicationCapability } from '../app/application-context.js';
import type { CapabilityRequest, CapabilityResult, ServerContext } from './types.js';

export function dispatchCapability(
  request: CapabilityRequest,
  context: ServerContext
): Promise<CapabilityResult> {
  return dispatchApplicationCapability(context.application, request, {
    transport: context.transport,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    ...(context.principalId === undefined ? {} : { principalId: context.principalId })
  });
}

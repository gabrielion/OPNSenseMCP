// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CallToolResult } from '@modelcontextprotocol/server';
import { projectSealedResourceRefusalDetails } from '../capabilities/kernel.js';
import type {
  CapabilityResult,
  RefusalCode,
  ResourceRefusalDetails
} from '../capabilities/types.js';

const REFUSAL_MESSAGES: Readonly<Record<RefusalCode, string>> = Object.freeze({
  CANCELLED: 'Capability execution was cancelled.',
  CONFIRMATION_DECLINED: 'Capability confirmation was declined.',
  CONFIRMATION_INVALID: 'Capability confirmation is invalid.',
  CONFIRMATION_UNAVAILABLE: 'Capability confirmation is unavailable.',
  EXECUTION_FAILED: 'Capability execution failed.',
  FEATURE_DISABLED: 'A required capability feature is disabled.',
  INVALID_INPUT: 'Capability input is invalid.',
  INVALID_OUTPUT: 'Capability output is invalid.',
  INVALID_POLICY: 'Capability policy is invalid.',
  INVALID_RESOURCE_INPUT: 'Resource input is invalid.',
  OPERATION_NOT_AVAILABLE: 'Resource operation is not available.',
  OUTCOME_INDETERMINATE: 'Capability outcome is indeterminate.',
  READ_ONLY: 'Capability is disabled in read-only mode.',
  RESOURCE_NOT_ALLOWED: 'Capability resource scope is not allowed.',
  TIMEOUT: 'Capability execution timed out.',
  TARGET_UNAVAILABLE: 'OPNsense target is unavailable.',
  UNKNOWN_CAPABILITY: 'Capability is not available.',
  UNKNOWN_RESOURCE: 'Resource is not available.',
  UNSUPPORTED_TRANSPORT: 'Capability is not available on this transport.'
});

export function successResult(output: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(output) }],
    structuredContent: output
  };
}

export function refusalResult(code: RefusalCode, details?: ResourceRefusalDetails): CallToolResult {
  const safeDetails = projectSealedResourceRefusalDetails(code, details);
  return {
    isError: true,
    content: [{ type: 'text', text: REFUSAL_MESSAGES[code] }],
    structuredContent: { code, ...(safeDetails === undefined ? {} : { details: safeDetails }) }
  };
}

export function formatCapabilityResult(result: CapabilityResult): CallToolResult {
  if (result.kind === 'success') return successResult(result.output);
  if (result.kind === 'refused') return refusalResult(result.code, result.details);
  return refusalResult('CONFIRMATION_INVALID');
}

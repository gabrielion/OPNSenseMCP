// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CallToolResult } from '@modelcontextprotocol/server';
import { projectSealedResourceRefusalDetails } from '../capabilities/kernel.js';
import type {
  CapabilityResult,
  RefusalCode,
  ResourceRefusalDetails
} from '../capabilities/types.js';

export const REFUSAL_MESSAGES: Readonly<Record<RefusalCode, string>> = Object.freeze({
  BACKUP_FAILED: 'Capability refused: a strict verified backup could not be created.',
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
  LOCK_UNAVAILABLE: 'Capability refused: the target mutation lock is unavailable.',
  OPERATION_NOT_AVAILABLE: 'Resource operation is not available.',
  OUTCOME_INDETERMINATE:
    'Capability outcome is indeterminate. Do not retry blindly: verify the current target state before any further change.',
  OUTCOME_UNVERIFIED:
    'Capability outcome could not be verified. Do not retry blindly: verify the current target state before any further change.',
  PREFLIGHT_FAILED: 'Capability refused: the read-only preflight failed.',
  READ_ONLY: 'Capability is disabled in read-only mode.',
  RESOURCE_NOT_ALLOWED: 'Capability resource scope is not allowed.',
  STATE_REVALIDATION_FAILED: 'Capability refused: the target state changed after preflight.',
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

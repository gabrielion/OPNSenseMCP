// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { CapabilityResult, RefusalCode } from '../capabilities/types.js';

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
  OUTCOME_INDETERMINATE: 'Capability outcome is indeterminate.',
  READ_ONLY: 'Capability is disabled in read-only mode.',
  RESOURCE_NOT_ALLOWED: 'Capability resource scope is not allowed.',
  TIMEOUT: 'Capability execution timed out.',
  UNKNOWN_CAPABILITY: 'Capability is not available.',
  UNSUPPORTED_TRANSPORT: 'Capability is not available on this transport.'
});

export function successResult(output: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(output) }],
    structuredContent: output
  };
}

export function refusalResult(code: RefusalCode): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: REFUSAL_MESSAGES[code] }],
    structuredContent: { code }
  };
}

export function formatCapabilityResult(result: CapabilityResult): CallToolResult {
  if (result.kind === 'success') return successResult(result.output);
  if (result.kind === 'refused') return refusalResult(result.code);
  return refusalResult('CONFIRMATION_INVALID');
}

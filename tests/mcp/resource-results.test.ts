// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { CapabilityResult, ResourceRefusalDetails } from '../../src/capabilities/types.js';
import { formatCapabilityResult, refusalResult } from '../../src/mcp/results.js';

describe('bounded resource refusal results', () => {
  it.each([
    {
      code: 'UNKNOWN_RESOURCE' as const,
      message: 'Resource is not available.',
      details: { suggestions: ['resource.alpha', 'resource.beta'] }
    },
    {
      code: 'OPERATION_NOT_AVAILABLE' as const,
      message: 'Resource operation is not available.',
      details: { resource: 'resource.alpha', availableOperations: ['get', 'list'] }
    },
    {
      code: 'INVALID_RESOURCE_INPUT' as const,
      message: 'Resource input is invalid.',
      details: { resource: 'resource.alpha', operation: 'get', fields: ['query'] }
    },
    {
      code: 'TARGET_UNAVAILABLE' as const,
      message: 'OPNsense target is unavailable.',
      details: { resource: 'resource.alpha', operation: 'get' }
    }
  ])('projects fixed $code messages and typed safe details', ({ code, message, details }) => {
    const result = formatCapabilityResult({
      kind: 'refused',
      code,
      message: 'SENTINEL_UNTRUSTED_MESSAGE',
      details: details as ResourceRefusalDetails
    });

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: message }],
      structuredContent: { code, details }
    });
    expect(JSON.stringify(result)).not.toContain('SENTINEL');
  });

  it('drops malformed detail values instead of reflecting them', () => {
    const malformed = {
      kind: 'refused',
      code: 'UNKNOWN_RESOURCE',
      message: 'SENTINEL_MESSAGE',
      details: { suggestions: ['resource.alpha', 'SENTINEL SECRET VALUE'] }
    } as CapabilityResult;

    expect(formatCapabilityResult(malformed)).toEqual(refusalResult('UNKNOWN_RESOURCE'));
    expect(JSON.stringify(formatCapabilityResult(malformed))).not.toContain('SENTINEL');
  });
});

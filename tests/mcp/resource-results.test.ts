// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { CapabilityResult, ResourceRefusalDetails } from '../../src/capabilities/types.js';
import { REFUSAL_MESSAGES, formatCapabilityResult, refusalResult } from '../../src/mcp/results.js';
import { KERNEL_REFUSAL_MESSAGES } from '../../src/capabilities/kernel.js';

describe('bounded resource refusal results', () => {
  it('never claims a preserved backup in a refusal an operator cannot act on', () => {
    // The store is durable now (src/app/default-application.ts composes it on the state root), but
    // a refusal that tells an operator to consult a backup has to name something it can be found
    // by, and that vocabulary does not exist yet — reconciliation owns it. Until then no message
    // may make the claim.
    const claims = Object.entries(REFUSAL_MESSAGES)
      .filter(([, message]) => /backup is preserved|preserved backup/iu.test(message))
      .map(([code]) => code);

    expect(claims).toEqual([]);
  });

  it('keeps the kernel and MCP refusal tables byte-identical', () => {
    expect(REFUSAL_MESSAGES).toEqual(KERNEL_REFUSAL_MESSAGES);
  });

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
  ])(
    'drops direct hand-built $code details even when they look safe',
    ({ code, message, details }) => {
      const result = formatCapabilityResult({
        kind: 'refused',
        code,
        message: 'SENTINEL_UNTRUSTED_MESSAGE',
        details: details as ResourceRefusalDetails
      });

      expect(result).toEqual({
        isError: true,
        content: [{ type: 'text', text: message }],
        structuredContent: { code }
      });
      expect(JSON.stringify(result)).not.toContain('SENTINEL');
    }
  );

  it.each([
    {
      label: 'suggestion',
      code: 'UNKNOWN_RESOURCE' as const,
      details: { suggestions: ['SENTINEL_SECRET_VALUE'] }
    },
    {
      label: 'operation availability resource',
      code: 'OPERATION_NOT_AVAILABLE' as const,
      details: { resource: 'SENTINEL_SECRET_VALUE', availableOperations: ['get'] }
    },
    {
      label: 'available operation',
      code: 'OPERATION_NOT_AVAILABLE' as const,
      details: { resource: 'resource.alpha', availableOperations: ['SENTINEL_SECRET_VALUE'] }
    },
    {
      label: 'invalid-input resource',
      code: 'INVALID_RESOURCE_INPUT' as const,
      details: {
        resource: 'SENTINEL_SECRET_VALUE',
        operation: 'get',
        fields: ['query']
      }
    },
    {
      label: 'invalid-input operation',
      code: 'INVALID_RESOURCE_INPUT' as const,
      details: {
        resource: 'resource.alpha',
        operation: 'SENTINEL_SECRET_VALUE',
        fields: ['query']
      }
    },
    {
      label: 'invalid-input field',
      code: 'INVALID_RESOURCE_INPUT' as const,
      details: {
        resource: 'resource.alpha',
        operation: 'get',
        fields: ['SENTINEL_SECRET_VALUE']
      }
    },
    {
      label: 'target resource',
      code: 'TARGET_UNAVAILABLE' as const,
      details: { resource: 'SENTINEL_SECRET_VALUE', operation: 'get' }
    },
    {
      label: 'target operation',
      code: 'TARGET_UNAVAILABLE' as const,
      details: { resource: 'resource.alpha', operation: 'SENTINEL_SECRET_VALUE' }
    }
  ])('drops an unsealed identifier-shaped sentinel in the $label detail', ({ code, details }) => {
    const malformed = {
      kind: 'refused',
      code,
      message: 'SENTINEL_MESSAGE',
      details
    } as CapabilityResult;

    expect(formatCapabilityResult(malformed)).toEqual(refusalResult(code));
    expect(JSON.stringify(formatCapabilityResult(malformed))).not.toContain(
      'SENTINEL_SECRET_VALUE'
    );
  });
});

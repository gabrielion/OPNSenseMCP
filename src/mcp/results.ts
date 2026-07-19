// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CallToolResult } from '@modelcontextprotocol/server';
import { isProxy } from 'node:util/types';
import type {
  CapabilityResult,
  RefusalCode,
  ResourceRefusalDetails
} from '../capabilities/types.js';

const MAX_DETAIL_NAME_LENGTH = 128;
const MAX_DETAIL_ARRAY_LENGTH = 16;
const MAX_SUGGESTIONS = 3;

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

function isSafeName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_DETAIL_NAME_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
  );
}

function readDataRecord(
  value: unknown,
  expectedKeys: readonly string[]
): ReadonlyMap<string, unknown> | undefined {
  if (isProxy(value) || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    return undefined;
  }
  const result = new Map<string, unknown>();
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !('value' in descriptor)) return undefined;
    result.set(key, descriptor.value);
  }
  return result;
}

function readNames(value: unknown, maximumLength: number): readonly string[] | undefined {
  if (isProxy(value) || !Array.isArray(value) || value.length > maximumLength) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) return undefined;
  const names: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !('value' in descriptor) || !isSafeName(descriptor.value)) {
      return undefined;
    }
    names.push(descriptor.value);
  }
  if (new Set(names).size !== names.length) return undefined;
  return Object.freeze(names);
}

function copySafeDetails(
  code: RefusalCode,
  value: ResourceRefusalDetails | undefined
): ResourceRefusalDetails | undefined {
  if (code === 'UNKNOWN_RESOURCE') {
    const details = readDataRecord(value, ['suggestions']);
    if (details === undefined) return undefined;
    const suggestions = readNames(details.get('suggestions'), MAX_SUGGESTIONS);
    return suggestions === undefined ? undefined : Object.freeze({ suggestions });
  }
  if (code === 'OPERATION_NOT_AVAILABLE') {
    const details = readDataRecord(value, ['resource', 'availableOperations']);
    if (details === undefined || !isSafeName(details.get('resource'))) return undefined;
    const availableOperations = readNames(
      details.get('availableOperations'),
      MAX_DETAIL_ARRAY_LENGTH
    );
    return availableOperations === undefined
      ? undefined
      : Object.freeze({ resource: details.get('resource') as string, availableOperations });
  }
  if (code === 'INVALID_RESOURCE_INPUT') {
    const details = readDataRecord(value, ['resource', 'operation', 'fields']);
    if (
      details === undefined ||
      !isSafeName(details.get('resource')) ||
      !isSafeName(details.get('operation'))
    ) {
      return undefined;
    }
    const fields = readNames(details.get('fields'), MAX_DETAIL_ARRAY_LENGTH);
    return fields === undefined
      ? undefined
      : Object.freeze({
          resource: details.get('resource') as string,
          operation: details.get('operation') as string,
          fields
        });
  }
  if (code === 'TARGET_UNAVAILABLE') {
    const details = readDataRecord(value, ['resource', 'operation']);
    if (
      details === undefined ||
      !isSafeName(details.get('resource')) ||
      !isSafeName(details.get('operation'))
    ) {
      return undefined;
    }
    return Object.freeze({
      resource: details.get('resource') as string,
      operation: details.get('operation') as string
    });
  }
  return undefined;
}

export function successResult(output: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(output) }],
    structuredContent: output
  };
}

export function refusalResult(code: RefusalCode, details?: ResourceRefusalDetails): CallToolResult {
  const safeDetails = copySafeDetails(code, details);
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

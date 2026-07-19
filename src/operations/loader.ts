// SPDX-License-Identifier: AGPL-3.0-or-later
import { GENERATED_OPERATION_DESCRIPTORS } from './generated/descriptors.js';
import type { OperationDescriptor, RuntimeOperationDescriptor } from './types.js';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const descriptors = deepFreeze([
  ...GENERATED_OPERATION_DESCRIPTORS
]) as readonly OperationDescriptor[];
const byKey = new Map(descriptors.map((descriptor) => [descriptor.key, descriptor] as const));

if (descriptors.length !== byKey.size) throw new Error('Invalid generated operation descriptors');

export const OPERATION_DESCRIPTORS = descriptors;

export function getOperationDescriptor(key: string): OperationDescriptor | undefined {
  return byKey.get(key);
}

export function getRuntimeOperationDescriptor(
  key: string,
  operationName: string
): RuntimeOperationDescriptor | undefined {
  return byKey.get(key)?.runtime.operations.find((operation) => operation.name === operationName);
}

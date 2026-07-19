// SPDX-License-Identifier: AGPL-3.0-or-later
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

const MAX_DEPTH = 64;
const MAX_NODES = 10_000;
const MAX_UTF8_BYTES = 262_144;
const CANONICALIZATION_ERROR = 'Value is not valid canonical JSON';

export interface CanonicalJsonSnapshot {
  readonly canonical: string;
  readonly sha256: string;
  readonly value: unknown;
}

interface SerializationState {
  readonly ancestors: Set<object>;
  readonly chunks: string[];
  nodes: number;
  utf8Bytes: number;
}

function invalidCanonicalJson(): never {
  throw new Error(CANONICALIZATION_ERROR);
}

function appendChunk(state: SerializationState, chunk: string): void {
  const nextSize = state.utf8Bytes + Buffer.byteLength(chunk, 'utf8');
  if (nextSize > MAX_UTF8_BYTES) invalidCanonicalJson();
  state.utf8Bytes = nextSize;
  state.chunks.push(chunk);
}

function appendJsonString(state: SerializationState, value: string): void {
  appendChunk(state, '"');
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    switch (codeUnit) {
      case 0x08:
        appendChunk(state, '\\b');
        continue;
      case 0x09:
        appendChunk(state, '\\t');
        continue;
      case 0x0a:
        appendChunk(state, '\\n');
        continue;
      case 0x0c:
        appendChunk(state, '\\f');
        continue;
      case 0x0d:
        appendChunk(state, '\\r');
        continue;
      case 0x22:
        appendChunk(state, '\\"');
        continue;
      case 0x5c:
        appendChunk(state, '\\\\');
        continue;
      default:
        break;
    }

    if (codeUnit < 0x20) {
      appendChunk(state, `\\u${codeUnit.toString(16).padStart(4, '0')}`);
      continue;
    }

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        appendChunk(state, value.slice(index, index + 2));
        index += 1;
        continue;
      }
      appendChunk(state, `\\u${codeUnit.toString(16)}`);
      continue;
    }

    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      appendChunk(state, `\\u${codeUnit.toString(16)}`);
      continue;
    }

    appendChunk(state, value[index] ?? invalidCanonicalJson());
  }
  appendChunk(state, '"');
}

function enterNode(state: SerializationState, depth: number): void {
  if (depth > MAX_DEPTH) invalidCanonicalJson();
  state.nodes += 1;
  if (state.nodes > MAX_NODES) invalidCanonicalJson();
}

function compareUnicodeCodePoints(left: string, right: string): number {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex);
    const rightPoint = right.codePointAt(rightIndex);
    if (leftPoint === undefined || rightPoint === undefined) invalidCanonicalJson();
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  if (leftIndex === left.length && rightIndex === right.length) return 0;
  return leftIndex === left.length ? -1 : 1;
}

function serializeArray(state: SerializationState, value: unknown[], depth: number): void {
  if (Object.getPrototypeOf(value) !== Array.prototype) invalidCanonicalJson();

  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol')) invalidCanonicalJson();
  if (keys.length !== value.length + 1 || !keys.includes('length')) invalidCanonicalJson();

  appendChunk(state, '[');
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) invalidCanonicalJson();
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      invalidCanonicalJson();
    }
    if (index > 0) appendChunk(state, ',');
    serializeValue(state, descriptor.value, depth + 1);
  }
  appendChunk(state, ']');
}

function serializeRecord(
  state: SerializationState,
  value: Record<string, unknown>,
  depth: number
): void {
  const prototype: unknown = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) invalidCanonicalJson();

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === 'symbol')) invalidCanonicalJson();
  const keys = ownKeys as string[];
  const descriptors = new Map<string, PropertyDescriptor>();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      invalidCanonicalJson();
    }
    descriptors.set(key, descriptor);
  }
  keys.sort(compareUnicodeCodePoints);

  appendChunk(state, '{');
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) invalidCanonicalJson();
    const descriptor = descriptors.get(key);
    if (descriptor === undefined || !('value' in descriptor)) invalidCanonicalJson();
    if (index > 0) appendChunk(state, ',');
    appendJsonString(state, key);
    appendChunk(state, ':');
    serializeValue(state, descriptor.value, depth + 1);
  }
  appendChunk(state, '}');
}

function serializeValue(state: SerializationState, value: unknown, depth: number): void {
  enterNode(state, depth);
  if (value === null) {
    appendChunk(state, 'null');
    return;
  }

  switch (typeof value) {
    case 'boolean':
      appendChunk(state, value ? 'true' : 'false');
      return;
    case 'string':
      appendJsonString(state, value);
      return;
    case 'number': {
      if (!Number.isFinite(value)) invalidCanonicalJson();
      const serialized = JSON.stringify(value);
      appendChunk(state, serialized);
      return;
    }
    case 'object':
      break;
    default:
      invalidCanonicalJson();
  }

  if (state.ancestors.has(value)) invalidCanonicalJson();
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      serializeArray(state, value, depth);
    } else {
      serializeRecord(state, value as Record<string, unknown>, depth);
    }
  } finally {
    state.ancestors.delete(value);
  }
}

function serializeCanonicalJson(value: unknown): string {
  const state: SerializationState = {
    ancestors: new Set(),
    chunks: [],
    nodes: 0,
    utf8Bytes: 0
  };
  try {
    serializeValue(state, value, 0);
    return state.chunks.join('');
  } catch {
    throw new Error(CANONICALIZATION_ERROR);
  }
}

function hashCanonicalJson(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function deepFreezeJson(value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreezeJson(child);
    Object.freeze(value);
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return serializeCanonicalJson(value);
}

export function sha256Json(value: unknown): string {
  return hashCanonicalJson(serializeCanonicalJson(value));
}

export function createCanonicalJsonSnapshot(value: unknown): CanonicalJsonSnapshot {
  const canonical = serializeCanonicalJson(value);
  return Object.freeze({
    canonical,
    sha256: hashCanonicalJson(canonical),
    value: deepFreezeJson(JSON.parse(canonical) as unknown)
  });
}

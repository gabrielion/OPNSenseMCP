// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Json } from '../../src/security/canonical-json.js';

describe('canonical JSON', () => {
  it('sorts object keys recursively with JavaScript UTF-16 relational order', () => {
    const value = Object.assign(Object.create(null) as Record<string, unknown>, {
      '\uE000': 'bmp',
      '😀': 'astral',
      '2': 'two',
      '10': 'ten',
      nested: { z: true, a: false }
    });

    expect(canonicalJson(value)).toBe(
      '{"10":"ten","2":"two","nested":{"a":false,"z":true},"😀":"astral","":"bmp"}'
    );
  });

  it('hashes semantically identical objects to the same SHA-256 digest', () => {
    const first = { z: 1, nested: { second: true, first: false } };
    const second = { nested: { first: false, second: true }, z: 1 };

    expect(sha256Json(first)).toMatch(/^[a-f\d]{64}$/u);
    expect(sha256Json(first)).toBe(sha256Json(second));
  });

  it('preserves dense array order', () => {
    expect(canonicalJson(['second', 'first', { b: 2, a: 1 }])).toBe(
      '["second","first",{"a":1,"b":2}]'
    );
  });

  it('rejects top-level and nested sparse arrays', () => {
    const topLevel = new Array<unknown>(1);
    const nestedArray = new Array<string>(3);
    nestedArray[0] = 'present';
    nestedArray[2] = 'present';
    const nested = { values: nestedArray };

    expect(() => canonicalJson(topLevel)).toThrow();
    expect(() => canonicalJson(nested)).toThrow();
  });

  it('rejects values outside the closed JSON data model', () => {
    class Instance {
      readonly value = 'instance';
    }

    const accessor = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => 'accessor-value'
    });
    const symbolKey = { value: 'ordinary' };
    Object.defineProperty(symbolKey, Symbol('hidden'), {
      enumerable: true,
      value: 'symbol-value'
    });
    const nonEnumerable = Object.defineProperty({}, 'hidden', {
      enumerable: false,
      value: 'non-enumerable-value'
    });
    const extraArrayProperty = ['value'];
    Object.defineProperty(extraArrayProperty, 'extra', {
      enumerable: true,
      value: 'extra-value'
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    const rejected: unknown[] = [
      undefined,
      1n,
      Symbol('value'),
      () => undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      new Date(0),
      new Instance(),
      accessor,
      symbolKey,
      nonEnumerable,
      extraArrayProperty,
      cyclic,
      { nested: undefined }
    ];

    for (const value of rejected) {
      expect(() => canonicalJson(value)).toThrow();
    }
  });

  it('enforces depth, node-count, and UTF-8 byte limits', () => {
    let tooDeep: unknown = null;
    for (let index = 0; index < 65; index += 1) tooDeep = { child: tooDeep };

    expect(() => canonicalJson(tooDeep)).toThrow();
    expect(() => canonicalJson(Array.from({ length: 10_001 }, () => null))).toThrow();
    expect(() => canonicalJson('x'.repeat(262_143))).toThrow();
  });

  it('accepts only primitive JSON values, dense arrays, and plain data records', () => {
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, {
      valid: [null, true, false, 'text', 0, -12.5]
    });

    expect(canonicalJson(nullPrototype)).toBe('{"valid":[null,true,false,"text",0,-12.5]}');
  });

  it('never includes a rejected value in canonicalization errors', () => {
    const sentinel = 'CANONICAL-SENTINEL-SECRET';
    const rejected = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => sentinel
    });

    try {
      canonicalJson(rejected);
      expect.unreachable('canonicalJson should reject accessors');
    } catch (error) {
      expect(String(error)).not.toContain(sentinel);
    }
  });
});

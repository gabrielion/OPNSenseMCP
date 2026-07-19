# Private Provenance Baseline Test Appendices

**Test boundary:** synthetic-only/no private inputs

## Appendix D: Complete Metadata and Public-Contract Test

Complete content of `tests/provenance/private-baseline-metadata.test.mjs`:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import {
  validateBaselineMetadata,
  validatePublicContract
} from '../../scripts/provenance/private-baseline-values.mjs';
import {
  expectPrivateFailure,
  makePrivateBaseline,
  PUBLIC_CONTRACT
} from './fixtures/private-baseline-fixture.mjs';

const PUBLIC_CALLBACK_SENTINEL = 'PUBLIC_CALLBACK_SENTINEL';

function validate(value, contract = PUBLIC_CONTRACT) {
  const acceptedContract = validatePublicContract(contract);
  validateBaselineMetadata(value, acceptedContract);
}

function mutation(name, change) {
  return { name, change };
}

function makePublicContract() {
  return {
    inventory: PUBLIC_CONTRACT.inventory,
    counts: PUBLIC_CONTRACT.counts,
    collisionKey: PUBLIC_CONTRACT.collisionKey,
    compare: PUBLIC_CONTRACT.compare,
    isPortable: PUBLIC_CONTRACT.isPortable
  };
}

function forbiddenReference(category, value) {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
  return {
    category,
    utf8Base64: bytes.toString('base64')
  };
}

function uniqueDigests(count) {
  return Array.from({ length: count }, (_, index) => index.toString(16).padStart(64, '0'));
}

function uniqueReferences(count) {
  return [
    forbiddenReference('legacy-reference', 'legacy-reference-000'),
    ...Array.from({ length: count - 1 }, (_, index) =>
      forbiddenReference('private-path', `private-reference-${String(index).padStart(3, '0')}`)
    )
  ];
}

const INVALID_METADATA = [
  mutation('schema version', (value) => {
    value.schemaVersion = 2;
  }),
  mutation('inventory digest case', (value) => {
    value.inventorySha256 = 'A'.repeat(64);
  }),
  mutation('bundle digest', (value) => {
    value.sourceEvidence.bundleSha256 = 'g'.repeat(64);
  }),
  mutation('composition digest', (value) => {
    value.sourceEvidence.compositionSha256 = 'a'.repeat(63);
  }),
  mutation('40-character revision case', (value) => {
    value.sourceEvidence.selectedRevision = 'A'.repeat(40);
  }),
  mutation('revision length', (value) => {
    value.sourceEvidence.selectedRevision = 'a'.repeat(41);
  }),
  mutation('revision type', (value) => {
    value.sourceEvidence.selectedRevision = null;
  }),
  mutation('ref count low', (value) => {
    value.sourceEvidence.corpusRefCount = 0;
  }),
  mutation('ref count high', (value) => {
    value.sourceEvidence.corpusRefCount = 10_001;
  }),
  mutation('ref count fractional', (value) => {
    value.sourceEvidence.corpusRefCount = 1.5;
  }),
  mutation('ref fingerprint digest', (value) => {
    value.sourceEvidence.corpusRefFingerprintSha256 = 'A'.repeat(64);
  }),
  mutation('object count low', (value) => {
    value.sourceEvidence.corpusObjectCount = 0;
  }),
  mutation('object count high', (value) => {
    value.sourceEvidence.corpusObjectCount = 100_001;
  }),
  mutation('object count fractional', (value) => {
    value.sourceEvidence.corpusObjectCount = 1.5;
  }),
  mutation('corpus fingerprint digest', (value) => {
    value.sourceEvidence.corpusFingerprintSha256 = 'x'.repeat(64);
  }),
  mutation('negative index count', (value) => {
    value.sourceEvidence.similarityIndexBlobCount = -1;
  }),
  mutation('index count above objects', (value) => {
    value.sourceEvidence.similarityIndexBlobCount = 2;
  }),
  mutation('fractional index count', (value) => {
    value.sourceEvidence.similarityIndexBlobCount = 0.5;
  }),
  mutation('similarity index digest', (value) => {
    value.sourceEvidence.similarityIndexSha256 = 'f'.repeat(63);
  }),
  mutation('non-array forbidden digests', (value) => {
    value.scanPolicy.forbiddenBlobSha256 = null;
  }),
  mutation('invalid forbidden digest', (value) => {
    value.scanPolicy.forbiddenBlobSha256 = ['g'.repeat(64)];
  }),
  mutation('duplicate forbidden digest', (value) => {
    value.scanPolicy.forbiddenBlobSha256 = ['1'.repeat(64), '1'.repeat(64)];
  }),
  mutation('unsorted forbidden digests', (value) => {
    value.scanPolicy.forbiddenBlobSha256 = ['2'.repeat(64), '1'.repeat(64)];
  }),
  mutation('513 forbidden digests', (value) => {
    value.scanPolicy.forbiddenBlobSha256 = uniqueDigests(513);
  }),
  mutation('non-array forbidden references', (value) => {
    value.scanPolicy.forbiddenReferences = null;
  }),
  mutation('257 forbidden references', (value) => {
    value.scanPolicy.forbiddenReferences = uniqueReferences(257);
  }),
  mutation('missing legacy reference', (value) => {
    value.scanPolicy.forbiddenReferences = [forbiddenReference('private-path', 'path')];
  }),
  mutation('duplicate forbidden reference', (value) => {
    value.scanPolicy.forbiddenReferences.push(
      structuredClone(value.scanPolicy.forbiddenReferences[0])
    );
  }),
  mutation('references unsorted by category bytes', (value) => {
    value.scanPolicy.forbiddenReferences = [
      forbiddenReference('private-path', 'a'),
      forbiddenReference('legacy-reference', 'z')
    ];
  }),
  mutation('references unsorted by decoded bytes', (value) => {
    value.scanPolicy.forbiddenReferences = [
      forbiddenReference('legacy-reference', 'z'),
      forbiddenReference('legacy-reference', 'a')
    ];
  }),
  mutation('invalid reference category', (value) => {
    value.scanPolicy.forbiddenReferences[0].category = 'secret';
  }),
  mutation('noncanonical base64', (value) => {
    value.scanPolicy.forbiddenReferences[0].utf8Base64 = 'YQ';
  }),
  mutation('empty reference', (value) => {
    value.scanPolicy.forbiddenReferences[0].utf8Base64 = '';
  }),
  mutation('non-string base64', (value) => {
    value.scanPolicy.forbiddenReferences[0].utf8Base64 = null;
  }),
  mutation('malformed UTF-8 reference', (value) => {
    value.scanPolicy.forbiddenReferences[0].utf8Base64 = Buffer.from([0xc3, 0x28]).toString(
      'base64'
    );
  }),
  mutation('4097-byte reference', (value) => {
    value.scanPolicy.forbiddenReferences[0].utf8Base64 = Buffer.alloc(4097, 0x61).toString(
      'base64'
    );
  }),
  mutation('algorithm override', (value) => {
    value.scanPolicy.similarityAlgorithm = 'other';
  }),
  mutation('threshold override', (value) => {
    value.scanPolicy.similarityThresholdPermille = 749;
  }),
  mutation('pending review with reviewer', (value) => {
    value.baselineReview.reviewerId = 'snapshot-reviewer';
  }),
  mutation('reviewed snapshot without reviewer', (value) => {
    value.baselineReview.verdict = 'reviewed-snapshot';
  }),
  mutation('reviewed snapshot with invalid reviewer', (value) => {
    value.baselineReview = {
      reviewerId: 'invalid reviewer',
      verdict: 'reviewed-snapshot'
    };
  }),
  mutation('unknown snapshot verdict', (value) => {
    value.baselineReview.verdict = 'approved';
  }),
  mutation('non-array assets', (value) => {
    value.assets = null;
  }),
  mutation('wrong asset count', (value) => {
    value.assets = value.assets.slice(0, -1);
  })
];

const INVALID_PUBLIC_CONTRACTS = [
  mutation('missing key', (contract) => {
    delete contract.isPortable;
  }),
  mutation('extra key', (contract) => {
    contract.unexpected = true;
  }),
  mutation('non-enumerable extra key', (contract) => {
    Object.defineProperty(contract, 'hidden', { value: true });
  }),
  mutation('symbol extra key', (contract) => {
    contract[Symbol('extra')] = true;
  }),
  mutation('alternate prototype', (contract) => {
    Object.setPrototypeOf(contract, null);
  }),
  mutation('reordered keys', (contract) => {
    const inventory = contract.inventory;
    delete contract.inventory;
    contract.inventory = inventory;
  }),
  mutation('replacement inventory array', (contract) => {
    contract.inventory = [...contract.inventory];
  }),
  mutation('replacement inventory rows', (contract) => {
    contract.inventory = contract.inventory.map((row) => ({ ...row }));
  }),
  mutation('115 rows', (contract) => {
    contract.inventory = contract.inventory.slice(0, -1);
  }),
  mutation('count-preserving class swap', (contract) => {
    const inventory = contract.inventory.map((row) => ({ ...row }));
    const approvedIndex = inventory.findIndex((row) => row.class === 'approved');
    const rewriteIndex = inventory.findIndex((row) => row.class === 'rewrite');
    const approvedClass = inventory[approvedIndex].class;
    inventory[approvedIndex].class = inventory[rewriteIndex].class;
    inventory[rewriteIndex].class = approvedClass;
    contract.inventory = inventory;
  }),
  mutation('row reorder', (contract) => {
    const inventory = [...contract.inventory];
    [inventory[0], inventory[1]] = [inventory[1], inventory[0]];
    contract.inventory = inventory;
  }),
  mutation('duplicate destination', (contract) => {
    const inventory = contract.inventory.map((row) => ({ ...row }));
    inventory[1].destination = inventory[0].destination;
    contract.inventory = inventory;
  }),
  mutation('portable case collision', (contract) => {
    const inventory = contract.inventory.map((row) => ({ ...row }));
    inventory[0].destination = 'readme.md';
    contract.inventory = inventory;
  }),
  mutation('nonportable destination', (contract) => {
    const inventory = contract.inventory.map((row) => ({ ...row }));
    inventory[0].destination = '../private';
    contract.inventory = inventory;
  }),
  mutation('replacement count map', (contract) => {
    contract.counts = { ...contract.counts };
  }),
  mutation('wrong public counts', (contract) => {
    contract.counts = {
      approved: 104,
      rewrite: 4,
      discard: 8
    };
  })
];

describe('private baseline public-contract authority', () => {
  it('accepts a fresh wrapper containing the exact authoritative exports', () => {
    const contract = makePublicContract();
    const accepted = validatePublicContract(contract);
    expect(accepted).not.toBe(contract);
    expect(validatePublicContract(makePublicContract())).toBe(accepted);
    expect(Object.isFrozen(accepted)).toBe(true);
    for (const key of Object.keys(PUBLIC_CONTRACT)) {
      expect(accepted[key]).toBe(PUBLIC_CONTRACT[key]);
    }
    for (const key of Object.keys(contract)) contract[key] = null;
    expect(accepted.inventory).toBe(PUBLIC_CONTRACT.inventory);
    expect(() => validateBaselineMetadata(makePrivateBaseline(), accepted)).not.toThrow();
  });

  it.each(Object.keys(PUBLIC_CONTRACT))(
    'rejects accessor-backed %s authority without invoking it',
    (key) => {
      const getter = vi.fn(() => PUBLIC_CONTRACT[key]);
      const contract = makePublicContract();
      Object.defineProperty(contract, key, {
        configurable: true,
        enumerable: true,
        get: getter
      });

      expectPrivateFailure(() => validatePublicContract(contract));
      expect(getter).not.toHaveBeenCalled();
    }
  );

  it('rejects a getter/setter descriptor without invoking either accessor', () => {
    const getter = vi.fn(() => PUBLIC_CONTRACT.inventory);
    const setter = vi.fn(() => {
      throw new Error(PUBLIC_CALLBACK_SENTINEL);
    });
    const contract = makePublicContract();
    Object.defineProperty(contract, 'inventory', {
      enumerable: true,
      get: getter,
      set: setter
    });

    expectPrivateFailure(() => validatePublicContract(contract), [PUBLIC_CALLBACK_SENTINEL]);
    expect(getter).not.toHaveBeenCalled();
    expect(setter).not.toHaveBeenCalled();
  });

  it('rejects a Proxy contract before invoking reflection traps', () => {
    const trap = vi.fn(() => {
      throw new Error(PUBLIC_CALLBACK_SENTINEL);
    });
    const contract = new Proxy(makePublicContract(), {
      get: trap,
      getPrototypeOf: trap,
      getOwnPropertyDescriptor: trap,
      ownKeys: trap
    });

    expectPrivateFailure(() => validatePublicContract(contract), [PUBLIC_CALLBACK_SENTINEL]);
    expect(trap).not.toHaveBeenCalled();
  });

  it.each(INVALID_PUBLIC_CONTRACTS)('rejects $name by authoritative identity', ({ change }) => {
    const contract = makePublicContract();
    change(contract);
    expectPrivateFailure(() => validatePublicContract(contract));
  });

  it.each(['collisionKey', 'compare', 'isPortable'])(
    'rejects a non-function %s replacement',
    (key) => {
      const contract = makePublicContract();
      contract[key] = null;
      expectPrivateFailure(() => validatePublicContract(contract));
    }
  );

  it.each(['collisionKey', 'compare', 'isPortable'])(
    'rejects replacement callback %s without invoking it',
    (key) => {
      const callback = vi.fn(() => {
        throw new Error(PUBLIC_CALLBACK_SENTINEL);
      });
      const contract = makePublicContract();
      contract[key] = callback;

      expectPrivateFailure(() => validatePublicContract(contract), [PUBLIC_CALLBACK_SENTINEL]);
      expect(callback).not.toHaveBeenCalled();
    }
  );

  it('does not invoke callbacks while rejecting a replacement inventory', () => {
    const collisionKey = vi.fn(() => {
      throw new Error(PUBLIC_CALLBACK_SENTINEL);
    });
    const compare = vi.fn(() => {
      throw new Error(PUBLIC_CALLBACK_SENTINEL);
    });
    const isPortable = vi.fn(() => {
      throw new Error(PUBLIC_CALLBACK_SENTINEL);
    });
    const contract = {
      inventory: PUBLIC_CONTRACT.inventory.map((row) => ({ ...row })),
      counts: PUBLIC_CONTRACT.counts,
      collisionKey,
      compare,
      isPortable
    };

    expectPrivateFailure(() => validatePublicContract(contract), [PUBLIC_CALLBACK_SENTINEL]);
    expect(collisionKey).not.toHaveBeenCalled();
    expect(compare).not.toHaveBeenCalled();
    expect(isPortable).not.toHaveBeenCalled();
  });
});

describe('private baseline source evidence and metadata', () => {
  it('accepts the canonical synthetic metadata', () => {
    expect(() => validate(makePrivateBaseline())).not.toThrow();
  });

  it.each(INVALID_METADATA)('rejects invalid $name', ({ change }) => {
    const value = makePrivateBaseline();
    change(value);
    expectPrivateFailure(() => validate(value));
  });

  it.each([
    mutation('40-character revision', (value) => {
      value.sourceEvidence.selectedRevision = '0'.repeat(40);
    }),
    mutation('64-character revision', (value) => {
      value.sourceEvidence.selectedRevision = 'f'.repeat(64);
    }),
    mutation('minimum ref count', (value) => {
      value.sourceEvidence.corpusRefCount = 1;
    }),
    mutation('maximum ref count', (value) => {
      value.sourceEvidence.corpusRefCount = 10_000;
    }),
    mutation('minimum object count', (value) => {
      value.sourceEvidence.corpusObjectCount = 1;
      value.sourceEvidence.similarityIndexBlobCount = 0;
    }),
    mutation('maximum object count', (value) => {
      value.sourceEvidence.corpusObjectCount = 100_000;
    }),
    mutation('zero index count', (value) => {
      value.sourceEvidence.similarityIndexBlobCount = 0;
    }),
    mutation('index count equal to object count', (value) => {
      value.sourceEvidence.corpusObjectCount = 100_000;
      value.sourceEvidence.similarityIndexBlobCount = 100_000;
    })
  ])('accepts source-evidence boundary $name', ({ change }) => {
    const value = makePrivateBaseline();
    change(value);
    expect(() => validate(value)).not.toThrow();
  });
});

describe('private baseline scan policy', () => {
  it('accepts 512 unique bytewise-sorted forbidden digests', () => {
    const value = makePrivateBaseline();
    value.scanPolicy.forbiddenBlobSha256 = uniqueDigests(512);
    expect(() => validate(value)).not.toThrow();
  });

  it('accepts 256 unique category-and-decoded-byte-sorted references', () => {
    const value = makePrivateBaseline();
    value.scanPolicy.forbiddenReferences = uniqueReferences(256);
    expect(() => validate(value)).not.toThrow();
  });

  it.each([1, 4096])('accepts a decoded reference of %i bytes', (length) => {
    const value = makePrivateBaseline();
    value.scanPolicy.forbiddenReferences = [
      forbiddenReference('legacy-reference', Buffer.alloc(length, 0x61))
    ];
    expect(() => validate(value)).not.toThrow();
  });

  it('orders references by decoded bytes rather than base64 text', () => {
    const lowerDecodedBytes = forbiddenReference('legacy-reference', Buffer.from([0xc2, 0x80]));
    const higherDecodedBytes = forbiddenReference('legacy-reference', Buffer.from([0xd0, 0x80]));

    expect(
      Buffer.compare(
        Buffer.from(lowerDecodedBytes.utf8Base64, 'ascii'),
        Buffer.from(higherDecodedBytes.utf8Base64, 'ascii')
      )
    ).toBeGreaterThan(0);

    const value = makePrivateBaseline();
    value.scanPolicy.forbiddenReferences = [lowerDecodedBytes, higherDecodedBytes];
    expect(() => validate(value)).not.toThrow();
  });

  it('defines uniqueness by category plus decoded bytes', () => {
    const value = makePrivateBaseline();
    value.scanPolicy.forbiddenReferences = [
      forbiddenReference('legacy-reference', 'same bytes'),
      forbiddenReference('private-identifier', 'same bytes'),
      forbiddenReference('private-path', 'same bytes')
    ];
    expect(() => validate(value)).not.toThrow();
  });
});

describe('private baseline snapshot review', () => {
  it.each([
    ['pending review', null, 'pending'],
    ['minimum reviewed identity', 'r', 'reviewed-snapshot'],
    ['maximum reviewed identity', 'r'.repeat(128), 'reviewed-snapshot']
  ])('accepts %s', (_name, reviewerId, verdict) => {
    const value = makePrivateBaseline();
    value.baselineReview = { reviewerId, verdict };
    expect(() => validate(value)).not.toThrow();
  });
});
```

## Appendix F: Complete Shape, Canonical-Bytes, and Facade Tests

Complete content of `tests/provenance/private-baseline-bytes.test.mjs`:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { MIGRATION_INVENTORY } from '../../scripts/provenance/inventory.mjs';
import {
  projectCanonicalBaselineShape,
  projectCompositionShape
} from '../../scripts/provenance/private-baseline-shape.mjs';
import {
  canonicalJsonBytes,
  copyAndParsePrivateJson,
  deepFreeze,
  requireBoundedInteger,
  requireDigest,
  requireExactKeys,
  requireIdentity
} from '../../scripts/provenance/private-json.mjs';
import {
  canonicalFixtureBytes,
  expectPrivateFailure,
  fixtureCompositionShape,
  makePrivateBaseline
} from './fixtures/private-baseline-fixture.mjs';

const STRUCTURAL_LEVELS = [
  ['top', (value) => value],
  ['sourceEvidence', (value) => value.sourceEvidence],
  ['scanPolicy', (value) => value.scanPolicy],
  ['forbiddenReference', (value) => value.scanPolicy.forbiddenReferences[0]],
  ['baselineReview', (value) => value.baselineReview],
  ['asset', (value) => value.assets.find((row) => row.class === 'approved')],
  [
    'sourceAuthorization',
    (value) => value.assets.find((row) => row.class === 'approved').sourceAuthorization
  ],
  ['scanReference', (value) => value.assets.find((row) => row.class === 'rewrite').scanReference],
  [
    'integrationReview',
    (value) => value.assets.find((row) => row.class === 'approved').integrationReview
  ],
  [
    'destinationReview',
    (value) => value.assets.find((row) => row.class === 'approved').destinationReview
  ],
  ['discardReview', (value) => value.assets.find((row) => row.class === 'discard').discardReview]
];

function primitiveFailure(callback, sentinels = []) {
  let caught;
  try {
    callback();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect(caught).toMatchObject({
    name: 'PrivateProvenanceFailure',
    code: 'PRIVATE_BASELINE_INVALID',
    message: 'PRIVATE_BASELINE_INVALID'
  });
  expect(Object.hasOwn(caught, 'cause')).toBe(false);
  expect(Object.keys(caught).sort()).toEqual(['code', 'name']);
  const rendered = `${String(caught)} ${JSON.stringify(caught)}`;
  for (const sentinel of sentinels) expect(rendered).not.toContain(sentinel);
}

function moveFirstKeyToEnd(object) {
  const [first, ...rest] = Object.entries(object);
  for (const key of Object.keys(object)) Reflect.deleteProperty(object, key);
  for (const [key, value] of [...rest, first]) object[key] = value;
}

describe('private JSON primitives', () => {
  it('copies Buffer and Uint8Array input and parses strict UTF-8', () => {
    for (const input of [Buffer.from('{"a":1}'), new Uint8Array(Buffer.from('{"a":1}'))]) {
      const result = copyAndParsePrivateJson(input);
      expect(result.value).toEqual({ a: 1 });
      expect(result.text).toBe('{"a":1}');
      expect(result.raw).toEqual(Buffer.from('{"a":1}'));
      expect(result.raw).not.toBe(input);
      input[0] = 0x20;
      expect(result.raw[0]).toBe(0x7b);
    }
  });

  it('accepts exactly 2 MiB and rejects one byte more', () => {
    const exact = Buffer.concat([
      Buffer.from('"'),
      Buffer.alloc(2 * 1024 * 1024 - 2, 0x61),
      Buffer.from('"')
    ]);
    expect(copyAndParsePrivateJson(exact).raw.length).toBe(2 * 1024 * 1024);
    primitiveFailure(() => copyAndParsePrivateJson(Buffer.concat([exact, Buffer.from(' ')])));
  });

  it('rejects BOM, malformed UTF-8, malformed JSON, and non-byte values', () => {
    for (const value of [
      Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
      Buffer.from([0x22, 0xc3, 0x28, 0x22]),
      Buffer.from('{'),
      '{}',
      null
    ]) {
      primitiveFailure(() => copyAndParsePrivateJson(value));
    }
  });

  it('requires exact positional keys and scalar formats', () => {
    expect(() => requireExactKeys({ a: 1, b: 2 }, ['a', 'b'])).not.toThrow();
    for (const value of [{ b: 2, a: 1 }, { a: 1 }, { a: 1, b: 2, c: 3 }, [], null]) {
      primitiveFailure(() => requireExactKeys(value, ['a', 'b']));
    }
    expect(requireDigest('a'.repeat(64))).toBe('a'.repeat(64));
    for (const value of ['A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), 4, null]) {
      primitiveFailure(() => requireDigest(value));
    }
    expect(requireIdentity('reviewer_1@example.invalid')).toBe('reviewer_1@example.invalid');
    for (const value of ['', '-bad', 'space bad', 'a'.repeat(129), null]) {
      primitiveFailure(() => requireIdentity(value));
    }
    expect(requireBoundedInteger(0, 0, 3)).toBe(0);
    expect(requireBoundedInteger(3, 0, 3)).toBe(3);
    for (const value of [-1, 4, 1.5, Number.NaN, '1']) {
      primitiveFailure(() => requireBoundedInteger(value, 0, 3));
    }
  });

  it('writes two spaces plus one LF and recursively freezes', () => {
    expect(canonicalJsonBytes({ a: [1] })).toEqual(Buffer.from('{\n  "a": [\n    1\n  ]\n}\n'));
    primitiveFailure(() => canonicalJsonBytes({ value: 1n }));
    const frozen = deepFreeze({ a: [{ b: 1 }] });
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.a)).toBe(true);
    expect(Object.isFrozen(frozen.a[0])).toBe(true);
    expect(() => {
      frozen.a[0].b = 2;
    }).toThrow(TypeError);
  });

  it('never includes a rejected sentinel in its fixed error', () => {
    const sentinel = 'PRIVATE_SENTINEL_NEVER_RENDER';
    primitiveFailure(() => requireIdentity(sentinel), [sentinel]);
  });
});

describe('private baseline structural projection', () => {
  for (const [name, locate] of STRUCTURAL_LEVELS) {
    it(`rejects missing and unknown keys at ${name}`, () => {
      const missing = makePrivateBaseline();
      Reflect.deleteProperty(locate(missing), Object.keys(locate(missing))[0]);
      expectPrivateFailure(() => projectCanonicalBaselineShape(missing));

      const unknown = makePrivateBaseline();
      locate(unknown).unexpected = true;
      expectPrivateFailure(() => projectCanonicalBaselineShape(unknown));
    });

    it(`normalizes positional key order at ${name}`, () => {
      const original = makePrivateBaseline();
      const reordered = makePrivateBaseline();
      moveFirstKeyToEnd(locate(reordered));
      expect(canonicalFixtureBytes(projectCanonicalBaselineShape(reordered))).toEqual(
        canonicalFixtureBytes(original)
      );
    });
  }

  it('rejects wrong object and array containers', () => {
    expectPrivateFailure(() => projectCanonicalBaselineShape(null));
    expectPrivateFailure(() => projectCanonicalBaselineShape([]));
    for (const mutate of [
      (value) => {
        value.sourceEvidence = [];
      },
      (value) => {
        value.scanPolicy = null;
      },
      (value) => {
        value.scanPolicy.forbiddenBlobSha256 = {};
      },
      (value) => {
        value.scanPolicy.forbiddenReferences = {};
      },
      (value) => {
        value.baselineReview = [];
      },
      (value) => {
        value.assets = {};
      },
      (value) => {
        value.assets.find((row) => row.class === 'approved').sourceAuthorization = [];
      },
      (value) => {
        value.assets.find((row) => row.class === 'rewrite').scanReference = [];
      }
    ]) {
      const value = makePrivateBaseline();
      mutate(value);
      expectPrivateFailure(() => projectCanonicalBaselineShape(value));
    }
  });

  it('reconstructs fresh canonical and exact reduced composition objects', () => {
    const value = makePrivateBaseline();
    const canonical = projectCanonicalBaselineShape(value);
    expect(canonical).toEqual(value);
    expect(canonical).not.toBe(value);
    expect(canonical.sourceEvidence).not.toBe(value.sourceEvidence);
    expect(canonical.scanPolicy.forbiddenReferences[0]).not.toBe(
      value.scanPolicy.forbiddenReferences[0]
    );
    expect(canonical.assets[0]).not.toBe(value.assets[0]);

    const composition = projectCompositionShape(value);
    expect(composition).toEqual(fixtureCompositionShape(value));
    for (const row of composition) {
      expect(Object.keys(row)).toEqual([
        'destination',
        'class',
        'sourceAuthorization',
        'scanReference'
      ]);
      if (row.sourceAuthorization !== null) {
        expect(Object.keys(row.sourceAuthorization)).toEqual([
          'origin',
          'relativePath',
          'mappingRelationship',
          'contentSha256',
          'sizeBytes',
          'mode',
          'bundleRelationship'
        ]);
      }
      if (row.scanReference !== null) {
        expect(Object.keys(row.scanReference)).toEqual([
          'relativePath',
          'mappingRelationship',
          'contentSha256',
          'sizeBytes'
        ]);
      }
    }
  });

  it('restores exact inventory row order in both projections', () => {
    const original = makePrivateBaseline();
    const swapped = makePrivateBaseline();
    [swapped.assets[0], swapped.assets[1]] = [swapped.assets[1], swapped.assets[0]];
    const destinations = MIGRATION_INVENTORY.map((row) => row.destination);
    expect(projectCanonicalBaselineShape(swapped).assets.map((row) => row.destination)).toEqual(
      destinations
    );
    expect(projectCompositionShape(swapped).map((row) => row.destination)).toEqual(destinations);
    expect(canonicalFixtureBytes(projectCanonicalBaselineShape(swapped))).toEqual(
      canonicalFixtureBytes(original)
    );
  });

  it('rejects missing, duplicate, unknown, and class-mismatched rows', () => {
    const mutations = [
      (value) => value.assets.pop(),
      (value) => {
        value.assets[value.assets.length - 1] = structuredClone(value.assets[0]);
      },
      (value) => {
        value.assets[0].destination = 'synthetic/unknown-destination.txt';
      },
      (value) => {
        value.assets[0].class = 'rewrite';
      }
    ];
    for (const mutate of mutations) {
      const value = makePrivateBaseline();
      mutate(value);
      expectPrivateFailure(() => projectCanonicalBaselineShape(value));
      expectPrivateFailure(() => projectCompositionShape(value));
    }
  });
});
```

Complete content of `tests/provenance/private-baseline.test.mjs`:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  MIGRATION_CLASS_COUNTS,
  MIGRATION_INVENTORY,
  compareDestinations,
  isPortableDestination,
  portableCollisionKey
} from '../../scripts/provenance/inventory.mjs';
import * as baselineModule from '../../scripts/provenance/private-baseline.mjs';
import {
  bindFixtureComposition,
  canonicalFixtureBytes,
  digest as fixtureDigest,
  fixtureCompositionShape,
  fixtureInventorySha256,
  makePrivateBaseline,
  PUBLIC_CONTRACT
} from './fixtures/private-baseline-fixture.mjs';

const { canonicalPrivateBaseline, parsePrivateBaseline, privateCompositionProjection } =
  baselineModule;
const GOLDEN_INVENTORY_SHA256 = 'aba068a7ff2219ca574f8158a485524b08021a4f2a24ca8f4119bb1f7a667fde';

const STRUCTURAL_LEVELS = [
  ['top', (value) => value],
  ['sourceEvidence', (value) => value.sourceEvidence],
  ['scanPolicy', (value) => value.scanPolicy],
  ['forbiddenReference', (value) => value.scanPolicy.forbiddenReferences[0]],
  ['baselineReview', (value) => value.baselineReview],
  ['asset', (value) => value.assets.find((row) => row.class === 'approved')],
  [
    'sourceAuthorization',
    (value) => value.assets.find((row) => row.class === 'approved').sourceAuthorization
  ],
  ['scanReference', (value) => value.assets.find((row) => row.class === 'rewrite').scanReference],
  [
    'integrationReview',
    (value) => value.assets.find((row) => row.class === 'approved').integrationReview
  ],
  [
    'destinationReview',
    (value) => value.assets.find((row) => row.class === 'approved').destinationReview
  ],
  ['discardReview', (value) => value.assets.find((row) => row.class === 'discard').discardReview]
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseValue(value, contract = PUBLIC_CONTRACT) {
  return parsePrivateBaseline(canonicalFixtureBytes(value), contract);
}

function expectSanitizedFailure(callback, sentinels = []) {
  let caught;
  try {
    callback();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect(caught).toMatchObject({
    name: 'PrivateProvenanceFailure',
    code: 'PRIVATE_BASELINE_INVALID',
    message: 'PRIVATE_BASELINE_INVALID'
  });
  expect(Object.hasOwn(caught, 'cause')).toBe(false);
  expect(Object.keys(caught).sort()).toEqual(['code', 'name']);
  const rendered = `${String(caught)} ${JSON.stringify(caught)}`;
  for (const sentinel of sentinels) expect(rendered).not.toContain(sentinel);
}

function moveFirstKeyToEnd(object) {
  const [first, ...rest] = Object.entries(object);
  for (const key of Object.keys(object)) Reflect.deleteProperty(object, key);
  for (const [key, value] of [...rest, first]) object[key] = value;
}

function rawJsonWithDuplicateFirstKey(value, target) {
  function serialize(item, depth) {
    if (item === null || typeof item !== 'object') return JSON.stringify(item);
    const indent = '  '.repeat(depth);
    const childIndent = '  '.repeat(depth + 1);
    if (Array.isArray(item)) {
      if (item.length === 0) return '[]';
      return `[\n${item
        .map((child) => `${childIndent}${serialize(child, depth + 1)}`)
        .join(',\n')}\n${indent}]`;
    }
    let entries = Object.entries(item);
    if (item === target) entries = [entries[0], ...entries];
    if (entries.length === 0) return '{}';
    return `{\n${entries
      .map(([key, child]) => `${childIndent}${JSON.stringify(key)}: ${serialize(child, depth + 1)}`)
      .join(',\n')}\n${indent}}`;
  }
  return Buffer.from(`${serialize(value, 0)}\n`, 'utf8');
}

function inventoryDigestFromPrivateRows(value) {
  return sha256(
    canonicalFixtureBytes(
      value.assets.map(({ destination, class: assetClass }) => ({
        destination,
        class: assetClass
      }))
    )
  );
}

function approvedRow(value) {
  return value.assets.find((row) => row.class === 'approved');
}

function rewriteRow(value) {
  return value.assets.find((row) => row.class === 'rewrite');
}

function approveSource(row, reviewerId = 'source-reviewer') {
  row.sourceAuthorization.reviewerId = reviewerId;
  row.sourceAuthorization.reviewVerdict = 'approved-for-migration';
}

function integrate(row) {
  approveSource(row);
  row.integrationReview.verdict = 'copied-and-adapted';
  row.integrationReview.integratorId = 'integration-author';
  row.integrationReview.reviewerId = 'integration-reviewer';
}

function reviewDestination(row) {
  integrate(row);
  row.destinationReview.expectedContentSha256 = fixtureDigest('reviewed-destination');
  row.destinationReview.authorId = row.integrationReview.integratorId;
  row.destinationReview.reviewerId = 'destination-reviewer';
  row.destinationReview.verdict = 'approved-migrated';
}

function recursivelyExpectFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) recursivelyExpectFrozen(child, seen);
}

describe('private baseline facade and public authority', () => {
  it('exports exactly three functions and accepts only authoritative references', () => {
    expect(Object.keys(baselineModule)).toEqual([
      'canonicalPrivateBaseline',
      'parsePrivateBaseline',
      'privateCompositionProjection'
    ]);
    expect(PUBLIC_CONTRACT.inventory).toBe(MIGRATION_INVENTORY);
    expect(PUBLIC_CONTRACT.counts).toBe(MIGRATION_CLASS_COUNTS);
    expect(PUBLIC_CONTRACT.collisionKey).toBe(portableCollisionKey);
    expect(PUBLIC_CONTRACT.compare).toBe(compareDestinations);
    expect(PUBLIC_CONTRACT.isPortable).toBe(isPortableDestination);
    expect(Object.isFrozen(MIGRATION_INVENTORY)).toBe(true);
    expect(Object.isFrozen(MIGRATION_CLASS_COUNTS)).toBe(true);
    expect(() => parseValue(makePrivateBaseline(), { ...PUBLIC_CONTRACT })).not.toThrow();
  });

  it('rejects copied authority and never invokes replacement callbacks', () => {
    const value = makePrivateBaseline();
    for (const contract of [
      { ...PUBLIC_CONTRACT, inventory: [...MIGRATION_INVENTORY] },
      { ...PUBLIC_CONTRACT, counts: { ...MIGRATION_CLASS_COUNTS } }
    ]) {
      expectSanitizedFailure(() => parseValue(value, contract));
    }

    for (const key of ['collisionKey', 'compare', 'isPortable']) {
      let calls = 0;
      const sentinel = `PUBLIC_CALLBACK_${key}_SENTINEL`;
      const contract = {
        ...PUBLIC_CONTRACT,
        [key]: () => {
          calls += 1;
          throw new Error(sentinel);
        }
      };
      expectSanitizedFailure(() => parseValue(value, contract), [sentinel]);
      expect(calls).toBe(0);
    }
  });

  it('rejects accessor authority without invoking getters', () => {
    const value = makePrivateBaseline();
    for (const key of Object.keys(PUBLIC_CONTRACT)) {
      let calls = 0;
      const contract = { ...PUBLIC_CONTRACT };
      Object.defineProperty(contract, key, {
        enumerable: true,
        get() {
          calls += 1;
          return PUBLIC_CONTRACT[key];
        }
      });
      expectSanitizedFailure(() => parseValue(value, contract));
      expect(calls).toBe(0);
    }
  });

  it('rejects Proxy authority before invoking traps', () => {
    let calls = 0;
    const sentinel = 'PUBLIC_PROXY_TRAP_SENTINEL';
    const contract = new Proxy(
      { ...PUBLIC_CONTRACT },
      {
        ownKeys() {
          calls += 1;
          throw new Error(sentinel);
        }
      }
    );
    expectSanitizedFailure(() => parseValue(makePrivateBaseline(), contract), [sentinel]);
    expect(calls).toBe(0);
  });

  it('binds the exact public inventory hash and exact live rows', () => {
    const valid = makePrivateBaseline();
    expect(fixtureInventorySha256()).toBe(GOLDEN_INVENTORY_SHA256);
    expect(valid.inventorySha256).toBe(GOLDEN_INVENTORY_SHA256);
    expect(() => parseValue(valid)).not.toThrow();

    const wrongDigest = makePrivateBaseline();
    wrongDigest.inventorySha256 = `0${wrongDigest.inventorySha256.slice(1)}`;
    expectSanitizedFailure(() => parseValue(wrongDigest));

    const mutations = [
      (value) => {
        value.assets[0].destination = 'synthetic/unknown-destination.txt';
      },
      (value) => {
        value.assets[0].class = 'rewrite';
      },
      (value) => {
        const approvedIndex = value.assets.findIndex((row) => row.class === 'approved');
        const rewriteIndex = value.assets.findIndex((row) => row.class === 'rewrite');
        [value.assets[approvedIndex].class, value.assets[rewriteIndex].class] = [
          value.assets[rewriteIndex].class,
          value.assets[approvedIndex].class
        ];
      },
      (value) => {
        [value.assets[0], value.assets[1]] = [value.assets[1], value.assets[0]];
      }
    ];
    for (const mutate of mutations) {
      const value = makePrivateBaseline();
      mutate(value);
      value.inventorySha256 = inventoryDigestFromPrivateRows(value);
      bindFixtureComposition(value);
      expectSanitizedFailure(() => parseValue(value));
    }
  });
});

describe('canonical raw baseline bytes', () => {
  it('rejects every noncanonical encoding and malformed input', () => {
    const value = makePrivateBaseline();
    const canonical = canonicalFixtureBytes(value);
    const variants = [
      Buffer.from(JSON.stringify(value), 'utf8'),
      Buffer.from(`${JSON.stringify(value, null, '\t')}\n`, 'utf8'),
      Buffer.from(`${JSON.stringify(value, null, 4)}\n`, 'utf8'),
      canonical.subarray(0, canonical.length - 1),
      Buffer.concat([canonical, Buffer.from('\n')]),
      Buffer.from(canonical.toString('utf8').replaceAll('\n', '\r\n'), 'utf8'),
      Buffer.concat([Buffer.from(' '), canonical]),
      Buffer.concat([canonical, Buffer.from(' ')]),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), canonical]),
      Buffer.from([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
      Buffer.from('{"schemaVersion":1,', 'utf8')
    ];
    for (const bytes of variants)
      expectSanitizedFailure(() => parsePrivateBaseline(bytes, PUBLIC_CONTRACT));
  });

  for (const [name, locate] of STRUCTURAL_LEVELS) {
    it(`rejects duplicate raw members at ${name}`, () => {
      const value = makePrivateBaseline();
      const raw = rawJsonWithDuplicateFirstKey(value, locate(value));
      expect(canonicalPrivateBaseline(JSON.parse(raw.toString('utf8')))).toEqual(
        canonicalFixtureBytes(value)
      );
      expectSanitizedFailure(() => parsePrivateBaseline(raw, PUBLIC_CONTRACT));
    });

    it(`rejects raw positional key permutations at ${name}`, () => {
      const value = makePrivateBaseline();
      const canonical = canonicalFixtureBytes(value);
      moveFirstKeyToEnd(locate(value));
      expect(canonicalPrivateBaseline(value)).toEqual(canonical);
      expectSanitizedFailure(() =>
        parsePrivateBaseline(canonicalFixtureBytes(value), PUBLIC_CONTRACT)
      );
    });
  }

  it('rejects swapped raw rows while both projectors restore inventory order', () => {
    const value = makePrivateBaseline();
    const original = makePrivateBaseline();
    [value.assets[0], value.assets[1]] = [value.assets[1], value.assets[0]];
    expect(canonicalPrivateBaseline(value)).toEqual(canonicalFixtureBytes(original));
    expect(privateCompositionProjection(value)).toEqual(
      canonicalFixtureBytes(fixtureCompositionShape(original))
    );
    expectSanitizedFailure(() =>
      parsePrivateBaseline(canonicalFixtureBytes(value), PUBLIC_CONTRACT)
    );
  });
});

describe('private composition binding', () => {
  it('matches the independent projection and includes every semantically variable byte field', () => {
    const base = makePrivateBaseline();
    const baseProjection = privateCompositionProjection(base);
    expect(baseProjection).toEqual(canonicalFixtureBytes(fixtureCompositionShape(base)));

    const cases = [
      (value) => {
        approvedRow(value).sourceAuthorization.contentSha256 = fixtureDigest('included-content');
      },
      (value) => {
        approvedRow(value).sourceAuthorization.sizeBytes += 1;
      },
      (value) => {
        approvedRow(value).sourceAuthorization.mode = '100755';
      },
      (value) => {
        const source = approvedRow(value).sourceAuthorization;
        source.origin = 'overlay';
        source.bundleRelationship = 'absent';
      },
      (value) => {
        const source = approvedRow(value).sourceAuthorization;
        source.relativePath = 'synthetic/renamed-approved-source.txt';
        source.mappingRelationship = 'renamed';
        source.mappingRationaleSha256 = fixtureDigest('mapping-rationale');
      },
      (value) => {
        rewriteRow(value).scanReference.contentSha256 = fixtureDigest('included-scan-content');
      },
      (value) => {
        rewriteRow(value).scanReference.sizeBytes += 1;
      },
      (value) => {
        const reference = rewriteRow(value).scanReference;
        reference.relativePath = 'synthetic/renamed-rewrite-reference.txt';
        reference.mappingRelationship = 'renamed';
        reference.mappingRationaleSha256 = fixtureDigest('scan-mapping-rationale');
      }
    ];

    for (const mutate of cases) {
      const value = makePrivateBaseline();
      mutate(value);
      bindFixtureComposition(value);
      const projection = privateCompositionProjection(value);
      expect(projection).toEqual(canonicalFixtureBytes(fixtureCompositionShape(value)));
      expect(projection).not.toEqual(baseProjection);
      expect(sha256(projection)).not.toBe(sha256(baseProjection));
      expect(() => parseValue(value)).not.toThrow();
    }
  });

  it('excludes rationale, identity, review, policy, and non-composition evidence', () => {
    const pairs = [
      () => {
        const left = makePrivateBaseline();
        const right = makePrivateBaseline();
        for (const [value, label] of [
          [left, 'left-mapping-rationale'],
          [right, 'right-mapping-rationale']
        ]) {
          const source = approvedRow(value).sourceAuthorization;
          source.relativePath = 'synthetic/pending-renamed-source.txt';
          source.mappingRelationship = 'renamed';
          source.mappingRationaleSha256 = fixtureDigest(label);
        }
        return [left, right];
      },
      () => {
        const left = makePrivateBaseline();
        const right = makePrivateBaseline();
        for (const [value, label] of [
          [left, 'left-supersession'],
          [right, 'right-supersession']
        ]) {
          const row = approvedRow(value);
          row.sourceAuthorization.origin = 'overlay';
          row.sourceAuthorization.bundleRelationship = 'supersedes';
          row.sourceAuthorization.supersessionRationaleSha256 = fixtureDigest(label);
          approveSource(row);
        }
        return [left, right];
      },
      () => {
        const left = makePrivateBaseline();
        const right = makePrivateBaseline();
        approveSource(approvedRow(right));
        return [left, right];
      },
      () => {
        const left = makePrivateBaseline();
        const right = makePrivateBaseline();
        approveSource(approvedRow(left));
        integrate(approvedRow(right));
        return [left, right];
      },
      () => {
        const left = makePrivateBaseline();
        const right = makePrivateBaseline();
        integrate(approvedRow(left));
        reviewDestination(approvedRow(right));
        return [left, right];
      },
      () => {
        const left = makePrivateBaseline();
        const right = makePrivateBaseline();
        right.baselineReview = {
          reviewerId: 'snapshot-independent-reviewer',
          verdict: 'reviewed-snapshot'
        };
        return [left, right];
      },
      () => {
        const left = makePrivateBaseline();
        const right = makePrivateBaseline();
        right.scanPolicy.forbiddenBlobSha256 = [fixtureDigest('forbidden-blob')];
        right.scanPolicy.forbiddenReferences = [
          {
            category: 'legacy-reference',
            utf8Base64: Buffer.from('different synthetic legacy reference').toString('base64')
          }
        ];
        return [left, right];
      },
      () => {
        const left = makePrivateBaseline();
        const right = makePrivateBaseline();
        right.sourceEvidence.bundleSha256 = fixtureDigest('different-bundle');
        return [left, right];
      }
    ];

    for (const makePair of pairs) {
      const [left, right] = makePair();
      bindFixtureComposition(left);
      bindFixtureComposition(right);
      const leftProjection = privateCompositionProjection(left);
      const rightProjection = privateCompositionProjection(right);
      expect(leftProjection).toEqual(rightProjection);
      expect(() => parseValue(left)).not.toThrow();
      expect(() => parseValue(right)).not.toThrow();
    }

    const shape = JSON.parse(privateCompositionProjection(makePrivateBaseline()).toString('utf8'));
    for (const row of shape) {
      expect(Object.keys(row)).toEqual([
        'destination',
        'class',
        'sourceAuthorization',
        'scanReference'
      ]);
    }
  });

  it('rejects destination/class structural changes and a one-nibble composition mismatch', () => {
    for (const mutate of [
      (value) => {
        value.assets[0].destination = 'synthetic/not-authoritative.txt';
      },
      (value) => {
        value.assets[0].class = 'rewrite';
      }
    ]) {
      const value = makePrivateBaseline();
      mutate(value);
      expectSanitizedFailure(() => privateCompositionProjection(value));
    }
    const value = makePrivateBaseline();
    const digest = value.sourceEvidence.compositionSha256;
    value.sourceEvidence.compositionSha256 = `${digest[0] === '0' ? '1' : '0'}${digest.slice(1)}`;
    expectSanitizedFailure(() => parseValue(value));
  });
});

describe('deep freeze, purity, and redaction', () => {
  it('deep-freezes a fresh parsed graph and returns fresh buffers', () => {
    const value = makePrivateBaseline();
    const bytes = canonicalFixtureBytes(value);
    const parsed = parsePrivateBaseline(bytes, PUBLIC_CONTRACT);
    recursivelyExpectFrozen(parsed);
    expect(() => {
      parsed.schemaVersion = 2;
    }).toThrow(TypeError);
    expect(() => {
      parsed.sourceEvidence.bundleSha256 = fixtureDigest('mutation');
    }).toThrow(TypeError);
    expect(() => parsed.assets.pop()).toThrow(TypeError);
    bytes.fill(0x20);
    expect(parsed.schemaVersion).toBe(1);

    const canonicalA = canonicalPrivateBaseline(value);
    const canonicalB = canonicalPrivateBaseline(value);
    const compositionA = privateCompositionProjection(value);
    const compositionB = privateCompositionProjection(value);
    expect(canonicalA).toEqual(canonicalB);
    expect(canonicalA).not.toBe(canonicalB);
    expect(compositionA).toEqual(compositionB);
    expect(compositionA).not.toBe(compositionB);
  });

  it('has a source-bounded pure implementation and does not mutate process state', async () => {
    const expectedGraph = {
      'inventory.mjs': [],
      'groups.mjs': ['./inventory.mjs'],
      'private-error.mjs': [],
      'private-json.mjs': ['./private-error.mjs'],
      'private-baseline-shape.mjs': ['./inventory.mjs', './private-error.mjs'],
      'private-baseline-values.mjs': [
        './inventory.mjs',
        'node:util',
        './private-json.mjs',
        './private-error.mjs'
      ],
      'private-baseline-assets.mjs': [
        './groups.mjs',
        './inventory.mjs',
        './private-error.mjs',
        './private-json.mjs',
        './private-baseline-values.mjs'
      ],
      'private-baseline.mjs': [
        'node:crypto',
        './private-baseline-assets.mjs',
        './private-baseline-shape.mjs',
        './private-baseline-values.mjs',
        './private-json.mjs',
        './private-error.mjs'
      ]
    };
    for (const [name, expectedSpecifiers] of Object.entries(expectedGraph)) {
      const source = await readFile(
        new URL(`../../scripts/provenance/${name}`, import.meta.url),
        'utf8'
      );
      const specifiers = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/gu)].map(
        (match) => match[1]
      );
      expect(source).not.toMatch(/\bimport\s*\(/u);
      expect(source).not.toMatch(/\brequire\b/u);
      expect(specifiers.toSorted()).toEqual(expectedSpecifiers.toSorted());
      expect(source).not.toMatch(
        /\b(?:process|globalThis|Date|performance|fetch|WebSocket|XMLHttpRequest|Deno|Bun)\b/u
      );
    }

    const visited = new Set();
    function visit(name) {
      if (visited.has(name)) return;
      visited.add(name);
      for (const specifier of expectedGraph[name]) {
        if (!specifier.startsWith('./')) continue;
        const child = specifier.slice(2);
        expect(Object.hasOwn(expectedGraph, child)).toBe(true);
        visit(child);
      }
    }
    visit('private-baseline.mjs');
    expect([...visited].toSorted()).toEqual(Object.keys(expectedGraph).toSorted());

    const environmentBefore = { ...process.env };
    const cwdBefore = process.cwd();
    const value = makePrivateBaseline();
    const before = canonicalFixtureBytes(value);
    canonicalPrivateBaseline(value);
    privateCompositionProjection(value);
    parseValue(value);
    expect(canonicalFixtureBytes(value)).toEqual(before);
    expect(process.env).toEqual(environmentBefore);
    expect(process.cwd()).toBe(cwdBefore);
  });

  it('redacts every rejected private sentinel and callback error', () => {
    const cases = [
      () => {
        const sentinel = 'AUTHOR_SENTINEL_VALID_ID';
        const value = makePrivateBaseline();
        const row = approvedRow(value);
        row.sourceAuthorization.authorId = sentinel;
        approveSource(row, sentinel);
        return { sentinel, run: () => parseValue(value) };
      },
      () => {
        const sentinel = 'PATH:SENTINEL';
        const value = makePrivateBaseline();
        const source = approvedRow(value).sourceAuthorization;
        source.relativePath = sentinel;
        source.mappingRelationship = 'renamed';
        source.mappingRationaleSha256 = fixtureDigest('path-rationale');
        bindFixtureComposition(value);
        return { sentinel, run: () => parseValue(value) };
      },
      () => {
        const sentinel = 'DIGEST_SENTINEL_NOT_HEX';
        const value = makePrivateBaseline();
        approvedRow(value).sourceAuthorization.contentSha256 = sentinel;
        bindFixtureComposition(value);
        return { sentinel, run: () => parseValue(value) };
      },
      () => {
        const sentinel = 'MALFORMED_JSON_FRAGMENT_SENTINEL';
        return {
          sentinel,
          run: () => parsePrivateBaseline(Buffer.from(`{"${sentinel}":`, 'utf8'), PUBLIC_CONTRACT)
        };
      },
      () => {
        const sentinel = 'DECODED_REFERENCE_SENTINEL';
        const value = makePrivateBaseline();
        value.scanPolicy.forbiddenReferences = [
          {
            category: 'private-identifier',
            utf8Base64: Buffer.from(sentinel).toString('base64')
          }
        ];
        return { sentinel, run: () => parseValue(value) };
      },
      () => {
        const sentinel = 'CALLBACK_ERROR_SENTINEL';
        const value = makePrivateBaseline();
        const contract = {
          ...PUBLIC_CONTRACT,
          isPortable: () => {
            throw new Error(sentinel);
          }
        };
        return { sentinel, run: () => parseValue(value, contract) };
      }
    ];

    for (const makeCase of cases) {
      const { sentinel, run } = makeCase();
      expectSanitizedFailure(run, [sentinel]);
    }
  });
});
```

## Appendix E: Complete Asset-State Test

Complete content of `tests/provenance/private-baseline-assets.test.mjs`:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { projectCanonicalBaselineShape } from '../../scripts/provenance/private-baseline-shape.mjs';
import { validatePrivateAssets } from '../../scripts/provenance/private-baseline-assets.mjs';
import { EXPECTED_MIGRATION_GROUP_PAIRS } from './fixtures/expected-migration-groups.mjs';
import {
  PUBLIC_CONTRACT,
  cloneFixture,
  digest,
  expectPrivateFailure,
  makePrivateBaseline
} from './fixtures/private-baseline-fixture.mjs';

const MAX_ASSET_BYTES = 67_108_864;
const MAX_AGGREGATE_BYTES = 536_870_912;
const LOWERCASE_DIGEST = digest('asset-matrix-rationale');
const SNAPSHOT_REVIEWER = 'snapshot-reviewer';
const SOURCE_REVIEWER = 'source-reviewer';
const INTEGRATOR = 'migration-integrator';
const INTEGRATION_REVIEWER = 'integration-reviewer';
const DESTINATION_REVIEWER = 'destination-reviewer';
const REWRITE_AUTHOR = 'rewrite-author';
const REWRITE_REVIEWER = 'rewrite-reviewer';
const GROUP_NAMES = [
  'installer-plugin',
  'recent-docs',
  'vm-onboarding',
  'agentic',
  'security-backup',
  'other-tests'
];
const EXPECTED_GROUP_BY_DESTINATION = new Map(EXPECTED_MIGRATION_GROUP_PAIRS);

function assetsOf(value, assetClass) {
  return value.assets.filter((row) => row.class === assetClass);
}

function rowOf(value, assetClass, occurrence = 0) {
  const row = assetsOf(value, assetClass)[occurrence];
  if (row === undefined) throw new Error(`Missing ${assetClass} fixture row`);
  return row;
}

function referenceOf(row) {
  return row.sourceAuthorization ?? row.scanReference;
}

function validateAssets(value) {
  return validatePrivateAssets(value.assets, {
    publicContract: PUBLIC_CONTRACT,
    baselineReview: value.baselineReview
  });
}

function validateCanonicalAssets(value) {
  const projected = projectCanonicalBaselineShape(value);
  return validatePrivateAssets(projected.assets, {
    publicContract: PUBLIC_CONTRACT,
    baselineReview: projected.baselineReview
  });
}

function setSnapshotReview(value, reviewed, reviewerId = SNAPSHOT_REVIEWER) {
  value.baselineReview = reviewed
    ? { reviewerId, verdict: 'reviewed-snapshot' }
    : { reviewerId: null, verdict: 'pending' };
}

function setSourceReview(row, approved, reviewerId = SOURCE_REVIEWER) {
  row.sourceAuthorization.reviewVerdict = approved
    ? 'approved-for-migration'
    : 'pending-source-review';
  row.sourceAuthorization.reviewerId = approved ? reviewerId : null;
}

function setIntegration(
  row,
  integrated,
  integratorId = INTEGRATOR,
  reviewerId = INTEGRATION_REVIEWER
) {
  row.integrationReview = integrated
    ? {
        group: row.integrationReview.group,
        verdict: 'copied-and-adapted',
        integratorId,
        reviewerId
      }
    : {
        group: row.integrationReview.group,
        verdict: 'pending',
        integratorId: null,
        reviewerId: null
      };
}

function setApprovedDestinationReview(
  row,
  reviewed,
  authorId = row.integrationReview.integratorId ?? INTEGRATOR,
  reviewerId = DESTINATION_REVIEWER
) {
  row.destinationReview = reviewed
    ? {
        expectedContentSha256: digest(`approved-destination-${row.destination}`),
        authorId,
        reviewerId,
        verdict: 'approved-migrated'
      }
    : {
        expectedContentSha256: null,
        authorId: null,
        reviewerId: null,
        verdict: 'pending'
      };
}

function setRewriteDestinationReview(
  row,
  reviewed,
  authorId = REWRITE_AUTHOR,
  reviewerId = REWRITE_REVIEWER
) {
  row.destinationReview = reviewed
    ? {
        expectedContentSha256: digest(`rewrite-destination-${row.destination}`),
        authorId,
        reviewerId,
        verdict: 'independently-rewritten'
      }
    : {
        expectedContentSha256: null,
        authorId: null,
        reviewerId: null,
        verdict: 'pending'
      };
}

function setAllReferenceSizes(value, sizeBytes) {
  for (const row of value.assets) referenceOf(row).sizeBytes = sizeBytes;
}

function makeRenamed(reference, label) {
  reference.relativePath = `private/${label}.txt`;
  reference.mappingRelationship = 'renamed';
  reference.mappingRationaleSha256 = null;
}

describe('private baseline asset contract', () => {
  it('accepts the complete pending fixture and returns the original array', () => {
    const value = makePrivateBaseline();
    expect(validateAssets(value)).toBe(value.assets);
  });

  it('rejects missing, extra, non-object, reordered, destination-mismatched, and class-mismatched rows', () => {
    for (const change of [
      (value) => {
        value.assets.pop();
      },
      (value) => {
        value.assets.push(cloneFixture(value.assets.at(-1)));
      },
      (value) => {
        value.assets[0] = null;
      },
      (value) => {
        [value.assets[0], value.assets[1]] = [value.assets[1], value.assets[0]];
      },
      (value) => {
        value.assets[0].destination = 'private/not-the-public-destination.txt';
      },
      (value) => {
        value.assets[0].class = 'rewrite';
      }
    ]) {
      const value = makePrivateBaseline();
      change(value);
      expectPrivateFailure(() => validateAssets(value));
    }
  });

  it('rejects every wrong class-specific slot nullability', () => {
    const cases = [
      (value) => {
        rowOf(value, 'approved').sourceAuthorization = null;
      },
      (value) => {
        rowOf(value, 'approved').scanReference = cloneFixture(
          rowOf(value, 'rewrite').scanReference
        );
      },
      (value) => {
        rowOf(value, 'approved').integrationReview = null;
      },
      (value) => {
        rowOf(value, 'approved').destinationReview = null;
      },
      (value) => {
        rowOf(value, 'approved').discardReview = { verdict: 'discarded' };
      },
      (value) => {
        rowOf(value, 'rewrite').sourceAuthorization = cloneFixture(
          rowOf(value, 'approved').sourceAuthorization
        );
      },
      (value) => {
        rowOf(value, 'rewrite').scanReference = null;
      },
      (value) => {
        rowOf(value, 'rewrite').integrationReview = cloneFixture(
          rowOf(value, 'approved').integrationReview
        );
      },
      (value) => {
        rowOf(value, 'rewrite').destinationReview = null;
      },
      (value) => {
        rowOf(value, 'rewrite').discardReview = { verdict: 'discarded' };
      },
      (value) => {
        rowOf(value, 'discard').sourceAuthorization = cloneFixture(
          rowOf(value, 'approved').sourceAuthorization
        );
      },
      (value) => {
        rowOf(value, 'discard').scanReference = null;
      },
      (value) => {
        rowOf(value, 'discard').integrationReview = cloneFixture(
          rowOf(value, 'approved').integrationReview
        );
      },
      (value) => {
        rowOf(value, 'discard').destinationReview = {
          expectedContentSha256: null,
          authorId: null,
          reviewerId: null,
          verdict: 'pending'
        };
      },
      (value) => {
        rowOf(value, 'discard').discardReview = null;
      },
      (value) => {
        rowOf(value, 'discard').discardReview = { verdict: 'pending' };
      }
    ];

    for (const change of cases) {
      const value = makePrivateBaseline();
      change(value);
      expectPrivateFailure(() => validateAssets(value));
    }
  });

  it('uses structural projection to reject extra discard and scan-reference fields', () => {
    for (const assetClass of ['rewrite', 'discard']) {
      for (const change of [
        (row) => {
          delete row.scanReference.contentSha256;
        },
        (row) => {
          row.scanReference.unexpected = true;
        }
      ]) {
        const value = makePrivateBaseline();
        change(rowOf(value, assetClass));
        expectPrivateFailure(() => validateCanonicalAssets(value));
      }
    }

    const value = makePrivateBaseline();
    rowOf(value, 'discard').discardReview.unexpected = true;
    expectPrivateFailure(() => validateCanonicalAssets(value));
  });

  it('rejects nonportable paths and unpaired UTF-16 surrogates for every asset class', () => {
    const invalidPaths = [
      '',
      '/absolute',
      'C:/drive',
      '//server/share',
      'dir\\file',
      'dir//file',
      'dir/',
      './file',
      'dir/../file',
      'dir/.git/file',
      'dir/.GIT/file',
      'dir/NUL.txt',
      'dir/COM1',
      'dir/COM¹.txt',
      'dir/LPT³',
      'dir/name.',
      'dir/name ',
      'dir/na:me',
      'dir/na*me',
      `dir/nu${String.fromCharCode(0)}ll`,
      'dir/e\u0301.txt',
      `dir/${String.fromCharCode(0xd800)}.txt`,
      `dir/${String.fromCharCode(0xdc00)}.txt`
    ];

    for (const assetClass of ['approved', 'rewrite', 'discard']) {
      for (const relativePath of invalidPaths) {
        const value = makePrivateBaseline();
        const row = rowOf(value, assetClass);
        const reference = referenceOf(row);
        reference.relativePath = relativePath;
        reference.mappingRelationship = 'renamed';
        reference.mappingRationaleSha256 = null;
        expectPrivateFailure(
          () => validateAssets(value),
          relativePath.length === 0 ? [] : [relativePath]
        );
      }
    }
  });

  it('accepts NFC paths composed entirely of Unicode scalar values', () => {
    for (const assetClass of ['approved', 'rewrite', 'discard']) {
      const value = makePrivateBaseline();
      const reference = referenceOf(rowOf(value, assetClass));
      reference.relativePath = `private/${String.fromCodePoint(0x1f600)}-É-${assetClass}.txt`;
      reference.mappingRelationship = 'renamed';
      reference.mappingRationaleSha256 = null;
      expect(() => validateAssets(value)).not.toThrow();
    }
  });

  it('requires exact path equality for same-path mappings', () => {
    const value = makePrivateBaseline();
    const row = rowOf(value, 'approved');
    row.sourceAuthorization.relativePath = row.destination.toUpperCase();
    row.sourceAuthorization.mappingRelationship = 'same-path';
    row.sourceAuthorization.mappingRationaleSha256 = null;
    expectPrivateFailure(() => validateAssets(value));
  });

  it('rejects duplicate and Unicode case-fold collisions across source and scan paths', () => {
    {
      const value = makePrivateBaseline();
      const approved = rowOf(value, 'approved');
      const rewrite = rowOf(value, 'rewrite');
      makeRenamed(approved.sourceAuthorization, 'shared-reference');
      makeRenamed(rewrite.scanReference, 'shared-reference');
      expectPrivateFailure(() => validateAssets(value));
    }

    {
      const value = makePrivateBaseline();
      const [first, second] = assetsOf(value, 'approved');
      first.sourceAuthorization.relativePath = 'private/straße.txt';
      first.sourceAuthorization.mappingRelationship = 'renamed';
      first.sourceAuthorization.mappingRationaleSha256 = null;
      second.sourceAuthorization.relativePath = 'PRIVATE/STRASSE.TXT';
      second.sourceAuthorization.mappingRelationship = 'renamed';
      second.sourceAuthorization.mappingRationaleSha256 = null;
      expectPrivateFailure(() => validateAssets(value));
    }
  });

  it('enforces per-row size bounds for approved, rewrite, and discard references', () => {
    for (const assetClass of ['approved', 'rewrite', 'discard']) {
      for (const sizeBytes of [0, MAX_ASSET_BYTES]) {
        const value = makePrivateBaseline();
        referenceOf(rowOf(value, assetClass)).sizeBytes = sizeBytes;
        expect(() => validateAssets(value)).not.toThrow();
      }

      for (const sizeBytes of [-1, MAX_ASSET_BYTES + 1, 1.5, '1']) {
        const value = makePrivateBaseline();
        referenceOf(rowOf(value, assetClass)).sizeBytes = sizeBytes;
        expectPrivateFailure(() => validateAssets(value));
      }
    }
  });

  it('enforces exact source modes', () => {
    for (const mode of ['100644', '100755']) {
      const value = makePrivateBaseline();
      rowOf(value, 'approved').sourceAuthorization.mode = mode;
      expect(() => validateAssets(value)).not.toThrow();
    }

    for (const mode of ['100600', '100664', '100755 ', '', 100644, null]) {
      const value = makePrivateBaseline();
      rowOf(value, 'approved').sourceAuthorization.mode = mode;
      expectPrivateFailure(() => validateAssets(value));
    }
  });

  it('enforces lowercase content digests for all three classes', () => {
    for (const assetClass of ['approved', 'rewrite', 'discard']) {
      for (const contentSha256 of [
        'A'.repeat(64),
        'g'.repeat(64),
        'a'.repeat(63),
        'a'.repeat(65),
        null
      ]) {
        const value = makePrivateBaseline();
        referenceOf(rowOf(value, assetClass)).contentSha256 = contentSha256;
        expectPrivateFailure(() => validateAssets(value));
      }
    }
  });

  it('accepts exactly 512 MiB aggregate and rejects one byte more', () => {
    {
      const value = makePrivateBaseline();
      setAllReferenceSizes(value, 0);
      for (const row of value.assets.slice(0, 8)) {
        referenceOf(row).sizeBytes = MAX_ASSET_BYTES;
      }
      expect(value.assets.reduce((total, row) => total + referenceOf(row).sizeBytes, 0)).toBe(
        MAX_AGGREGATE_BYTES
      );
      expect(() => validateAssets(value)).not.toThrow();
    }

    {
      const value = makePrivateBaseline();
      setAllReferenceSizes(value, 0);
      for (const row of value.assets.slice(0, 8)) {
        referenceOf(row).sizeBytes = MAX_ASSET_BYTES;
      }
      referenceOf(value.assets[8]).sizeBytes = 1;
      expect(value.assets.reduce((total, row) => total + referenceOf(row).sizeBytes, 0)).toBe(
        MAX_AGGREGATE_BYTES + 1
      );
      expectPrivateFailure(() => validateAssets(value));
    }
  });

  it('exhausts the origin, bundle relationship, source review, reviewer, rationale, and snapshot product', () => {
    const reviewerCases = [
      { name: 'null', value: null },
      { name: 'independent', value: SOURCE_REVIEWER },
      { name: 'author', value: 'matrix-source-author' }
    ];
    let total = 0;
    let valid = 0;

    for (const origin of ['bundle', 'overlay']) {
      for (const bundleRelationship of ['selected', 'absent', 'supersedes']) {
        for (const sourceVerdict of ['pending-source-review', 'approved-for-migration']) {
          for (const reviewerCase of reviewerCases) {
            for (const supersessionRationaleSha256 of [null, LOWERCASE_DIGEST]) {
              for (const snapshotReviewed of [false, true]) {
                total += 1;
                const value = makePrivateBaseline();
                const source = rowOf(value, 'approved').sourceAuthorization;
                source.origin = origin;
                source.bundleRelationship = bundleRelationship;
                source.reviewVerdict = sourceVerdict;
                source.authorId = 'matrix-source-author';
                source.reviewerId = reviewerCase.value;
                source.supersessionRationaleSha256 = supersessionRationaleSha256;
                setSnapshotReview(value, snapshotReviewed);

                const relationshipValid =
                  (origin === 'bundle' && bundleRelationship === 'selected') ||
                  (origin === 'overlay' && ['absent', 'supersedes'].includes(bundleRelationship));
                const reviewerValid =
                  (sourceVerdict === 'pending-source-review' && reviewerCase.value === null) ||
                  (sourceVerdict === 'approved-for-migration' &&
                    reviewerCase.value === SOURCE_REVIEWER &&
                    reviewerCase.value !== source.authorId);
                const supersessionValid =
                  bundleRelationship !== 'supersedes'
                    ? supersessionRationaleSha256 === null
                    : sourceVerdict === 'approved-for-migration' || snapshotReviewed
                      ? supersessionRationaleSha256 === LOWERCASE_DIGEST
                      : supersessionRationaleSha256 === null;
                const expectedValid = relationshipValid && reviewerValid && supersessionValid;

                if (expectedValid) {
                  valid += 1;
                  expect(() => validateAssets(value)).not.toThrow();
                } else {
                  expectPrivateFailure(() => validateAssets(value));
                }
              }
            }
          }
        }
      }
    }

    expect(total).toBe(144);
    expect(valid).toBe(12);
  });

  it('rejects unknown source authorization enum literals', () => {
    for (const [field, value] of [
      ['origin', 'unknown-origin'],
      ['bundleRelationship', 'unknown-relationship'],
      ['reviewVerdict', 'unknown-verdict']
    ]) {
      const baseline = makePrivateBaseline();
      rowOf(baseline, 'approved').sourceAuthorization[field] = value;
      expectPrivateFailure(() => validateAssets(baseline));
    }
  });

  it('rejects malformed source identities and bundle rationale evidence', () => {
    const changes = [
      (source) => {
        source.authorId = '-invalid';
      },
      (source) => {
        source.reviewVerdict = 'approved-for-migration';
        source.reviewerId = '-invalid';
      },
      (source) => {
        source.reviewVerdict = 'approved-for-migration';
        source.reviewerId = source.authorId;
      },
      (source) => {
        source.bundleRelationship = 'selected';
        source.supersessionRationaleSha256 = LOWERCASE_DIGEST;
      },
      (source) => {
        source.origin = 'overlay';
        source.bundleRelationship = 'absent';
        source.supersessionRationaleSha256 = LOWERCASE_DIGEST;
      }
    ];

    for (const change of changes) {
      const value = makePrivateBaseline();
      change(rowOf(value, 'approved').sourceAuthorization);
      expectPrivateFailure(() => validateAssets(value));
    }
  });

  it('exhausts same-path and renamed approved mapping states', () => {
    let total = 0;
    let valid = 0;

    for (const relationship of ['same-path', 'renamed']) {
      for (const sameRelativePath of [false, true]) {
        for (const rationale of [null, LOWERCASE_DIGEST]) {
          for (const sourceApproved of [false, true]) {
            for (const snapshotReviewed of [false, true]) {
              total += 1;
              const value = makePrivateBaseline();
              const row = rowOf(value, 'approved');
              const source = row.sourceAuthorization;
              source.mappingRelationship = relationship;
              source.relativePath = sameRelativePath
                ? row.destination
                : 'private/approved-renamed-source.txt';
              source.mappingRationaleSha256 = rationale;
              setSourceReview(row, sourceApproved);
              setSnapshotReview(value, snapshotReviewed);

              const terminal = sourceApproved || snapshotReviewed;
              const expectedValid =
                relationship === 'same-path'
                  ? sameRelativePath && rationale === null
                  : !sameRelativePath && (!terminal || rationale === LOWERCASE_DIGEST);

              if (expectedValid) {
                valid += 1;
                expect(() => validateAssets(value)).not.toThrow();
              } else {
                expectPrivateFailure(() => validateAssets(value));
              }
            }
          }
        }
      }
    }

    expect(total).toBe(32);
    expect(valid).toBe(9);
  });

  it('exhausts same-path and renamed rewrite/discard scan mappings', () => {
    for (const assetClass of ['rewrite', 'discard']) {
      let total = 0;
      let valid = 0;

      for (const relationship of ['same-path', 'renamed']) {
        for (const sameRelativePath of [false, true]) {
          for (const rationale of [null, LOWERCASE_DIGEST]) {
            for (const snapshotReviewed of [false, true]) {
              total += 1;
              const value = makePrivateBaseline();
              const row = rowOf(value, assetClass);
              row.scanReference.mappingRelationship = relationship;
              row.scanReference.relativePath = sameRelativePath
                ? row.destination
                : `private/${assetClass}-renamed-reference.txt`;
              row.scanReference.mappingRationaleSha256 = rationale;
              setSnapshotReview(value, snapshotReviewed);

              const expectedValid =
                relationship === 'same-path'
                  ? sameRelativePath && rationale === null
                  : !sameRelativePath && (!snapshotReviewed || rationale === LOWERCASE_DIGEST);

              if (expectedValid) {
                valid += 1;
                expect(() => validateAssets(value)).not.toThrow();
              } else {
                expectPrivateFailure(() => validateAssets(value));
              }
            }
          }
        }
      }

      expect(total).toBe(16);
      expect(valid).toBe(5);
    }
  });

  it('rejects unknown mapping relationships', () => {
    for (const assetClass of ['approved', 'rewrite', 'discard']) {
      const value = makePrivateBaseline();
      referenceOf(rowOf(value, assetClass)).mappingRelationship = 'similar-path';
      expectPrivateFailure(() => validateAssets(value));
    }
  });

  it('locks every approved row to the independent exact public group', () => {
    expect(EXPECTED_GROUP_BY_DESTINATION.size).toBe(105);

    const positive = makePrivateBaseline();
    for (const row of assetsOf(positive, 'approved')) {
      row.integrationReview.group = EXPECTED_GROUP_BY_DESTINATION.get(row.destination);
    }
    expect(() => validateAssets(positive)).not.toThrow();

    let checked = 0;
    for (const [destination, expectedGroup] of EXPECTED_MIGRATION_GROUP_PAIRS) {
      for (const integrated of [false, true]) {
        const value = makePrivateBaseline();
        const row = value.assets.find((candidate) => candidate.destination === destination);
        if (row === undefined || row.class !== 'approved') {
          throw new Error('Invalid independent group fixture');
        }

        if (integrated) {
          setSourceReview(row, true);
          setIntegration(row, true);
        }

        row.integrationReview.group = GROUP_NAMES.find((group) => group !== expectedGroup);
        expectPrivateFailure(() => validateAssets(value));
        checked += 1;
      }
    }

    expect(checked).toBe(210);
  });

  it('accepts exactly the four approved lifecycle states', () => {
    let total = 0;
    let valid = 0;

    for (const sourceApproved of [false, true]) {
      for (const integrated of [false, true]) {
        for (const destinationReviewed of [false, true]) {
          total += 1;
          const value = makePrivateBaseline();
          const row = rowOf(value, 'approved');
          setSourceReview(row, sourceApproved);
          setIntegration(row, integrated);
          setApprovedDestinationReview(
            row,
            destinationReviewed,
            integrated ? INTEGRATOR : 'unbound-destination-author'
          );

          const expectedValid =
            (!integrated && !destinationReviewed) || (sourceApproved && integrated);

          if (expectedValid) {
            valid += 1;
            expect(() => validateAssets(value)).not.toThrow();
          } else {
            expectPrivateFailure(() => validateAssets(value));
          }
        }
      }
    }

    expect(total).toBe(8);
    expect(valid).toBe(4);
  });

  it('rejects every partial, malformed, self-reviewed, or wrong-group integration state', () => {
    const cases = [
      {
        review: { verdict: 'pending', integratorId: null, reviewerId: null },
        valid: true
      },
      {
        review: {
          verdict: 'pending',
          integratorId: INTEGRATOR,
          reviewerId: null
        },
        valid: false
      },
      {
        review: {
          verdict: 'pending',
          integratorId: null,
          reviewerId: INTEGRATION_REVIEWER
        },
        valid: false
      },
      {
        review: {
          verdict: 'pending',
          integratorId: INTEGRATOR,
          reviewerId: INTEGRATION_REVIEWER
        },
        valid: false
      },
      {
        review: {
          verdict: 'copied-and-adapted',
          integratorId: null,
          reviewerId: null
        },
        valid: false
      },
      {
        review: {
          verdict: 'copied-and-adapted',
          integratorId: INTEGRATOR,
          reviewerId: null
        },
        valid: false
      },
      {
        review: {
          verdict: 'copied-and-adapted',
          integratorId: null,
          reviewerId: INTEGRATION_REVIEWER
        },
        valid: false
      },
      {
        review: {
          verdict: 'copied-and-adapted',
          integratorId: INTEGRATOR,
          reviewerId: INTEGRATION_REVIEWER
        },
        valid: true
      },
      {
        review: {
          verdict: 'copied-and-adapted',
          integratorId: INTEGRATOR,
          reviewerId: INTEGRATOR
        },
        valid: false
      },
      {
        review: {
          verdict: 'integrated',
          integratorId: INTEGRATOR,
          reviewerId: INTEGRATION_REVIEWER
        },
        valid: false
      }
    ];

    for (const { review, valid } of cases) {
      const value = makePrivateBaseline();
      const row = rowOf(value, 'approved');
      setSourceReview(row, true);
      row.integrationReview = {
        group: EXPECTED_GROUP_BY_DESTINATION.get(row.destination),
        ...review
      };
      if (valid) {
        expect(() => validateAssets(value)).not.toThrow();
      } else {
        expectPrivateFailure(() => validateAssets(value));
      }
    }
  });

  it('rejects partial, malformed, self-reviewed, and wrong-author approved destination states', () => {
    const reviewedDigest = digest('approved-reviewed-destination');
    const cases = [
      {
        review: {
          expectedContentSha256: null,
          authorId: null,
          reviewerId: null,
          verdict: 'pending'
        },
        valid: true
      },
      {
        review: {
          expectedContentSha256: reviewedDigest,
          authorId: null,
          reviewerId: null,
          verdict: 'pending'
        },
        valid: false
      },
      {
        review: {
          expectedContentSha256: null,
          authorId: INTEGRATOR,
          reviewerId: null,
          verdict: 'pending'
        },
        valid: false
      },
      {
        review: {
          expectedContentSha256: null,
          authorId: null,
          reviewerId: DESTINATION_REVIEWER,
          verdict: 'pending'
        },
        valid: false
      },
      {
        review: {
          expectedContentSha256: reviewedDigest,
          authorId: INTEGRATOR,
          reviewerId: DESTINATION_REVIEWER,
          verdict: 'approved-migrated'
        },
        valid: true
      },
      {
        review: {
          expectedContentSha256: null,
          authorId: INTEGRATOR,
          reviewerId: DESTINATION_REVIEWER,
          verdict: 'approved-migrated'
        },
        valid: false
      },
      {
        review: {
          expectedContentSha256: reviewedDigest,
          authorId: null,
          reviewerId: DESTINATION_REVIEWER,
          verdict: 'approved-migrated'
        },
        valid: false
      },
      {
        review: {
          expectedContentSha256: reviewedDigest,
          authorId: INTEGRATOR,
          reviewerId: null,
          verdict: 'approved-migrated'
        },
        valid: false
      },
      {
        review: {
          expectedContentSha256: reviewedDigest,
          authorId: INTEGRATOR,
          reviewerId: INTEGRATOR,
          verdict: 'approved-migrated'
        },
        valid: false
      },
      {
        review: {
          expectedContentSha256: reviewedDigest,
          authorId: 'wrong-destination-author',
          reviewerId: DESTINATION_REVIEWER,
          verdict: 'approved-migrated'
        },
        valid: false
      },
      {
        review: {
          expectedContentSha256: reviewedDigest.toUpperCase(),
          authorId: INTEGRATOR,
          reviewerId: DESTINATION_REVIEWER,
          verdict: 'approved-migrated'
        },
        valid: false
      },
      {
        review: {
          expectedContentSha256: reviewedDigest,
          authorId: INTEGRATOR,
          reviewerId: DESTINATION_REVIEWER,
          verdict: 'independently-rewritten'
        },
        valid: false
      }
    ];

    for (const { review, valid } of cases) {
      const value = makePrivateBaseline();
      const row = rowOf(value, 'approved');
      setSourceReview(row, true);
      setIntegration(row, true);
      row.destinationReview = review;
      if (valid) {
        expect(() => validateAssets(value)).not.toThrow();
      } else {
        expectPrivateFailure(() => validateAssets(value));
      }
    }
  });

  it('accepts only fully pending or independently reviewed rewrite destinations', () => {
    for (const reviewed of [false, true]) {
      const value = makePrivateBaseline();
      setRewriteDestinationReview(rowOf(value, 'rewrite'), reviewed);
      expect(() => validateAssets(value)).not.toThrow();
    }

    const reviewedDigest = digest('rewrite-reviewed-destination');
    const invalidReviews = [
      {
        expectedContentSha256: reviewedDigest,
        authorId: null,
        reviewerId: null,
        verdict: 'pending'
      },
      {
        expectedContentSha256: null,
        authorId: REWRITE_AUTHOR,
        reviewerId: null,
        verdict: 'pending'
      },
      {
        expectedContentSha256: null,
        authorId: null,
        reviewerId: REWRITE_REVIEWER,
        verdict: 'pending'
      },
      {
        expectedContentSha256: null,
        authorId: REWRITE_AUTHOR,
        reviewerId: REWRITE_REVIEWER,
        verdict: 'independently-rewritten'
      },
      {
        expectedContentSha256: reviewedDigest,
        authorId: null,
        reviewerId: REWRITE_REVIEWER,
        verdict: 'independently-rewritten'
      },
      {
        expectedContentSha256: reviewedDigest,
        authorId: REWRITE_AUTHOR,
        reviewerId: null,
        verdict: 'independently-rewritten'
      },
      {
        expectedContentSha256: reviewedDigest,
        authorId: REWRITE_AUTHOR,
        reviewerId: REWRITE_AUTHOR,
        verdict: 'independently-rewritten'
      },
      {
        expectedContentSha256: reviewedDigest.toUpperCase(),
        authorId: REWRITE_AUTHOR,
        reviewerId: REWRITE_REVIEWER,
        verdict: 'independently-rewritten'
      },
      {
        expectedContentSha256: reviewedDigest,
        authorId: REWRITE_AUTHOR,
        reviewerId: REWRITE_REVIEWER,
        verdict: 'approved-migrated'
      }
    ];

    for (const review of invalidReviews) {
      const value = makePrivateBaseline();
      rowOf(value, 'rewrite').destinationReview = review;
      expectPrivateFailure(() => validateAssets(value));
    }
  });

  it('accepts only the exact discard state', () => {
    const value = makePrivateBaseline();
    expect(() => validateAssets(value)).not.toThrow();

    for (const discardReview of [
      null,
      {},
      { verdict: 'pending' },
      { verdict: 'discarded', reviewerId: 'not-allowed' }
    ]) {
      const changed = makePrivateBaseline();
      rowOf(changed, 'discard').discardReview = discardReview;
      if (discardReview !== null && Object.hasOwn(discardReview, 'reviewerId')) {
        expectPrivateFailure(() => validateCanonicalAssets(changed));
      } else {
        expectPrivateFailure(() => validateAssets(changed));
      }
    }
  });

  it('never treats rewrite or discard scan references as copy authorization', () => {
    for (const assetClass of ['rewrite', 'discard']) {
      for (const slot of ['sourceAuthorization', 'integrationReview']) {
        const value = makePrivateBaseline();
        const row = rowOf(value, assetClass);
        const approved = rowOf(value, 'approved');
        row[slot] = cloneFixture(approved[slot]);
        expectPrivateFailure(() => validateAssets(value));
      }
    }
  });

  it('rejects a reviewed snapshot reviewer equal to every author or integrator category', () => {
    const cases = [
      (value) => {
        rowOf(value, 'approved').sourceAuthorization.authorId = SNAPSHOT_REVIEWER;
      },
      (value) => {
        const row = rowOf(value, 'approved');
        setSourceReview(row, true);
        setIntegration(row, true, SNAPSHOT_REVIEWER, INTEGRATION_REVIEWER);
      },
      (value) => {
        const row = rowOf(value, 'approved');
        setSourceReview(row, true);
        setIntegration(row, true, SNAPSHOT_REVIEWER, INTEGRATION_REVIEWER);
        setApprovedDestinationReview(row, true, SNAPSHOT_REVIEWER, DESTINATION_REVIEWER);
      },
      (value) => {
        setRewriteDestinationReview(
          rowOf(value, 'rewrite'),
          true,
          SNAPSHOT_REVIEWER,
          REWRITE_REVIEWER
        );
      },
      (value) => {
        const lastRow = value.assets.at(-1);
        expect(lastRow.class).toBe('approved');
        lastRow.sourceAuthorization.authorId = SNAPSHOT_REVIEWER;
      }
    ];

    for (const configure of cases) {
      const value = makePrivateBaseline();
      configure(value);
      setSnapshotReview(value, true, SNAPSHOT_REVIEWER);
      expectPrivateFailure(() => validateAssets(value));
    }
  });

  it('allows the snapshot reviewer to equal any row reviewer', () => {
    const cases = [
      (value) => {
        setSourceReview(rowOf(value, 'approved'), true, SNAPSHOT_REVIEWER);
      },
      (value) => {
        const row = rowOf(value, 'approved');
        setSourceReview(row, true);
        setIntegration(row, true, INTEGRATOR, SNAPSHOT_REVIEWER);
      },
      (value) => {
        const row = rowOf(value, 'approved');
        setSourceReview(row, true);
        setIntegration(row, true);
        setApprovedDestinationReview(row, true, INTEGRATOR, SNAPSHOT_REVIEWER);
      },
      (value) => {
        setRewriteDestinationReview(
          rowOf(value, 'rewrite'),
          true,
          REWRITE_AUTHOR,
          SNAPSHOT_REVIEWER
        );
      }
    ];

    for (const configure of cases) {
      const value = makePrivateBaseline();
      configure(value);
      setSnapshotReview(value, true, SNAPSHOT_REVIEWER);
      expect(() => validateAssets(value)).not.toThrow();
    }
  });
});
```

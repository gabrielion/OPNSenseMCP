// SPDX-License-Identifier: AGPL-3.0-or-later

const TOP_LEVEL_KEYS = Object.freeze([
  'checks',
  'clientVersion',
  'commit',
  'host',
  'image',
  'node',
  'protocolVersion',
  'scenario',
  'schemaVersion',
  'tree'
]);
const IMAGE_KEYS = Object.freeze(['release', 'sha256']);
const SCENARIO_KEYS = Object.freeze(['flags', 'readOnly', 'scopes']);
export const VM_ATTESTATION_CHECK_KEYS = Object.freeze([
  'aliasAbsentAfter',
  'aliasAbsentBefore',
  'aliasCreated',
  'aliasDeleted',
  'aliasPresent',
  'bootstrap',
  'doctor',
  'packageInstalled',
  'residueFree',
  'vmStarted',
  'vmStopped',
  'writableSurface'
]);
const SCENARIO_FLAGS = Object.freeze(['experimental-alias-write']);
const SCENARIO_SCOPES = Object.freeze([
  'server.status',
  'system.status',
  'core.services',
  'firewall.alias'
]);
const GIT_OBJECT_PATTERN = /^[0-9a-f]{40}$/u;
const NODE_VERSION_PATTERN = /^22\.(?:19|[2-9]\d)\.\d+$/u;
const IMAGE_SHA256 = '28d5e2f37e40d87468a924e3006ef10e2ddc6de485b85333d9e3958c84d0cb9d';

export class VmAttestationError extends Error {
  constructor() {
    super('VM_ATTESTATION_INVALID');
    this.name = 'VmAttestationError';
    this.code = 'VM_ATTESTATION_INVALID';
  }
}

function invalid() {
  throw new VmAttestationError();
}

function recordWithExactKeys(value, expectedKeys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== 'string')) invalid();
  const keys = [...ownKeys].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    invalid();
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) invalid();
  }
  return value;
}

function valueAt(record, key) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !('value' in descriptor)) invalid();
  return descriptor.value;
}

function exactString(value, expected) {
  if (value !== expected) invalid();
  return value;
}

function patternedString(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) invalid();
  return value;
}

function exactStringArray(value, expected) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length !== expected.length
  ) {
    invalid();
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some((key) => typeof key === 'symbol') ||
    ownKeys.length !== expected.length + 1 ||
    !ownKeys.includes('length')
  ) {
    invalid();
  }
  for (let index = 0; index < expected.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      descriptor.value !== expected[index]
    ) {
      invalid();
    }
  }
  return Object.freeze([...value]);
}

export function buildVmAttestation(input) {
  const source = recordWithExactKeys(input, TOP_LEVEL_KEYS);
  if (valueAt(source, 'schemaVersion') !== 2) invalid();
  const commit = patternedString(valueAt(source, 'commit'), GIT_OBJECT_PATTERN);
  const tree = patternedString(valueAt(source, 'tree'), GIT_OBJECT_PATTERN);
  const node = patternedString(valueAt(source, 'node'), NODE_VERSION_PATTERN);
  const host = valueAt(source, 'host');
  if (host !== 'macos' && host !== 'linux') invalid();
  const protocolVersion = exactString(valueAt(source, 'protocolVersion'), '2026-07-28');
  const clientVersion = exactString(valueAt(source, 'clientVersion'), '0.1.0');

  const imageSource = recordWithExactKeys(valueAt(source, 'image'), IMAGE_KEYS);
  const image = Object.freeze({
    release: exactString(valueAt(imageSource, 'release'), '26.7'),
    sha256: exactString(valueAt(imageSource, 'sha256'), IMAGE_SHA256)
  });

  const scenarioSource = recordWithExactKeys(valueAt(source, 'scenario'), SCENARIO_KEYS);
  if (valueAt(scenarioSource, 'readOnly') !== false) invalid();
  const scenario = Object.freeze({
    flags: exactStringArray(valueAt(scenarioSource, 'flags'), SCENARIO_FLAGS),
    readOnly: false,
    scopes: exactStringArray(valueAt(scenarioSource, 'scopes'), SCENARIO_SCOPES)
  });

  const checksSource = recordWithExactKeys(valueAt(source, 'checks'), VM_ATTESTATION_CHECK_KEYS);
  const checks = {};
  for (const key of VM_ATTESTATION_CHECK_KEYS) {
    if (valueAt(checksSource, key) !== true) invalid();
    checks[key] = true;
  }
  Object.freeze(checks);

  return Object.freeze({
    checks,
    clientVersion,
    commit,
    host,
    image,
    node,
    protocolVersion,
    scenario,
    schemaVersion: 2,
    tree
  });
}

export function serializeVmAttestation(input) {
  return `${JSON.stringify(buildVmAttestation(input))}\n`;
}

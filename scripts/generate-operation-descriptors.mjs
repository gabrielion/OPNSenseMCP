// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { format } from 'prettier';

const DEFAULT_CONTRACT = 'src/operations/operation-contract.v1.json';
const DEFAULT_OUTPUT = 'src/operations/generated/descriptors.ts';
const EXPECTED_RESOURCES = Object.freeze(['core.services', 'system.status']);
const EXPECTED_REFERENCES = Object.freeze([
  'https://docs.opnsense.org/development/api.html',
  'https://docs.opnsense.org/development/api/core/core.html'
]);
const PRODUCT_1B_TRANSPORT_NOTE =
  'Observed on the disposable OPNsense 26.1.6 nano VM: POST /api/core/service/search with current, rowCount, sort, and searchPhrase returned the Bootgrid service page used by Product 1B.';
const EXPECTED_OPERATION_TUPLES = Object.freeze({
  'core.services': Object.freeze({
    name: 'list',
    effect: 'read',
    capabilityId: 'opnsense.list',
    method: 'POST',
    path: '/api/core/service/search',
    transportStatus: 'vm-observed-26.1.6',
    transportNote: PRODUCT_1B_TRANSPORT_NOTE
  }),
  'system.status': Object.freeze({
    name: 'get',
    effect: 'read',
    capabilityId: 'opnsense.get',
    method: 'GET',
    path: '/api/core/system/status',
    transportStatus: 'documented',
    transportNote: undefined
  })
});
const FORBIDDEN_SCHEMA_PROPERTY_NAMES = new Set([
  'apikey',
  'apisecret',
  'authorization',
  'credential',
  'credentials',
  'method',
  'password',
  'path',
  'secret',
  'token',
  'transport',
  'username'
]);

function invalidContract() {
  throw new Error('invalid');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value) {
  if (!isRecord(value)) invalidContract();
  return value;
}

function requireString(value) {
  if (typeof value !== 'string' || value.length === 0) invalidContract();
  return value;
}

function requireStringArray(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) invalidContract();
  return value;
}

function hasExactKeys(record, expected) {
  const actual = Object.keys(record).sort(compareUnicodeCodePoints);
  const sortedExpected = [...expected].sort(compareUnicodeCodePoints);
  return JSON.stringify(actual) === JSON.stringify(sortedExpected);
}

function requireSafeInteger(value) {
  if (!Number.isSafeInteger(value)) invalidContract();
  return value;
}

function compareUnicodeCodePoints(left, right) {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex);
    const rightPoint = right.codePointAt(rightIndex);
    if (leftPoint === undefined || rightPoint === undefined) invalidContract();
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  if (leftIndex === left.length && rightIndex === right.length) return 0;
  return leftIndex === left.length ? -1 : 1;
}

function normalizeJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidContract();
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeJson);
  const record = requireRecord(value);
  return Object.fromEntries(
    Object.keys(record)
      .sort(compareUnicodeCodePoints)
      .map((key) => [key, normalizeJson(record[key])])
  );
}

function canonicalJson(value) {
  return JSON.stringify(normalizeJson(value));
}

function sha256Json(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function validateSchemaPropertyName(name) {
  if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(name)) invalidContract();
  const normalized = name.toLowerCase();
  if ([...FORBIDDEN_SCHEMA_PROPERTY_NAMES].some((token) => normalized.includes(token))) {
    invalidContract();
  }
}

function validateSchemaNode(value) {
  const schema = requireRecord(value);
  switch (schema.type) {
    case 'object': {
      if (!hasExactKeys(schema, ['type', 'additionalProperties', 'required', 'properties'])) {
        invalidContract();
      }
      if (schema.additionalProperties !== false) invalidContract();
      const properties = requireRecord(schema.properties);
      const propertyNames = Object.keys(properties);
      for (const name of propertyNames) validateSchemaPropertyName(name);
      const required = requireStringArray(schema.required);
      if (
        new Set(required).size !== required.length ||
        JSON.stringify(required) !== JSON.stringify(propertyNames)
      ) {
        invalidContract();
      }
      for (const propertySchema of Object.values(properties)) validateSchemaNode(propertySchema);
      return;
    }
    case 'array': {
      if (!hasExactKeys(schema, ['type', 'items', 'maxItems'])) invalidContract();
      const maxItems = requireSafeInteger(schema.maxItems);
      if (maxItems < 1 || maxItems > 100) invalidContract();
      validateSchemaNode(schema.items);
      return;
    }
    case 'string': {
      const expectedKeys =
        schema.minLength === undefined ? ['type', 'maxLength'] : ['type', 'minLength', 'maxLength'];
      if (!hasExactKeys(schema, expectedKeys)) invalidContract();
      const maxLength = requireSafeInteger(schema.maxLength);
      if (maxLength < 1 || maxLength > 4096) invalidContract();
      if (schema.minLength !== undefined) {
        const minLength = requireSafeInteger(schema.minLength);
        if (minLength < 0 || minLength > maxLength) invalidContract();
      }
      return;
    }
    case 'integer': {
      if (!hasExactKeys(schema, ['type', 'minimum', 'maximum'])) invalidContract();
      const minimum = requireSafeInteger(schema.minimum);
      const maximum = requireSafeInteger(schema.maximum);
      if (minimum > maximum) invalidContract();
      return;
    }
    default:
      invalidContract();
  }
}

function localSchema(reference, defs) {
  if (typeof reference !== 'string' || !reference.startsWith('#/$defs/')) invalidContract();
  const name = reference.slice(8);
  if (!Object.hasOwn(defs, name)) invalidContract();
  return requireRecord(defs[name]);
}

function validateEvidence(value) {
  const evidence = requireRecord(value);
  for (const key of ['offline', 'mock', 'vm', 'agentic']) requireString(evidence[key]);
}

function validateContract(value) {
  const contract = requireRecord(value);
  if (contract.schemaVersion !== 1) invalidContract();
  if (requireString(contract.contractId) !== 'opnsense-product-1a-read-contract') invalidContract();
  requireString(contract.firmwareTarget);
  const references = requireStringArray(contract.sourceReferences);
  if (JSON.stringify(references) !== JSON.stringify(EXPECTED_REFERENCES)) invalidContract();
  const defs = requireRecord(contract.$defs);
  for (const schema of Object.values(defs)) validateSchemaNode(schema);

  if (!Array.isArray(contract.resources) || contract.resources.length !== 2) invalidContract();
  const resources = contract.resources.map(requireRecord);
  const keys = resources.map((resource) => requireString(resource.key));
  if (
    new Set(keys).size !== keys.length ||
    JSON.stringify(keys) !== JSON.stringify(EXPECTED_RESOURCES)
  ) {
    invalidContract();
  }

  for (const resource of resources) {
    for (const field of [
      'label',
      'category',
      'description',
      'module',
      'controller',
      'wrapper',
      'firmwareTarget'
    ]) {
      requireString(resource[field]);
    }
    requireStringArray(resource.requiredFeatures);
    if (
      JSON.stringify(requireStringArray(resource.sourceReferences)) !==
      JSON.stringify(EXPECTED_REFERENCES)
    ) {
      invalidContract();
    }
    if (resource.requiredPlugin !== null && !isRecord(resource.requiredPlugin)) invalidContract();
    if (!Array.isArray(resource.operations) || resource.operations.length !== 1) invalidContract();

    for (const operationValue of resource.operations) {
      const operation = requireRecord(operationValue);
      const expectedTuple = EXPECTED_OPERATION_TUPLES[resource.key];
      if (expectedTuple === undefined) invalidContract();
      if (operation.name !== expectedTuple.name || operation.effect !== expectedTuple.effect) {
        invalidContract();
      }
      if (operation.resourceScope !== resource.key) invalidContract();
      if (operation.capabilityId !== expectedTuple.capabilityId) invalidContract();
      const command = requireRecord(operation.command);
      if (!hasExactKeys(command, ['method', 'path'])) invalidContract();
      if (command.method !== expectedTuple.method || command.path !== expectedTuple.path) {
        invalidContract();
      }
      if (operation.documentedTransport !== `${expectedTuple.method} ${expectedTuple.path}`) {
        invalidContract();
      }
      if (operation.transportStatus !== expectedTuple.transportStatus) invalidContract();
      if (operation.transportNote !== expectedTuple.transportNote) invalidContract();
      const inputSchema = localSchema(operation.inputSchemaRef, defs);
      const outputSchema = localSchema(operation.outputSchemaRef, defs);
      validateSchemaNode(inputSchema);
      validateSchemaNode(outputSchema);
      const limits = requireRecord(operation.limits);
      for (const limit of ['maxInputBytes', 'maxOutputBytes', 'maxItems']) {
        if (!Number.isInteger(limits[limit]) || limits[limit] < 1) invalidContract();
      }
      validateEvidence(operation.evidence);
    }
  }
  return { contract, defs, resources };
}

function publicOperation(operation, defs) {
  const inputSchema = localSchema(operation.inputSchemaRef, defs);
  const outputSchema = localSchema(operation.outputSchemaRef, defs);
  return {
    name: operation.name,
    effect: operation.effect,
    inputSchema,
    outputSchema,
    inputSchemaDigest: sha256Json(inputSchema),
    outputSchemaDigest: sha256Json(outputSchema)
  };
}

function runtimeOperation(operation, defs) {
  return {
    name: operation.name,
    effect: operation.effect,
    command: operation.command,
    transportStatus: operation.transportStatus,
    inputSchema: localSchema(operation.inputSchemaRef, defs),
    outputSchema: localSchema(operation.outputSchemaRef, defs),
    inputSchemaDigest: sha256Json(localSchema(operation.inputSchemaRef, defs)),
    outputSchemaDigest: sha256Json(localSchema(operation.outputSchemaRef, defs)),
    resourceScope: operation.resourceScope,
    capabilityId: operation.capabilityId,
    limits: operation.limits,
    evidence: operation.evidence
  };
}

function generateSource(contractValue) {
  const { contract, defs, resources } = validateContract(contractValue);
  const contractDigest = sha256Json(contract);
  const descriptors = resources.map((resource) => ({
    key: resource.key,
    label: resource.label,
    category: resource.category,
    description: resource.description,
    requiredPlugin: resource.requiredPlugin,
    requiredFeatures: resource.requiredFeatures,
    operations: resource.operations.map((operation) =>
      publicOperation(requireRecord(operation), defs)
    ),
    contractDigest,
    runtime: {
      module: resource.module,
      controller: resource.controller,
      wrapper: resource.wrapper,
      firmwareTarget: resource.firmwareTarget,
      sourceReferences: resource.sourceReferences,
      operations: resource.operations.map((operation) =>
        runtimeOperation(requireRecord(operation), defs)
      )
    }
  }));
  return `// SPDX-License-Identifier: AGPL-3.0-or-later\n// Generated by scripts/generate-operation-descriptors.mjs. Do not edit.\n\nexport const GENERATED_OPERATION_DESCRIPTORS = ${JSON.stringify(descriptors, null, 2)} as const;\n\nexport const GENERATED_OPERATION_CONTRACT_DIGEST = '${contractDigest}';\n`;
}

function parseArguments(argv) {
  let contract = DEFAULT_CONTRACT;
  let output = DEFAULT_OUTPUT;
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') {
      check = true;
    } else if (argument === '--contract') {
      contract = argv[(index += 1)];
    } else if (argument === '--output') {
      output = argv[(index += 1)];
    } else {
      invalidContract();
    }
  }
  if (typeof contract !== 'string' || typeof output !== 'string') invalidContract();
  return { contract: resolve(contract), output: resolve(output), check };
}

async function main() {
  let options;
  let source;
  try {
    options = parseArguments(process.argv.slice(2));
    const contract = JSON.parse(await readFile(options.contract, 'utf8'));
    source = await format(generateSource(contract), {
      parser: 'typescript',
      printWidth: 100,
      singleQuote: true,
      trailingComma: 'none'
    });
  } catch {
    process.stderr.write('Invalid operation contract.\n');
    process.exitCode = 1;
    return;
  }

  if (options.check) {
    let current;
    try {
      current = await readFile(options.output, 'utf8');
    } catch {
      current = undefined;
    }
    if (current !== source) {
      process.stderr.write('Generated operation descriptors are out of date.\n');
      process.exitCode = 1;
    }
    return;
  }
  await writeFile(options.output, source, 'utf8');
}

await main();

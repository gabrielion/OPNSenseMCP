// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { sha256Json } from '../../src/security/canonical-json.js';

const CONTRACT_PATH = resolve('src/operations/operation-contract.v1.json');
const GENERATOR_PATH = resolve('scripts/generate-operation-descriptors.mjs');
const GENERATED_PATH = resolve('src/operations/generated/descriptors.ts');

interface OperationContract {
  schemaVersion: number;
  sourceReferences: string[];
  $defs: Record<string, unknown>;
  resources: {
    key: string;
    operations: {
      name: string;
      effect?: string;
      capabilityId: string;
      command: { method: string; path: string };
      applyCommand?: { method: string; path: string };
      transportStatus: string;
      transportNote?: string;
      resourceScope?: string;
      evidence?: unknown;
      inputSchemaRef: string;
      outputSchemaRef: string;
    }[];
  }[];
}

type MutableSchema = Record<string, unknown>;

const PRODUCT_1B_TRANSPORT_NOTE =
  'Observed on the disposable OPNsense 26.1.6 nano VM: POST /api/core/service/search with current, rowCount, sort, and searchPhrase returned the Bootgrid service page used by Product 1B.';

function schema(contract: OperationContract, name: string): MutableSchema {
  const value = contract.$defs[name];
  expect(value).toBeDefined();
  return value as MutableSchema;
}

function schemaProperties(value: MutableSchema): Record<string, MutableSchema> {
  return value.properties as Record<string, MutableSchema>;
}

function schemaProperty(
  contract: OperationContract,
  schemaName: string,
  propertyName: string
): MutableSchema {
  const value = schemaProperties(schema(contract, schemaName))[propertyName];
  if (value === undefined) throw new Error(`Missing test schema property: ${propertyName}`);
  return value;
}

function operationAt(contract: OperationContract, resourceIndex: number) {
  const operation = contract.resources[resourceIndex]?.operations[0];
  if (operation === undefined) throw new Error(`Missing test operation: ${String(resourceIndex)}`);
  return operation;
}

function readContract(): OperationContract | undefined {
  try {
    return JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) as OperationContract;
  } catch {
    return undefined;
  }
}

function runGenerator(args: readonly string[] = []) {
  return spawnSync(process.execPath, [GENERATOR_PATH, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
}

describe('three-resource operation contract', () => {
  it('is versioned, contains the approved read and firewall-write tuples, and preserves official sources', () => {
    const contract = readContract();
    expect(contract).toBeDefined();
    if (contract === undefined) return;

    expect(contract.schemaVersion).toBe(1);
    expect(contract.resources.map(({ key }) => key)).toEqual([
      'core.services',
      'system.status',
      'firewall.alias'
    ]);
    expect(
      contract.resources.flatMap(({ key, operations }) =>
        operations.map((operation) => ({
          key,
          name: operation.name,
          effect: operation.effect,
          capabilityId: operation.capabilityId,
          method: operation.command.method,
          path: operation.command.path,
          transportStatus: operation.transportStatus,
          transportNote: operation.transportNote ?? null
        }))
      )
    ).toEqual([
      {
        key: 'core.services',
        name: 'list',
        effect: 'read',
        capabilityId: 'opnsense.list',
        method: 'POST',
        path: '/api/core/service/search',
        transportStatus: 'vm-observed-26.1.6',
        transportNote: PRODUCT_1B_TRANSPORT_NOTE
      },
      {
        key: 'system.status',
        name: 'get',
        effect: 'read',
        capabilityId: 'opnsense.get',
        method: 'GET',
        path: '/api/core/system/status',
        transportStatus: 'documented',
        transportNote: null
      },
      {
        key: 'firewall.alias',
        name: 'list',
        effect: 'read',
        capabilityId: 'opnsense.list',
        method: 'POST',
        path: '/api/firewall/alias/searchItem',
        transportStatus: 'vm-observed-26.1.6',
        transportNote: null
      },
      {
        key: 'firewall.alias',
        name: 'create',
        effect: 'firewall-write',
        capabilityId: 'opnsense.create',
        method: 'POST',
        path: '/api/firewall/alias/addItem',
        transportStatus: 'vm-observed-26.1.6',
        transportNote: null
      },
      {
        key: 'firewall.alias',
        name: 'delete',
        effect: 'firewall-write',
        capabilityId: 'opnsense.delete',
        method: 'POST',
        path: '/api/firewall/alias/delItem',
        transportStatus: 'vm-observed-26.1.6',
        transportNote: null
      }
    ]);
    expect(contract.sourceReferences).toEqual([
      'https://docs.opnsense.org/development/api.html',
      'https://docs.opnsense.org/development/api/core/core.html'
    ]);
    expect(JSON.stringify(contract)).toContain('vm-observed-26.1.6');
    expect(JSON.stringify(contract)).toContain('GET /api/core/system/status');
    expect(JSON.stringify(contract)).toContain('POST /api/core/service/search');
    expect(JSON.stringify(contract)).toContain('/api/firewall/alias/reconfigure');
  });

  it('marks the observed firewall-alias lifecycle with Product 3 VM evidence', () => {
    const contract = readContract();
    expect(contract).toBeDefined();
    if (contract === undefined) return;

    const alias = contract.resources.find(({ key }) => key === 'firewall.alias');
    expect(alias).toBeDefined();
    const operations = alias?.operations ?? [];
    expect(operations.map(({ name }) => name)).toEqual(['list', 'create', 'delete']);
    for (const operation of operations) {
      expect(operation.transportStatus).toBe('vm-observed-26.1.6');
      expect(operation.evidence).toMatchObject({ vm: 'verified-product3' });
    }
    const writes = operations.filter((operation) => operation.effect === 'firewall-write');
    expect(writes.map(({ name }) => name)).toEqual(['create', 'delete']);
    for (const operation of writes) {
      expect(operation.applyCommand).toEqual({
        method: 'POST',
        path: '/api/firewall/alias/reconfigure'
      });
      expect(operation.evidence).toMatchObject({ vm: 'verified-product3' });
    }
  });

  it('defines bounded schemas for the later read envelopes', () => {
    const contract = readContract();
    expect(contract).toBeDefined();
    if (contract === undefined) return;

    expect(contract.$defs).toMatchObject({
      systemStatusGetOutput: {
        additionalProperties: false,
        properties: {
          item: {
            additionalProperties: false,
            properties: { status: { type: 'string', minLength: 1, maxLength: 64 } },
            required: ['status'],
            type: 'object'
          }
        }
      },
      coreServicesListInput: {
        additionalProperties: false,
        properties: {
          page: { type: 'integer', minimum: 1, maximum: 1000 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          query: { type: 'string', maxLength: 128 }
        }
      },
      coreServicesListOutput: {
        additionalProperties: false,
        properties: {
          items: { type: 'array', maxItems: 100 }
        }
      }
    });
  });

  it('generates reproducible runtime descriptors and current contract/schema digests', () => {
    const contract = readContract();
    expect(contract).toBeDefined();
    if (contract === undefined) return;

    const result = runGenerator(['--check']);
    expect(result.status, result.stderr).toBe(0);
    const generated = readFileSync(GENERATED_PATH, 'utf8');
    expect(generated).toContain(sha256Json(contract));
    for (const resource of contract.resources) {
      for (const operation of resource.operations) {
        const inputName = operation.inputSchemaRef.slice('#/$defs/'.length);
        const outputName = operation.outputSchemaRef.slice('#/$defs/'.length);
        expect(generated).toContain(sha256Json(contract.$defs[inputName]));
        expect(generated).toContain(sha256Json(contract.$defs[outputName]));
      }
    }
  });

  it.each([
    {
      label: 'external schema references',
      mutate: (contract: OperationContract) => {
        const operation = contract.resources[0]?.operations[0];
        if (operation !== undefined)
          operation.inputSchemaRef = 'https://invalid.example/schema.json';
      }
    },
    {
      label: 'missing effects',
      mutate: (contract: OperationContract) => {
        const operation = contract.resources[0]?.operations[0];
        if (operation !== undefined) delete operation.effect;
      }
    },
    {
      label: 'missing scopes',
      mutate: (contract: OperationContract) => {
        const operation = contract.resources[0]?.operations[0];
        if (operation !== undefined) delete operation.resourceScope;
      }
    },
    {
      label: 'missing evidence',
      mutate: (contract: OperationContract) => {
        const operation = contract.resources[0]?.operations[0];
        if (operation !== undefined) delete operation.evidence;
      }
    },
    {
      label: 'duplicate resource keys',
      mutate: (contract: OperationContract) => {
        const first = contract.resources[0];
        const second = contract.resources[1];
        if (first !== undefined && second !== undefined) second.key = first.key;
      }
    }
  ])('fails closed for $label', ({ mutate }) => {
    const contract = readContract();
    expect(contract).toBeDefined();
    if (contract === undefined) return;

    const directory = mkdtempSync(join(tmpdir(), 'opnsense-contract-'));
    try {
      mutate(contract);
      const contractPath = join(directory, 'contract.json');
      const outputPath = join(directory, 'descriptors.ts');
      writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
      const result = runGenerator(['--contract', contractPath, '--output', outputPath]);
      expect(result.status).toBe(1);
      expect(result.stderr).toBe('Invalid operation contract.\n');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: 'nested local schema references',
      mutate: (contract: OperationContract) => {
        schemaProperties(schema(contract, 'systemStatusGetOutput')).item = {
          $ref: '#/$defs/systemStatusGetInput'
        };
      }
    },
    {
      label: 'unknown schema keywords',
      mutate: (contract: OperationContract) => {
        schema(contract, 'systemStatusGetOutput').title = 'status';
      }
    },
    {
      label: 'schema defaults',
      mutate: (contract: OperationContract) => {
        schemaProperty(contract, 'coreServicesListInput', 'query').default = '';
      }
    },
    {
      label: 'schema constants',
      mutate: (contract: OperationContract) => {
        schemaProperty(contract, 'systemStatusGetOutput', 'item').const = {};
      }
    },
    {
      label: 'schema examples',
      mutate: (contract: OperationContract) => {
        schemaProperty(contract, 'systemStatusGetOutput', 'item').examples = [{}];
      }
    },
    {
      label: 'open object schemas',
      mutate: (contract: OperationContract) => {
        schema(contract, 'coreServicesListInput').additionalProperties = true;
      }
    },
    {
      label: 'unbounded arrays',
      mutate: (contract: OperationContract) => {
        delete schemaProperty(contract, 'coreServicesListOutput', 'items').maxItems;
      }
    },
    {
      label: 'unbounded strings',
      mutate: (contract: OperationContract) => {
        delete schemaProperty(contract, 'coreServicesListInput', 'query').maxLength;
      }
    },
    {
      label: 'unbounded integers',
      mutate: (contract: OperationContract) => {
        delete schemaProperty(contract, 'coreServicesListInput', 'page').maximum;
      }
    },
    ...['transportStatus', 'requestPath', 'httpMethod', 'credentialId', 'apiKey', 'apiSecret'].map(
      (property) => ({
        label: `sensitive schema property ${property}`,
        mutate: (contract: OperationContract) => {
          const input = schema(contract, 'coreServicesListInput');
          schemaProperties(input)[property] = { type: 'string', minLength: 1, maxLength: 128 };
          (input.required as string[]).push(property);
        }
      })
    )
  ])('rejects the closed public schema subset violation: $label', ({ mutate }) => {
    const contract = readContract();
    expect(contract).toBeDefined();
    if (contract === undefined) return;

    const directory = mkdtempSync(join(tmpdir(), 'opnsense-schema-contract-'));
    try {
      mutate(contract);
      const contractPath = join(directory, 'contract.json');
      const outputPath = join(directory, 'descriptors.ts');
      writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
      const result = runGenerator(['--contract', contractPath, '--output', outputPath]);
      expect(result.status).toBe(1);
      expect(result.stderr).toBe('Invalid operation contract.\n');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: 'operation name',
      mutate: (contract: OperationContract) => {
        operationAt(contract, 0).name = 'get';
      }
    },
    {
      label: 'capability association',
      mutate: (contract: OperationContract) => {
        operationAt(contract, 0).capabilityId = 'opnsense.get';
      }
    },
    {
      label: 'method association',
      mutate: (contract: OperationContract) => {
        operationAt(contract, 0).command.method = 'GET';
      }
    },
    {
      label: 'path association',
      mutate: (contract: OperationContract) => {
        operationAt(contract, 0).command.path = '/api/core/system/status';
      }
    },
    {
      label: 'transport-status association',
      mutate: (contract: OperationContract) => {
        operationAt(contract, 0).transportStatus = 'documented';
      }
    },
    {
      label: 'Product 1B note association',
      mutate: (contract: OperationContract) => {
        delete operationAt(contract, 0).transportNote;
        operationAt(contract, 1).transportNote = PRODUCT_1B_TRANSPORT_NOTE;
      }
    }
  ])('rejects a swapped exact resource tuple: $label', ({ mutate }) => {
    const contract = readContract();
    expect(contract).toBeDefined();
    if (contract === undefined) return;

    const directory = mkdtempSync(join(tmpdir(), 'opnsense-tuple-contract-'));
    try {
      mutate(contract);
      const contractPath = join(directory, 'contract.json');
      const outputPath = join(directory, 'descriptors.ts');
      writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
      const result = runGenerator(['--contract', contractPath, '--output', outputPath]);
      expect(result.status).toBe(1);
      expect(result.stderr).toBe('Invalid operation contract.\n');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('detects generated descriptor drift without overwriting the reviewed file', () => {
    const contract = readContract();
    expect(contract).toBeDefined();
    if (contract === undefined) return;

    const directory = mkdtempSync(join(tmpdir(), 'opnsense-descriptor-drift-'));
    try {
      const outputPath = join(directory, 'descriptors.ts');
      writeFileSync(outputPath, '// drift\n', 'utf8');
      const result = runGenerator(['--check', '--output', outputPath]);
      expect(result.status).toBe(1);
      expect(result.stderr).toBe('Generated operation descriptors are out of date.\n');
      expect(readFileSync(outputPath, 'utf8')).toBe('// drift\n');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

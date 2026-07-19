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
      effect?: string;
      resourceScope?: string;
      evidence?: unknown;
      inputSchemaRef: string;
      outputSchemaRef: string;
    }[];
  }[];
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

describe('two-resource operation contract', () => {
  it('is versioned, contains exactly the two approved read tuples, and preserves official sources', () => {
    const contract = readContract();
    expect(contract).toBeDefined();
    if (contract === undefined) return;

    expect(contract.schemaVersion).toBe(1);
    expect(contract.resources.map(({ key }) => key)).toEqual(['core.services', 'system.status']);
    expect(
      contract.resources.flatMap(({ key, operations }) =>
        operations.map(({ effect }) => `${key}:${effect ?? 'missing'}`)
      )
    ).toEqual(['core.services:read', 'system.status:read']);
    expect(contract.sourceReferences).toEqual([
      'https://docs.opnsense.org/development/api.html',
      'https://docs.opnsense.org/development/api/core/core.html'
    ]);
    expect(JSON.stringify(contract)).toContain('mock-candidate');
    expect(JSON.stringify(contract)).toContain('GET /api/core/system/status');
    expect(JSON.stringify(contract)).toContain('POST /api/core/service/search');
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

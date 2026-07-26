// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import { createCapabilityDispatcher } from '../../src/capabilities/kernel.js';
import { createOPNsenseCreateCapability } from '../../src/capabilities/opnsense/create.js';
import type { OPNsenseAliasAdapter } from '../../src/opnsense/alias-adapter.js';
import type { CapabilityResult, MutationEnvelopeServices } from '../../src/capabilities/types.js';

function deterministicRandomBytes(): (size: number) => Uint8Array {
  let counter = 0;
  return (size: number) => {
    const bytes = new Uint8Array(size);
    bytes[size - 1] = counter;
    counter += 1;
    return bytes;
  };
}

interface ServiceOptions {
  readonly backupThrow?: boolean;
}

function makeServices(options: ServiceOptions = {}): {
  readonly services: MutationEnvelopeServices;
  readonly events: string[];
} {
  const events: string[] = [];
  const createdBackups = new Set<string>();
  let backupCounter = 0;
  const services: MutationEnvelopeServices = {
    lock: {
      acquire: () =>
        Promise.resolve({
          release: () => Promise.resolve()
        })
    },
    backup: {
      create: () => {
        if (options.backupThrow === true) return Promise.reject(new Error('backup'));
        backupCounter += 1;
        const backupId = `backup-${String(backupCounter)}`;
        createdBackups.add(backupId);
        return Promise.resolve({ backupId });
      },
      exists: (backupId: string) => Promise.resolve(createdBackups.has(backupId))
    },
    audit: {
      record: (record) => {
        events.push(`audit.${record.phase}:${record.outcome}`);
      }
    }
  };
  return { services, events };
}

interface AdapterOptions {
  readonly skipApply?: boolean;
}

function statefulAliasAdapter(options: AdapterOptions = {}): {
  readonly adapter: OPNsenseAliasAdapter;
  readonly names: () => readonly string[];
} {
  const aliases = new Map<
    string,
    { uuid: string; name: string; type: string; description: string }
  >();
  let counter = 0;
  const adapter: OPNsenseAliasAdapter = {
    available: true,
    searchHostAliases: (input) =>
      Promise.resolve({
        page: 1,
        pageSize: input.pageSize,
        total: aliases.size,
        items: [...aliases.values()]
      }),
    createHostAlias: (attributes) => {
      counter += 1;
      const uuid = `00000000-0000-0000-0000-${String(counter).padStart(12, '0')}`;
      if (options.skipApply !== true) {
        aliases.set(uuid, {
          uuid,
          name: attributes.name,
          type: 'host',
          description: attributes.description
        });
      }
      return Promise.resolve({
        item: {
          uuid,
          name: attributes.name,
          type: 'host',
          content: [...attributes.content],
          description: attributes.description
        }
      });
    },
    deleteHostAlias: (id) => {
      aliases.delete(id);
      return Promise.resolve({ item: { id } });
    }
  };
  return { adapter, names: () => [...aliases.values()].map((alias) => alias.name) };
}

function harness(adapter: OPNsenseAliasAdapter, services: MutationEnvelopeServices) {
  let completion:
    | Parameters<NonNullable<Parameters<typeof createCapabilityDispatcher>[2]>>[0]
    | undefined;
  const dispatcher = createCapabilityDispatcher(
    new CapabilityCatalog([createOPNsenseCreateCapability(adapter)]),
    { readOnly: false, allowedResourceScopes: null, enabledFeatureFlags: new Set<never>() },
    (installed) => {
      completion = installed;
    },
    { now: () => 1000, randomBytes: deterministicRandomBytes() },
    {},
    services
  );
  return {
    async create(
      attributes: unknown,
      decision: 'accept' | 'decline' = 'accept'
    ): Promise<CapabilityResult> {
      const request = { name: 'opn_create', arguments: { resource: 'firewall.alias', attributes } };
      const context = { transport: 'stdio' as const };
      const first = await dispatcher.dispatch(request, context);
      if (first.kind !== 'confirmation-required') return first;
      if (completion === undefined) throw new Error('completion not installed');
      return completion(
        decision,
        {
          confirmationId: first.challenge.confirmationId,
          capabilityId: first.challenge.capabilityId,
          argumentsSha256: first.challenge.argumentsSha256
        },
        request,
        context
      );
    }
  };
}

const VALID = { name: 'lab_hosts', type: 'host', content: ['192.0.2.10'], description: 'lab' };

describe('opn_create firewall alias', () => {
  it('refuses invalid attributes before issuing a confirmation challenge', async () => {
    const { adapter } = statefulAliasAdapter();
    const { services } = makeServices();
    const result = await harness(adapter, services).create({
      name: 'BAD NAME',
      type: 'host',
      content: ['192.0.2.10'],
      description: ''
    });
    expect(result).toMatchObject({
      kind: 'refused',
      code: 'INVALID_RESOURCE_INPUT',
      details: { resource: 'firewall.alias', operation: 'create', fields: ['name'] }
    });
  });

  it('confirms then creates the alias through the envelope and never leaks a backupId', async () => {
    const { adapter, names } = statefulAliasAdapter();
    const { services, events } = makeServices();
    const result = await harness(adapter, services).create(VALID);
    expect(result).toEqual({
      kind: 'success',
      output: {
        item: {
          uuid: '00000000-0000-0000-0000-000000000001',
          name: 'lab_hosts',
          type: 'host',
          content: ['192.0.2.10'],
          description: 'lab'
        }
      }
    });
    expect(names()).toEqual(['lab_hosts']);
    expect(JSON.stringify(result)).not.toContain('backup');
    expect(events).toEqual(['audit.intent:intent', 'audit.result:success']);
  });

  it('refuses with BACKUP_FAILED before any adapter write when the backup fails', async () => {
    const { adapter, names } = statefulAliasAdapter();
    const { services } = makeServices({ backupThrow: true });
    const result = await harness(adapter, services).create(VALID);
    expect(result).toMatchObject({ kind: 'refused', code: 'BACKUP_FAILED' });
    expect(names()).toEqual([]);
  });

  it('reports OUTCOME_UNVERIFIED and preserves the backup when read-back cannot confirm the effect', async () => {
    const { adapter } = statefulAliasAdapter({ skipApply: true });
    const { services } = makeServices();
    const result = await harness(adapter, services).create(VALID);
    expect(result).toMatchObject({ kind: 'refused', code: 'OUTCOME_UNVERIFIED' });
    if (result.kind === 'refused') {
      expect(result.message).toContain('Do not retry blindly');
      expect(result.message).not.toMatch(/preserved/iu);
      expect(JSON.stringify(result)).not.toContain('backup-');
    }
  });
});

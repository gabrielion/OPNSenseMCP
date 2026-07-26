// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import { createCapabilityDispatcher } from '../../src/capabilities/kernel.js';
import { createOPNsenseDeleteCapability } from '../../src/capabilities/opnsense/delete.js';
import type { OPNsenseAliasAdapter } from '../../src/opnsense/alias-adapter.js';
import type { CapabilityResult, MutationEnvelopeServices } from '../../src/capabilities/types.js';

const SEED_UUID = '00000000-0000-0000-0000-000000000001';

function deterministicRandomBytes(): (size: number) => Uint8Array {
  let counter = 0;
  return (size: number) => {
    const bytes = new Uint8Array(size);
    bytes[size - 1] = counter;
    counter += 1;
    return bytes;
  };
}

function makeServices(): MutationEnvelopeServices {
  const createdBackups = new Set<string>();
  let backupCounter = 0;
  return {
    lock: { acquire: () => Promise.resolve({ release: () => Promise.resolve() }) },
    backup: {
      create: () => {
        backupCounter += 1;
        const backupId = `backup-${String(backupCounter)}`;
        createdBackups.add(backupId);
        return Promise.resolve({ backupId });
      },
      exists: (backupId: string) => Promise.resolve(createdBackups.has(backupId))
    },
    audit: { record: () => undefined }
  };
}

function statefulAliasAdapter(options: { readonly skipDelete?: boolean } = {}): {
  readonly adapter: OPNsenseAliasAdapter;
  readonly uuids: () => readonly string[];
} {
  const aliases = new Map<
    string,
    { uuid: string; name: string; type: string; description: string }
  >([[SEED_UUID, { uuid: SEED_UUID, name: 'seed_alias', type: 'host', description: 'seed' }]]);
  const adapter: OPNsenseAliasAdapter = {
    available: true,
    searchHostAliases: (input) =>
      Promise.resolve({
        page: 1,
        pageSize: input.pageSize,
        total: aliases.size,
        items: [...aliases.values()]
      }),
    createHostAlias: () => Promise.reject(new Error('unused')),
    deleteHostAlias: (id) => {
      if (options.skipDelete !== true) aliases.delete(id);
      return Promise.resolve({ item: { id } });
    }
  };
  return { adapter, uuids: () => [...aliases.keys()] };
}

function harness(adapter: OPNsenseAliasAdapter, services: MutationEnvelopeServices) {
  let completion:
    | Parameters<NonNullable<Parameters<typeof createCapabilityDispatcher>[2]>>[0]
    | undefined;
  const dispatcher = createCapabilityDispatcher(
    new CapabilityCatalog([createOPNsenseDeleteCapability(adapter)]),
    {
      readOnly: false,
      allowedResourceScopes: new Set(['firewall.alias']),
      enabledFeatureFlags: new Set(['experimental-alias-write' as const])
    },
    (installed) => {
      completion = installed;
    },
    { now: () => 1000, randomBytes: deterministicRandomBytes() },
    {},
    services
  );
  return {
    async remove(args: Record<string, unknown>): Promise<CapabilityResult> {
      const request = { name: 'opn_delete', arguments: args };
      const context = { transport: 'stdio' as const };
      const first = await dispatcher.dispatch(request, context);
      if (first.kind !== 'confirmation-required') return first;
      if (completion === undefined) throw new Error('completion not installed');
      return completion(
        'accept',
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

describe('opn_delete firewall alias', () => {
  it('refuses an unknown resource that does not support delete', async () => {
    const { adapter } = statefulAliasAdapter();
    const result = await harness(adapter, makeServices()).remove({
      resource: 'core.services',
      id: SEED_UUID
    });
    expect(result).toMatchObject({ kind: 'refused', code: 'UNKNOWN_RESOURCE' });
  });

  it('refuses a malformed identifier before the envelope', async () => {
    const { adapter } = statefulAliasAdapter();
    const result = await harness(adapter, makeServices()).remove({
      resource: 'firewall.alias',
      id: 'not-a-uuid'
    });
    expect(result).toMatchObject({
      kind: 'refused',
      code: 'INVALID_RESOURCE_INPUT',
      details: { resource: 'firewall.alias', operation: 'delete', fields: ['id'] }
    });
  });

  it('confirms then deletes the alias and proves its absence', async () => {
    const { adapter, uuids } = statefulAliasAdapter();
    const result = await harness(adapter, makeServices()).remove({
      resource: 'firewall.alias',
      id: SEED_UUID
    });
    expect(result).toEqual({ kind: 'success', output: { item: { id: SEED_UUID } } });
    expect(uuids()).toEqual([]);
  });

  it('reports OUTCOME_UNVERIFIED and preserves the backup when the alias is still present', async () => {
    const { adapter } = statefulAliasAdapter({ skipDelete: true });
    const result = await harness(adapter, makeServices()).remove({
      resource: 'firewall.alias',
      id: SEED_UUID
    });
    expect(result).toMatchObject({ kind: 'refused', code: 'OUTCOME_UNVERIFIED' });
    if (result.kind === 'refused') {
      expect(result.message).toContain('Do not retry blindly');
      expect(result.message).not.toMatch(/preserved/iu);
    }
  });
});

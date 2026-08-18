// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import { describe, expect, it } from 'vitest';
import { createReadFixture } from '../fixtures/capabilities.js';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import {
  createCapabilityDispatcher,
  defineWriteCapability
} from '../../src/capabilities/kernel.js';
import type {
  CapabilityDefinition,
  MutationEnvelopeServices
} from '../../src/capabilities/types.js';

function recordingServices(touched: string[]): MutationEnvelopeServices {
  return {
    lock: {
      acquire: (targetKey) => {
        touched.push(`lock.acquire:${targetKey}`);
        return Promise.resolve({
          release: () => {
            touched.push('lock.release');
            return Promise.resolve('released');
          }
        });
      }
    },
    backup: {
      create: () => {
        touched.push('backup.create');
        return Promise.resolve({ backupId: 'backup-1' });
      },
      exists: () => {
        touched.push('backup.exists');
        return Promise.resolve(true);
      }
    },
    audit: {
      record: () => {
        touched.push('audit.record');
      }
    }
  };
}

function envelopeCapability(): CapabilityDefinition {
  return defineWriteCapability({
    id: 'test.envelope',
    mcpName: 'test_envelope',
    title: 'Test envelope',
    description: 'A synthetic firewall write used to prove the read-only bypass path.',
    inputSchema: z.object({ value: z.string() }).strict(),
    outputSchema: z.object({ applied: z.string() }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    },
    transports: ['stdio', 'http'],
    policy: {
      effect: 'firewall-write',
      resourceScopes: ['test.envelope'],
      requiredFeatureFlags: [],
      backup: 'strict',
      audit: 'required',
      confirmation: 'none',
      timeoutMs: 1000,
      redactFields: []
    },
    preflight: () => Promise.resolve({ effectPlanDigest: 'plan', observedStateDigest: 'state' }),
    handler: ({ value }: { readonly value: string }) => Promise.resolve({ applied: value }),
    verifyOutcome: () => Promise.resolve(true)
  });
}

describe('mutation envelope bypass paths', () => {
  it('hides and refuses an envelope capability under READ_ONLY before any service runs', async () => {
    const touched: string[] = [];
    const dispatcher = createCapabilityDispatcher(
      new CapabilityCatalog([envelopeCapability()]),
      { readOnly: true, allowedResourceScopes: null, enabledFeatureFlags: new Set<never>() },
      undefined,
      {},
      {},
      recordingServices(touched)
    );

    expect(dispatcher.listExposed('stdio')).toHaveLength(0);
    expect(dispatcher.listExposed('http')).toHaveLength(0);

    const result = await dispatcher.dispatch(
      { name: 'test_envelope', arguments: { value: 'x' } },
      { transport: 'stdio' }
    );
    expect(result).toMatchObject({ kind: 'refused', code: 'READ_ONLY' });
    expect(touched).toEqual([]);
  });

  it('refuses a forged mutation name as an unknown capability', async () => {
    const touched: string[] = [];
    const dispatcher = createCapabilityDispatcher(
      new CapabilityCatalog([envelopeCapability()]),
      { readOnly: false, allowedResourceScopes: null, enabledFeatureFlags: new Set<never>() },
      undefined,
      {},
      {},
      recordingServices(touched)
    );

    const result = await dispatcher.dispatch(
      { name: 'stale_cached_mutation', arguments: { value: 'x' } },
      { transport: 'stdio' }
    );
    expect(result).toMatchObject({ kind: 'refused', code: 'UNKNOWN_CAPABILITY' });
    expect(touched).toEqual([]);
  });

  it('never touches envelope services when dispatching a read capability', async () => {
    const touched: string[] = [];
    const read = createReadFixture({ id: 'test.read', mcpName: 'test_read' });
    const dispatcher = createCapabilityDispatcher(
      new CapabilityCatalog([read, envelopeCapability()]),
      { readOnly: false, allowedResourceScopes: null, enabledFeatureFlags: new Set<never>() },
      undefined,
      {},
      {},
      recordingServices(touched)
    );

    const result = await dispatcher.dispatch(
      { name: 'test_read', arguments: { value: 'hello' } },
      { transport: 'stdio' }
    );
    expect(result).toEqual({ kind: 'success', output: { echoed: 'hello' } });
    expect(touched).toEqual([]);
  });
});

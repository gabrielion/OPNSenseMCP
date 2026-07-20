// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import { describe, expect, it } from 'vitest';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import {
  createCapabilityDispatcher,
  defineWriteCapability
} from '../../src/capabilities/kernel.js';
import type {
  CapabilityDefinition,
  CapabilityResult,
  MutationEnvelopeServices
} from '../../src/capabilities/types.js';

interface CapOptions {
  readonly preflightResults?: readonly { effectPlanDigest: string; observedStateDigest: string }[];
  readonly preflightThrow?: boolean;
  readonly handlerThrow?: boolean;
  readonly handlerDelayMs?: number;
  readonly verifyResult?: boolean;
  readonly verifyThrow?: boolean;
  readonly timeoutMs?: number;
}

function makeCapability(events: string[], opts: CapOptions = {}): CapabilityDefinition {
  const fallback = { effectPlanDigest: 'plan', observedStateDigest: 'state' };
  const preflights = opts.preflightResults ?? [fallback];
  let index = 0;
  return defineWriteCapability({
    id: 'test.envelope',
    mcpName: 'test_envelope',
    title: 'Test envelope',
    description: 'Exercise the synthetic mutation envelope with process-local state.',
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
      timeoutMs: opts.timeoutMs ?? 1000,
      redactFields: []
    },
    preflight: () => {
      events.push('preflight');
      if (opts.preflightThrow === true) return Promise.reject(new Error('preflight'));
      const result = preflights[Math.min(index, preflights.length - 1)] ?? fallback;
      index += 1;
      return Promise.resolve(result);
    },
    handler: async ({ value }: { readonly value: string }) => {
      events.push('handler');
      if (opts.handlerDelayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, opts.handlerDelayMs));
      }
      if (opts.handlerThrow === true) throw new Error('handler');
      return { applied: value };
    },
    verifyOutcome: () => {
      events.push('verify');
      if (opts.verifyThrow === true) return Promise.reject(new Error('verify'));
      return Promise.resolve(opts.verifyResult ?? true);
    }
  });
}

interface HarnessOptions {
  readonly lockNull?: boolean;
  readonly backupThrow?: boolean;
  readonly backupMissing?: boolean;
  readonly auditIntentThrow?: boolean;
}

interface Harness {
  readonly events: string[];
  readonly services: MutationEnvelopeServices;
  readonly createdBackups: Set<string>;
}

function makeHarness(opts: HarnessOptions = {}): Harness {
  const events: string[] = [];
  const createdBackups = new Set<string>();
  let backupCounter = 0;
  const services: MutationEnvelopeServices = {
    lock: {
      acquire: () => {
        events.push('lock.acquire');
        if (opts.lockNull === true) return Promise.resolve(null);
        return Promise.resolve({
          release: () => {
            events.push('lock.release');
            return Promise.resolve();
          }
        });
      }
    },
    backup: {
      create: () => {
        events.push('backup.create');
        if (opts.backupThrow === true) return Promise.reject(new Error('backup'));
        backupCounter += 1;
        const backupId = `backup-${String(backupCounter)}`;
        if (opts.backupMissing !== true) createdBackups.add(backupId);
        return Promise.resolve({ backupId });
      },
      exists: (backupId: string) => Promise.resolve(createdBackups.has(backupId))
    },
    audit: {
      record: (record) => {
        events.push(`audit.${record.phase}`);
        if (opts.auditIntentThrow === true && record.phase === 'intent') {
          throw new Error('audit');
        }
      }
    }
  };
  return { events, services, createdBackups };
}

function dispatch(
  capability: CapabilityDefinition,
  services: MutationEnvelopeServices
): Promise<CapabilityResult> {
  const dispatcher = createCapabilityDispatcher(
    new CapabilityCatalog([capability]),
    { readOnly: false, allowedResourceScopes: null, enabledFeatureFlags: new Set<never>() },
    undefined,
    {},
    {},
    services
  );
  return dispatcher.dispatch(
    { name: 'test_envelope', arguments: { value: 'x' } },
    { transport: 'stdio' }
  );
}

describe('mutation envelope lifecycle', () => {
  it('runs the fixed order and returns the verified output on success', async () => {
    const harness = makeHarness();
    const result = await dispatch(makeCapability(harness.events), harness.services);
    expect(result).toEqual({ kind: 'success', output: { applied: 'x' } });
    expect(harness.events).toEqual([
      'lock.acquire',
      'preflight',
      'audit.intent',
      'backup.create',
      'preflight',
      'handler',
      'verify',
      'audit.result',
      'lock.release'
    ]);
    expect(harness.createdBackups.size).toBe(1);
  });

  it('fails closed when the target lock is unavailable, before preflight or audit', async () => {
    const harness = makeHarness({ lockNull: true });
    const result = await dispatch(makeCapability(harness.events), harness.services);
    expect(result).toMatchObject({ kind: 'refused', code: 'LOCK_UNAVAILABLE' });
    expect(harness.events).toEqual(['lock.acquire']);
  });

  it('fails closed on preflight failure without recording an audit intent', async () => {
    const harness = makeHarness();
    const result = await dispatch(
      makeCapability(harness.events, { preflightThrow: true }),
      harness.services
    );
    expect(result).toMatchObject({ kind: 'refused', code: 'PREFLIGHT_FAILED' });
    expect(harness.events).toEqual(['lock.acquire', 'preflight', 'lock.release']);
  });

  it('fails closed and releases the lock when the audit intent cannot be recorded', async () => {
    const harness = makeHarness({ auditIntentThrow: true });
    const result = await dispatch(makeCapability(harness.events), harness.services);
    expect(result).toMatchObject({ kind: 'refused', code: 'EXECUTION_FAILED' });
    expect(harness.events).toEqual(['lock.acquire', 'preflight', 'audit.intent', 'lock.release']);
  });

  it('refuses the write when the strict backup fails, before the handler runs', async () => {
    const harness = makeHarness({ backupThrow: true });
    const result = await dispatch(makeCapability(harness.events), harness.services);
    expect(result).toMatchObject({ kind: 'refused', code: 'BACKUP_FAILED' });
    expect(harness.events).toEqual([
      'lock.acquire',
      'preflight',
      'audit.intent',
      'backup.create',
      'audit.result',
      'lock.release'
    ]);
  });

  it('refuses the write when the backup cannot be verified to exist', async () => {
    const harness = makeHarness({ backupMissing: true });
    const result = await dispatch(makeCapability(harness.events), harness.services);
    expect(result).toMatchObject({ kind: 'refused', code: 'BACKUP_FAILED' });
    expect(harness.events).not.toContain('handler');
  });

  it('preserves the backup and refuses when the state changes after preflight', async () => {
    const harness = makeHarness();
    const result = await dispatch(
      makeCapability(harness.events, {
        preflightResults: [
          { effectPlanDigest: 'plan', observedStateDigest: 's1' },
          { effectPlanDigest: 'plan', observedStateDigest: 's2' }
        ]
      }),
      harness.services
    );
    expect(result).toMatchObject({ kind: 'refused', code: 'STATE_REVALIDATION_FAILED' });
    expect(harness.events).toEqual([
      'lock.acquire',
      'preflight',
      'audit.intent',
      'backup.create',
      'preflight',
      'audit.result',
      'lock.release'
    ]);
    expect(harness.createdBackups.size).toBe(1);
  });

  it('preserves the backup and reports EXECUTION_FAILED when the apply phase throws', async () => {
    const harness = makeHarness();
    const result = await dispatch(
      makeCapability(harness.events, { handlerThrow: true }),
      harness.services
    );
    expect(result).toMatchObject({ kind: 'refused', code: 'EXECUTION_FAILED' });
    expect(harness.events.at(-1)).toBe('lock.release');
    expect(harness.events).toContain('handler');
    expect(harness.createdBackups.size).toBe(1);
  });

  it('reports an indeterminate outcome when the apply phase is aborted by timeout', async () => {
    const harness = makeHarness();
    const result = await dispatch(
      makeCapability(harness.events, { timeoutMs: 20, handlerDelayMs: 200 }),
      harness.services
    );
    expect(result).toMatchObject({ kind: 'refused', code: 'OUTCOME_INDETERMINATE' });
    if (result.kind === 'refused') {
      expect(result.message).toContain('preserved');
      expect(Object.keys(result).sort()).toEqual(['code', 'kind', 'message']);
    }
    expect(harness.createdBackups.size).toBe(1);
  });

  it('refuses as unverified when outcome verification returns false or throws', async () => {
    for (const opts of [{ verifyResult: false }, { verifyThrow: true }]) {
      const harness = makeHarness();
      const result = await dispatch(makeCapability(harness.events, opts), harness.services);
      expect(result).toMatchObject({ kind: 'refused', code: 'OUTCOME_UNVERIFIED' });
      expect(harness.events.at(-1)).toBe('lock.release');
      expect(harness.createdBackups.size).toBe(1);
    }
  });
});

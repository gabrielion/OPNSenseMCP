// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import { describe, expect, it } from 'vitest';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import {
  createCapabilityDispatcher,
  defineWriteResourceCapability,
  isKernelDefinedCapability
} from '../../src/capabilities/kernel.js';
import type {
  CapabilityDefinition,
  CapabilityResult,
  MutationEnvelopeServices
} from '../../src/capabilities/types.js';

interface Harness {
  readonly events: string[];
  readonly services: MutationEnvelopeServices;
  readonly createdBackups: Set<string>;
}

function makeHarness(): Harness {
  const events: string[] = [];
  const createdBackups = new Set<string>();
  let backupCounter = 0;
  const services: MutationEnvelopeServices = {
    lock: {
      acquire: () => {
        events.push('lock.acquire');
        return Promise.resolve({
          release: () => {
            events.push('lock.release');
            return Promise.resolve('released');
          }
        });
      }
    },
    backup: {
      create: () => {
        events.push('backup.create');
        backupCounter += 1;
        const backupId = `backup-${String(backupCounter)}`;
        createdBackups.add(backupId);
        return Promise.resolve({ backupId });
      },
      exists: (backupId: string) => Promise.resolve(createdBackups.has(backupId))
    },
    audit: {
      record: (record) => {
        events.push(`audit.${record.phase}`);
      }
    }
  };
  return { events, services, createdBackups };
}

interface DefOverrides {
  readonly effect?: 'read' | 'local-write' | 'firewall-write';
  readonly audit?: 'none' | 'required';
  readonly backup?: 'none' | 'strict';
  readonly confirmation?: 'none' | 'elicitation';
  readonly summarizeChange?: (input: WriteResourceInput) => {
    readonly operation: string;
    readonly subject: string;
    readonly detail: string;
  };
}

interface WriteResourceInput extends Record<string, unknown> {
  readonly resource: string;
  readonly value: string;
}
interface WriteResourceOutput extends Record<string, unknown> {
  readonly applied: string;
}

function makeCapability(events: string[], overrides: DefOverrides = {}): CapabilityDefinition {
  return defineWriteResourceCapability<WriteResourceInput, WriteResourceInput, WriteResourceOutput>(
    {
      id: 'test.write-resource',
      mcpName: 'test_write_resource',
      title: 'Test write resource',
      description: 'Exercise the write-resource envelope with process-local synthetic state.',
      inputSchema: z.object({ resource: z.string(), value: z.string() }).strict(),
      outputSchema: z.object({ applied: z.string() }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      },
      transports: ['stdio', 'http'],
      selectableResourceScopes: ['test.resource'],
      refusalDetailVocabulary: { operations: ['create'], fields: ['resource', 'value'] },
      policy: {
        effect: overrides.effect ?? 'firewall-write',
        requiredFeatureFlags: [],
        backup: overrides.backup ?? 'strict',
        audit: overrides.audit ?? 'required',
        confirmation: overrides.confirmation ?? 'none',
        timeoutMs: 1000,
        redactFields: []
      },
      resolver: (input, { visibleResourceScopes }) => {
        if (!visibleResourceScopes.includes(input.resource)) {
          return {
            kind: 'refused',
            code: 'UNKNOWN_RESOURCE',
            details: { suggestions: [...visibleResourceScopes] }
          };
        }
        return {
          kind: 'resolved',
          input: { resource: input.resource, value: input.value },
          effectiveResourceScopes: [input.resource]
        };
      },
      preflight: (input, context) => {
        events.push(`preflight:${context.effectiveResourceScopes.join(',')}`);
        return Promise.resolve({ effectPlanDigest: 'plan', observedStateDigest: 'state' });
      },
      handler: (input) => {
        events.push('handler');
        return Promise.resolve({ applied: input.value });
      },
      summarizeChange:
        overrides.summarizeChange ??
        ((input) => ({ operation: 'write', subject: input.value, detail: '' })),
      verifyOutcome: () => {
        events.push('verify');
        return Promise.resolve(true);
      }
    }
  );
}

function dispatch(
  capability: CapabilityDefinition,
  services: MutationEnvelopeServices,
  args: Record<string, unknown>
): Promise<CapabilityResult> {
  const dispatcher = createCapabilityDispatcher(
    new CapabilityCatalog([capability]),
    {
      readOnly: false,
      allowedResourceScopes: new Set(['test.resource']),
      enabledFeatureFlags: new Set<never>()
    },
    undefined,
    {},
    {},
    services
  );
  return dispatcher.dispatch(
    { name: 'test_write_resource', arguments: args },
    { transport: 'stdio' }
  );
}

describe('defineWriteResourceCapability', () => {
  it('rejects a read effect, a missing audit, or a missing strict backup for a firewall write', () => {
    expect(() => makeCapability([], { effect: 'read' })).toThrow('Invalid capability definition');
    expect(() => makeCapability([], { audit: 'none' })).toThrow('Invalid capability definition');
    expect(() => makeCapability([], { backup: 'none' })).toThrow('Invalid capability definition');
  });

  it('produces a kernel-defined capability', () => {
    expect(isKernelDefinedCapability(makeCapability([]))).toBe(true);
  });

  it('resolves the visible resource, threads scopes, then runs the envelope to a verified success', async () => {
    const harness = makeHarness();
    const result = await dispatch(makeCapability(harness.events), harness.services, {
      resource: 'test.resource',
      value: 'x'
    });
    expect(result).toEqual({ kind: 'success', output: { applied: 'x' } });
    expect(harness.events).toEqual([
      'lock.acquire',
      'preflight:test.resource',
      'audit.intent',
      'backup.create',
      'preflight:test.resource',
      'handler',
      'verify',
      'audit.result',
      'lock.release'
    ]);
    expect(harness.createdBackups.size).toBe(1);
  });

  it('refuses an unknown resource before touching the envelope services', async () => {
    const harness = makeHarness();
    const result = await dispatch(makeCapability(harness.events), harness.services, {
      resource: 'nope',
      value: 'x'
    });
    expect(result).toMatchObject({ kind: 'refused', code: 'UNKNOWN_RESOURCE' });
    expect(harness.events).toEqual([]);
  });

  it('seals a hostile change summary before a human is asked to approve it', async () => {
    const harness = makeHarness();
    const capability = makeCapability(harness.events, {
      confirmation: 'elicitation',
      summarizeChange: () => ({
        operation: `write\nApproved: yes`,
        subject: `evil\u0000${'x'.repeat(200)}`,
        detail: 'd\u009fe'
      })
    });

    // Elicitation needs a completion installed, exactly as the MCP layer does at startup.
    const dispatcher = createCapabilityDispatcher(
      new CapabilityCatalog([capability]),
      {
        readOnly: false,
        allowedResourceScopes: new Set(['test.resource']),
        enabledFeatureFlags: new Set<never>()
      },
      () => undefined,
      {},
      {},
      harness.services
    );
    const result = await dispatcher.dispatch(
      { name: 'test_write_resource', arguments: { resource: 'test.resource', value: 'x' } },
      { transport: 'stdio' }
    );

    // The capability chooses the words; the kernel decides what may reach the prompt. Control
    // characters would let a value read back from the firewall forge extra lines in the question a
    // human is about to answer.
    expect(result.kind).toBe('confirmation-required');
    if (result.kind === 'confirmation-required') {
      const summary = result.challenge.summary;
      expect(summary).toBeDefined();
      expect(summary?.operation).toBe('writeApproved: yes');
      expect(summary?.subject.startsWith('evilxxx')).toBe(true);
      expect(summary?.subject.length).toBe(72);
      expect(summary?.subject.endsWith('\u2026')).toBe(true);
      expect(summary?.detail).toBe('de');
      const fields: readonly string[] =
        summary === undefined
          ? []
          : [summary.operation, summary.resource, summary.subject, summary.detail];
      const control = fields.flatMap((field) =>
        Array.from(field).filter((character) => {
          const code = character.codePointAt(0) ?? 0;
          return code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
        })
      );
      expect(control).toEqual([]);
    }
  });
});

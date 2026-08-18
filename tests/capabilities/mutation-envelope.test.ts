// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import { describe, expect, it, vi } from 'vitest';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import {
  createCapabilityDispatcher,
  defineWriteCapability
} from '../../src/capabilities/kernel.js';
import type {
  AuditRecord,
  BackupRequest,
  CapabilityDefinition,
  CapabilityResult,
  LockHandle,
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

// A service call that answers nothing of its own accord: the only way out is the signal the envelope
// hands it. That is what "bounded" can mean in JavaScript — a pending promise cannot be cancelled, so
// a runner bounds a call by giving it a signal that actually fires and by refusing to keep waiting on
// one that does not. A fake that ignored its signal as well would be unboundable by construction and
// would prove nothing about the envelope.
function neverAnswers<T>(signal: AbortSignal): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    const abandon = () => {
      reject(new Error('aborted'));
    };
    if (signal.aborted) {
      abandon();
      return;
    }
    signal.addEventListener('abort', abandon, { once: true });
  });
}

// The losing side of the acquire race: a manager that answers, with a REAL handle, at the instant
// the runner stops waiting for it. Resolving on the abort rather than on a timer makes that
// interleaving exact instead of merely likely, and the handle it grants is a genuine one — this
// process is the holder from that moment on, whether or not anything is still listening.
function grantedOnAbort(events: string[], signal: AbortSignal): Promise<LockHandle | null> {
  const handle: LockHandle = {
    release: (releaseSignal) => {
      events.push('leak-release');
      void releaseSignal;
      return Promise.resolve('released');
    }
  };
  if (signal.aborted) return Promise.resolve(handle);
  return new Promise<LockHandle | null>((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        resolve(handle);
      },
      { once: true }
    );
  });
}

interface HarnessOptions {
  readonly lockNull?: boolean;
  readonly lockThrow?: boolean;
  readonly lockNeverAnswers?: boolean;
  // Grants the lock at the instant the acquire's bound fires — the one interleaving where the
  // envelope holds the process-wide target lock without ever having been told it does.
  readonly lockGrantedAfterBound?: boolean;
  readonly lockReleaseReport?: 'released' | 'unconfirmed';
  readonly backupThrow?: boolean;
  readonly backupMissing?: boolean;
  readonly backupCreateNeverAnswers?: boolean;
  readonly backupExistsNeverAnswers?: boolean;
  // Fires inside `backup.create`, i.e. mid-envelope with the lock held and the backup in flight.
  readonly cancelDuringBackup?: () => void;
  readonly auditIntentThrow?: boolean;
  readonly auditResultThrow?: boolean;
}

interface Harness {
  readonly events: string[];
  readonly services: MutationEnvelopeServices;
  readonly createdBackups: Set<string>;
  // What the envelope actually ASKED the backup service for, in order — the fake captures the
  // request instead of discarding it, so a test can assert the fields the spec's durable backup
  // metadata needs rather than only that a backup happened.
  readonly backupRequests: BackupRequest[];
  // Every record the envelope wrote, in order — captured so a test can assert on record fields
  // (the transactionId) and not only on the phase event string.
  readonly auditRecords: AuditRecord[];
}

function makeHarness(opts: HarnessOptions = {}): Harness {
  const events: string[] = [];
  const createdBackups = new Set<string>();
  const backupRequests: BackupRequest[] = [];
  const auditRecords: AuditRecord[] = [];
  let backupCounter = 0;
  const services: MutationEnvelopeServices = {
    lock: {
      acquire: (_targetKey, signal) => {
        events.push('lock.acquire');
        if (opts.lockNeverAnswers === true) return neverAnswers<LockHandle | null>(signal);
        if (opts.lockThrow === true) return Promise.reject(new Error('lock'));
        if (opts.lockNull === true) return Promise.resolve(null);
        if (opts.lockGrantedAfterBound === true) return grantedOnAbort(events, signal);
        return Promise.resolve({
          release: (signal) => {
            events.push('lock.release');
            // A fake that cannot fail has nothing to do with the bound it is given; the parameter is
            // named so the contract's shape is exercised, and discarded so nothing depends on it.
            void signal;
            return Promise.resolve(opts.lockReleaseReport ?? 'released');
          }
        });
      }
    },
    backup: {
      create: (request, signal) => {
        events.push('backup.create');
        backupRequests.push(request);
        opts.cancelDuringBackup?.();
        if (opts.backupCreateNeverAnswers === true) {
          return neverAnswers<{ readonly backupId: string }>(signal);
        }
        if (opts.backupThrow === true) return Promise.reject(new Error('backup'));
        backupCounter += 1;
        const backupId = `backup-${String(backupCounter)}`;
        if (opts.backupMissing !== true) createdBackups.add(backupId);
        return Promise.resolve({ backupId });
      },
      exists: (backupId, signal) => {
        if (opts.backupExistsNeverAnswers === true) return neverAnswers<boolean>(signal);
        return Promise.resolve(createdBackups.has(backupId));
      }
    },
    audit: {
      record: (record) => {
        events.push(`audit.${record.phase}`);
        auditRecords.push(record);
        if (opts.auditIntentThrow === true && record.phase === 'intent') throw new Error('audit');
        if (opts.auditResultThrow === true && record.phase === 'result') throw new Error('audit');
      }
    }
  };
  return { events, services, createdBackups, backupRequests, auditRecords };
}

function dispatch(
  capability: CapabilityDefinition,
  services: MutationEnvelopeServices,
  signal?: AbortSignal
): Promise<CapabilityResult> {
  const dispatcher = createCapabilityDispatcher(
    new CapabilityCatalog([capability]),
    {
      readOnly: false,
      // A write is never authorized by an absent allow-list, so the envelope harness names its
      // own scope explicitly.
      allowedResourceScopes: new Set(['test.envelope']),
      enabledFeatureFlags: new Set<never>()
    },
    undefined,
    {},
    {},
    services
  );
  return dispatcher.dispatch(
    { name: 'test_envelope', arguments: { value: 'x' } },
    { transport: 'stdio', ...(signal === undefined ? {} : { signal }) }
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
    // The backup is what a failed write would be restored FROM, so the request has to name what a
    // restore needs: the locked target, the capability and arguments that asked for it, and the
    // sealed digests the write was authorized against. 'plan'/'state' are the harness preflight's
    // own digests, so a request built from anything but the sealed preflight would not match.
    expect(harness.backupRequests).toHaveLength(1);
    const request = harness.backupRequests[0];
    expect(request?.targetKey).toBe('opnsense-config');
    expect(request?.capabilityId).toBe('test.envelope');
    expect(request?.mcpName).toBe('test_envelope');
    expect(request?.effectiveResourceScopes).toEqual(['test.envelope']);
    expect(request?.observedStateDigest).toBe('state');
    expect(request?.effectPlanDigest).toBe('plan');
    expect(request?.argumentsSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('threads one transactionId through both audits and the backup request', async () => {
    const harness = makeHarness();
    await dispatch(makeCapability(harness.events), harness.services);
    const txids = harness.auditRecords.map((r) => r.transactionId);
    expect(txids[0]).toMatch(/^[0-9a-f]{32}$/u);
    expect(new Set(txids).size).toBe(1);
    expect(harness.backupRequests[0]?.transactionId).toBe(txids[0]);
  });

  it('generates a fresh transactionId for each envelope run', async () => {
    // Two runs through one process: an id hoisted to module scope or a memoized helper would keep
    // every assertion above green while making the durable join meaningless. The pin is per-RUN
    // freshness — each run keeps one id for itself and does not share it with the previous run.
    const harness = makeHarness();
    const capability = makeCapability(harness.events);
    await dispatch(capability, harness.services);
    await dispatch(capability, harness.services);
    expect(harness.auditRecords).toHaveLength(4);
    const ids = harness.auditRecords.map((r) => r.transactionId);
    expect(new Set(ids.slice(0, 2)).size).toBe(1);
    expect(new Set(ids.slice(2)).size).toBe(1);
    expect(ids[2]).not.toBe(ids[0]);
    expect(harness.backupRequests[1]?.transactionId).toBe(ids[2]);
  });

  it('awaits the lock release after the terminal audit and tolerates its report', async () => {
    // The release is reported, not obeyed, this slice: an unconfirmed release changes neither the
    // verified success nor the step order. Making it a refusal is a later, deliberate change.
    const harness = makeHarness({ lockReleaseReport: 'unconfirmed' });
    const result = await dispatch(makeCapability(harness.events), harness.services);
    expect(result).toEqual({ kind: 'success', output: { applied: 'x' } });
    expect(harness.events.slice(-2)).toEqual(['audit.result', 'lock.release']);
  });

  it('releases the lock and propagates the failure when an envelope step throws', async () => {
    // No step is expected to throw. If one ever does, the process-wide target lock must still be
    // released, or every later write on this process refuses LOCK_UNAVAILABLE until a restart.
    const harness = makeHarness();
    const hostilePreflight = {
      get effectPlanDigest(): string {
        throw new Error('sealed digest');
      },
      observedStateDigest: 'state'
    };
    await expect(
      dispatch(
        makeCapability(harness.events, { preflightResults: [hostilePreflight] }),
        harness.services
      )
    ).rejects.toThrow('sealed digest');
    expect(harness.events).toEqual(['lock.acquire', 'preflight', 'lock.release']);
  });

  it('fails closed when the target lock is unavailable, before preflight or audit', async () => {
    // Refused and throwing acquisitions are one refusal: nothing is held, so nothing is released,
    // and no audit intent is written for a write that never started.
    for (const opts of [{ lockNull: true }, { lockThrow: true }]) {
      const harness = makeHarness(opts);
      const result = await dispatch(makeCapability(harness.events), harness.services);
      expect(result).toMatchObject({ kind: 'refused', code: 'LOCK_UNAVAILABLE' });
      expect(harness.events).toEqual(['lock.acquire']);
    }
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

  it('still reports the verified success when the terminal audit record throws', async () => {
    // A pin, not an endorsement: today a failed RESULT audit is swallowed, so a verified write is
    // still a success and the step order is unchanged. Slice 3 turns this into AUDIT_RESULT_FAILED,
    // which must then be a deliberate edit of this test rather than silent drift.
    const harness = makeHarness({ auditResultThrow: true });
    const result = await dispatch(makeCapability(harness.events), harness.services);
    expect(result).toEqual({ kind: 'success', output: { applied: 'x' } });
    expect(harness.events.slice(-2)).toEqual(['audit.result', 'lock.release']);
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
    expect(harness.events.at(-1)).toBe('lock.release');
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
      // The backup is still taken, and the operator is still told not to retry blindly; what the
      // message may NOT do is promise a preserved backup, because the store is removed at shutdown
      // until P0-C makes it durable.
      expect(result.message).toContain('Do not retry blindly');
      expect(result.message).not.toMatch(/preserved/iu);
      expect(Object.keys(result).sort()).toEqual(['code', 'kind', 'message']);
    }
    expect(harness.events.at(-1)).toBe('lock.release');
    expect(harness.createdBackups.size).toBe(1);
  });

  it('refuses LOCK_UNAVAILABLE instead of hanging when the lock never answers', async () => {
    // Every envelope service call is bounded by the capability's own timeout. A lock manager that
    // stalls used to stall the whole dispatch — the acquire was handed a signal that could never
    // fire — with nothing acquired, nothing to release, and no answer for the caller. The bound maps
    // to the same LOCK_UNAVAILABLE the null and the throwing acquire already report.
    const harness = makeHarness({ lockNeverAnswers: true });
    const result = await dispatch(
      makeCapability(harness.events, { timeoutMs: 20 }),
      harness.services
    );
    expect(result).toMatchObject({ kind: 'refused', code: 'LOCK_UNAVAILABLE' });
    expect(harness.events).toEqual(['lock.acquire']);
  }, 2000);

  it('releases a lock granted as the acquire bound fired rather than leaking it', async () => {
    // The interleaving the bound above cannot rule out: the manager grants the lock at the instant
    // the runner gives up on it. The dispatch must still refuse — nothing downstream was ever told
    // it holds the lock — but the handle is not the runner's to discard. A dropped handle holds the
    // process-wide target lock until the process restarts, which is the same leak the bound was
    // added to prevent, arriving one tick later. The release is fire-and-forget: it cannot change a
    // verdict that is already decided, so it is awaited here instead of ordered before the answer.
    const harness = makeHarness({ lockGrantedAfterBound: true });
    const result = await dispatch(
      makeCapability(harness.events, { timeoutMs: 20 }),
      harness.services
    );
    expect(result).toMatchObject({ kind: 'refused', code: 'LOCK_UNAVAILABLE' });
    await vi.waitFor(() => {
      expect(harness.events).toContain('leak-release');
    });
    // And nothing else ran: no preflight, no audit and no backup for a write that never started.
    expect(harness.events).toEqual(['lock.acquire', 'leak-release']);
  }, 2000);

  it('refuses BACKUP_FAILED instead of hanging when the backup never answers', async () => {
    // The backup is the one envelope call that does real network I/O before the first write, and it
    // runs with the target lock held: an unbounded stall here holds the lock for the life of the
    // process. Timing out reports exactly what a throwing create reports.
    const harness = makeHarness({ backupCreateNeverAnswers: true });
    const result = await dispatch(
      makeCapability(harness.events, { timeoutMs: 20 }),
      harness.services
    );
    expect(result).toMatchObject({ kind: 'refused', code: 'BACKUP_FAILED' });
    expect(harness.events).toEqual([
      'lock.acquire',
      'preflight',
      'audit.intent',
      'backup.create',
      'audit.result',
      'lock.release'
    ]);
  }, 2000);

  it('refuses BACKUP_FAILED instead of hanging when the backup check never answers', async () => {
    // `exists` gets its OWN bounded runner rather than sharing the create call's signal: a shared
    // signal would hand the second call a budget the first one already spent, which is the same
    // unbounded step under a new name. A verification that cannot answer is not a verified backup.
    const harness = makeHarness({ backupExistsNeverAnswers: true });
    const result = await dispatch(
      makeCapability(harness.events, { timeoutMs: 20 }),
      harness.services
    );
    expect(result).toMatchObject({ kind: 'refused', code: 'BACKUP_FAILED' });
    expect(harness.events).toEqual([
      'lock.acquire',
      'preflight',
      'audit.intent',
      'backup.create',
      'audit.result',
      'lock.release'
    ]);
  }, 2000);

  it('still releases the lock when the caller cancels mid-envelope', async () => {
    // Step 9's release is bounded like every other service call but deliberately NOT against the
    // caller's signal: the bounded runner returns on an already-aborted caller signal WITHOUT
    // invoking its thunk, so binding the release to it would skip the release exactly when the
    // envelope unwinds a cancelled write — leaking the process-wide target lock until restart.
    // The refusal CODE is deliberately not pinned here: a fake that ignores its abort and succeeds
    // anyway moves which step first notices the cancellation, and this test's subject is the
    // release, not the verdict.
    const controller = new AbortController();
    const harness = makeHarness({
      cancelDuringBackup: () => {
        controller.abort();
      }
    });
    const result = await dispatch(
      makeCapability(harness.events),
      harness.services,
      controller.signal
    );
    expect(result).toMatchObject({ kind: 'refused' });
    expect(harness.events.at(-1)).toBe('lock.release');
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

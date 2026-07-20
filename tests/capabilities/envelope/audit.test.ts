// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { createBoundedAuditSink } from '../../../src/capabilities/envelope/audit.js';
import type { AuditRecord } from '../../../src/capabilities/types.js';

function record(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    capabilityId: 'test.write',
    mcpName: 'test_write',
    effect: 'firewall-write',
    argumentsSha256: 'a'.repeat(64),
    effectiveResourceScopes: ['test.scope'],
    phase: 'intent',
    outcome: 'intent',
    ...overrides
  };
}

describe('bounded audit sink', () => {
  it('stores redacted records and returns immutable copies', () => {
    const sink = createBoundedAuditSink();
    sink.record(record());
    sink.record(record({ phase: 'result', outcome: 'success', backupId: 'b1' }));
    const snapshot = sink.snapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot[1]).toMatchObject({ phase: 'result', outcome: 'success', backupId: 'b1' });
    expect(Object.isFrozen(snapshot[0])).toBe(true);
  });

  it('rejects a record carrying a field outside the fixed shape', () => {
    const sink = createBoundedAuditSink();
    expect(() => {
      sink.record({ ...record(), rawArguments: { secret: 'x' } } as unknown as AuditRecord);
    }).toThrow('unexpected field');
    expect(sink.snapshot()).toHaveLength(0);
  });

  it('rejects a malformed record', () => {
    const sink = createBoundedAuditSink();
    expect(() => {
      sink.record(record({ phase: 'unknown' as unknown as AuditRecord['phase'] }));
    }).toThrow('malformed');
  });

  it('bounds the ring buffer to its capacity', () => {
    const sink = createBoundedAuditSink(2);
    sink.record(record({ outcome: 'one' }));
    sink.record(record({ outcome: 'two' }));
    sink.record(record({ outcome: 'three' }));
    const outcomes = sink.snapshot().map((entry) => entry.outcome);
    expect(outcomes).toEqual(['two', 'three']);
  });
});

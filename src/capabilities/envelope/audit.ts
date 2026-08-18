// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AuditRecord, AuditSink, CapabilityEffect } from '../types.js';

export interface BoundedAuditSink extends AuditSink {
  snapshot(): readonly AuditRecord[];
}

const DEFAULT_CAPACITY = 1024;
const ALLOWED_KEYS = Object.freeze([
  'capabilityId',
  'mcpName',
  'effect',
  'argumentsSha256',
  'effectiveResourceScopes',
  'phase',
  'outcome',
  'transactionId',
  'backupId'
]);
const EFFECTS: ReadonlySet<CapabilityEffect> = new Set(['read', 'local-write', 'firewall-write']);

function isBoundedString(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

// The single shape authority for every audit sink: it defensively rejects any record that carries a key
// outside the fixed AuditRecord shape (so raw arguments or handler output can never enter a log) and returns
// a frozen copy the caller cannot mutate afterwards. The copy's keys are inserted in ALLOWED_KEYS order, so a
// sink that serializes it — the durable monthly log does — writes the same canonical line every time. Both
// messages are fixed sentences: an audit refusal names the fault, never the record that caused it.
export function toValidatedAuditRecord(record: AuditRecord): AuditRecord {
  const value = record as unknown as Record<string, unknown>;
  if (Object.keys(value).some((key) => !ALLOWED_KEYS.includes(key))) {
    throw new Error('Audit record contains an unexpected field');
  }
  const scopes = value.effectiveResourceScopes;
  if (
    !isBoundedString(value.capabilityId) ||
    !isBoundedString(value.mcpName) ||
    typeof value.effect !== 'string' ||
    !EFFECTS.has(value.effect as CapabilityEffect) ||
    !isBoundedString(value.argumentsSha256) ||
    !Array.isArray(scopes) ||
    scopes.some((scope) => typeof scope !== 'string') ||
    (value.phase !== 'intent' && value.phase !== 'result') ||
    !isBoundedString(value.outcome) ||
    !isBoundedString(value.transactionId) ||
    (value.backupId !== undefined && !isBoundedString(value.backupId))
  ) {
    throw new Error('Audit record is malformed');
  }
  return Object.freeze({
    capabilityId: value.capabilityId,
    mcpName: value.mcpName,
    effect: value.effect as CapabilityEffect,
    argumentsSha256: value.argumentsSha256,
    effectiveResourceScopes: Object.freeze([...(scopes as string[])]),
    phase: value.phase,
    outcome: value.outcome,
    transactionId: value.transactionId,
    ...(value.backupId === undefined ? {} : { backupId: value.backupId })
  });
}

// A redacted, bounded, append-only audit ring buffer over that shape. It keeps the most recent records in
// memory for tests and fixtures; the durable monthly log is its sibling, not its replacement.
export function createBoundedAuditSink(capacity: number = DEFAULT_CAPACITY): BoundedAuditSink {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error('Invalid audit sink capacity');
  }
  const records: AuditRecord[] = [];
  return Object.freeze({
    record(record: AuditRecord): void {
      records.push(toValidatedAuditRecord(record));
      if (records.length > capacity) records.shift();
    },
    snapshot(): readonly AuditRecord[] {
      return Object.freeze([...records]);
    }
  });
}

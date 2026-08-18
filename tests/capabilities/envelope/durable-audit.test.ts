// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { Buffer } from 'node:buffer';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDurableAuditSink } from '../../../src/capabilities/envelope/durable-audit.js';
import type * as NodeFs from 'node:fs';
import type { AuditRecord } from '../../../src/capabilities/types.js';

// The durability guarantee is the whole point of this sink, and `fsyncSync` cannot be spied on a
// node builtin namespace (ESM exports are not configurable). The module mock delegates every call
// to the real filesystem and only counts the fsyncs — and, when armed, raises an errno whose
// message carries a path, so a leaked message is caught by the assertions below.
const fsync = vi.hoisted(() => ({ calls: 0, fault: false }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return {
    ...actual,
    default: actual,
    fsyncSync(fd: number): void {
      fsync.calls += 1;
      if (fsync.fault) throw new Error('EIO: i/o error, fsync /private/state/audit/segment.jsonl');
      actual.fsyncSync(fd);
    }
  };
});

// The whole of a stored line, in the order the sink writes it. The exact-key assertions below are
// what keep raw arguments, handler output and credentials out of the audit log for good.
const ALLOWED_KEYS = [
  'capabilityId',
  'mcpName',
  'effect',
  'argumentsSha256',
  'effectiveResourceScopes',
  'phase',
  'outcome',
  'transactionId',
  'backupId'
];
const INTENT_KEYS = ALLOWED_KEYS.filter((key) => key !== 'backupId');
const MAX_LINE_BYTES = 4096;

let root: string;
let auditDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'opnsense-durable-audit-'));
  // Deliberately not created: the sink owns the directory it writes into.
  auditDir = join(root, 'audit');
  fsync.calls = 0;
  fsync.fault = false;
});

afterEach(() => {
  fsync.fault = false;
  rmSync(root, { recursive: true, force: true });
});

function record(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    capabilityId: 'opnsense.create',
    mcpName: 'opn_create',
    effect: 'firewall-write',
    argumentsSha256: 'a'.repeat(64),
    effectiveResourceScopes: ['firewall.alias'],
    phase: 'intent',
    outcome: 'intent',
    transactionId: 'd'.repeat(32),
    ...overrides
  };
}

// The segment the sink must choose: the UTC month, so a host in any timezone files a record under
// the same name as every other host.
function segmentPath(): string {
  return join(auditDir, `${new Date().toISOString().slice(0, 7)}.jsonl`);
}

function lineBytes(entry: AuditRecord): number {
  return Buffer.byteLength(`${JSON.stringify(entry)}\n`, 'utf8');
}

// A record whose serialized line is exactly `totalBytes` long, padded through the one field the
// audit shape does not bound: the scope list.
function sizedRecord(totalBytes: number): AuditRecord {
  const padding = totalBytes - lineBytes(record({ effectiveResourceScopes: [''] }));
  return record({ effectiveResourceScopes: ['x'.repeat(padding)] });
}

function readLines(): Record<string, unknown>[] {
  const text = readFileSync(segmentPath(), 'utf8');
  expect(text.endsWith('\n')).toBe(true);
  return text
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('durable audit sink', () => {
  // Leg (a) and leg (d) together: two records, one monthly segment, canonical JSON lines in append
  // order, a 0600 file in a 0700 directory, and an fsync per record — plus the directory fsync that
  // makes the newly created segment's own name durable (3 = 2 file fsyncs + 1 on the fresh segment).
  it('appends one canonical line per record to the UTC monthly segment', () => {
    const sink = createDurableAuditSink(auditDir);
    sink.record(record());
    sink.record(record({ phase: 'result', outcome: 'success', backupId: 'b'.repeat(32) }));

    expect(readdirSync(auditDir)).toEqual([`${new Date().toISOString().slice(0, 7)}.jsonl`]);
    const lines = readLines();
    expect(lines).toHaveLength(2);
    expect(Object.keys(lines[0] ?? {})).toEqual(INTENT_KEYS);
    expect(Object.keys(lines[1] ?? {})).toEqual(ALLOWED_KEYS);
    expect(lines[0]).toEqual({
      capabilityId: 'opnsense.create',
      mcpName: 'opn_create',
      effect: 'firewall-write',
      argumentsSha256: 'a'.repeat(64),
      effectiveResourceScopes: ['firewall.alias'],
      phase: 'intent',
      outcome: 'intent',
      transactionId: 'd'.repeat(32)
    });
    expect(lines[1]).toMatchObject({
      phase: 'result',
      outcome: 'success',
      backupId: 'b'.repeat(32),
      transactionId: 'd'.repeat(32)
    });

    const segment = lstatSync(segmentPath());
    expect(segment.isFile()).toBe(true);
    expect(segment.isSymbolicLink()).toBe(false);
    expect(segment.mode & 0o777).toBe(0o600);
    expect(lstatSync(auditDir).mode & 0o777).toBe(0o700);
    expect(fsync.calls).toBe(3);
  });

  // Leg (d), the half a spy cannot prove: bytes that survive the sink that wrote them. A second
  // sink over the same directory continues the same segment rather than truncating it.
  it('continues the same segment from a fresh sink instance', () => {
    createDurableAuditSink(auditDir).record(record({ outcome: 'first' }));
    createDurableAuditSink(auditDir).record(record({ outcome: 'second' }));

    expect(readdirSync(auditDir)).toHaveLength(1);
    expect(readLines().map((line) => line.outcome)).toEqual(['first', 'second']);
  });

  // The line is serialized from the validated copy, never from the object the caller happened to
  // build, so every line of a segment has the same shape in the same order for a later reader.
  it('writes canonical key order whatever order the caller built the record in', () => {
    const shuffled: AuditRecord = {
      backupId: 'b'.repeat(32),
      transactionId: 'd'.repeat(32),
      outcome: 'success',
      phase: 'result',
      effectiveResourceScopes: ['firewall.alias'],
      argumentsSha256: 'a'.repeat(64),
      effect: 'firewall-write',
      mcpName: 'opn_create',
      capabilityId: 'opnsense.create'
    };
    createDurableAuditSink(auditDir).record(shuffled);

    expect(Object.keys(readLines()[0] ?? {})).toEqual(ALLOWED_KEYS);
  });

  // Leg (b), both sides of the bound: 4096 bytes is a line the sink writes, 4097 is a line it
  // refuses. The refusal lands before the segment is opened, so nothing partial reaches the log.
  it('accepts a line at the size limit and refuses the byte past it', () => {
    const sink = createDurableAuditSink(auditDir);
    const accepted = sizedRecord(MAX_LINE_BYTES);
    sink.record(accepted);
    expect(readFileSync(segmentPath()).byteLength).toBe(MAX_LINE_BYTES);

    let message = '';
    try {
      sink.record(sizedRecord(MAX_LINE_BYTES + 1));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe('Audit record exceeds the segment line limit');
    expect(message).not.toMatch(/\//u);
    expect(readFileSync(segmentPath()).byteLength).toBe(MAX_LINE_BYTES);
  });

  it('writes nothing at all when the oversized record is the first of a segment', () => {
    const sink = createDurableAuditSink(auditDir);
    expect(() => {
      sink.record(sizedRecord(MAX_LINE_BYTES + 1));
    }).toThrow('Audit record exceeds the segment line limit');
    expect(existsSync(segmentPath())).toBe(false);
    expect(fsync.calls).toBe(0);
  });

  // Leg (c). A second hard link is how a same-uid attacker keeps a handle on the audit trail after
  // the envelope believes it owns the only one, so the link count is part of the discipline. The
  // link is planted outside the audit directory so nothing but `nlink` moves.
  it('refuses a segment that was given a second hard link', () => {
    const sink = createDurableAuditSink(auditDir);
    sink.record(record());
    linkSync(segmentPath(), join(root, 'second-link.jsonl'));

    let message = '';
    try {
      sink.record(record({ phase: 'result', outcome: 'success' }));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe('Audit segment failed its integrity checks');
    expect(message).not.toMatch(/\//u);
    expect(readLines()).toHaveLength(1);
  });

  // A sink that followed the link would append the firewall's audit trail into a file of someone
  // else's choosing. The planted target is a plausible segment, so the symlink is the only fault.
  it('refuses a symlinked segment', () => {
    mkdirSync(auditDir, { recursive: true, mode: 0o700 });
    const planted = join(root, 'planted.jsonl');
    writeFileSync(planted, '', { mode: 0o600 });
    symlinkSync(planted, segmentPath());

    let message = '';
    try {
      createDurableAuditSink(auditDir).record(record());
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe('Durable audit append failed');
    expect(message).not.toMatch(/\//u);
    expect(readFileSync(planted, 'utf8')).toBe('');
  });

  // The mode of the segment is what governs who may read the audit trail; a widened one is a fault
  // of the same class as a second link, and appending to it would be endorsing it.
  it('refuses a segment whose mode was widened after the write', () => {
    const sink = createDurableAuditSink(auditDir);
    sink.record(record());
    chmodSync(segmentPath(), 0o644);

    expect(() => {
      sink.record(record({ phase: 'result', outcome: 'success' }));
    }).toThrow('Audit segment failed its integrity checks');
    expect(readLines()).toHaveLength(1);
  });

  // The opposite polarity to the backup store's `exists`: a backup that cannot be verified is
  // absent, but an audit line that cannot be made durable is a failure the caller must see. The
  // injected errno carries a path, and this module's contract is that its messages never do.
  it('refuses to report a record it could not make durable', () => {
    const sink = createDurableAuditSink(auditDir);
    fsync.fault = true;

    let message = '';
    try {
      sink.record(record());
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe('Durable audit append failed');
    expect(message).not.toMatch(/\//u);
    expect(fsync.calls).toBeGreaterThan(0);
  });

  // The ring's guard, enforced on the durable side too: a record carrying one more key than the
  // fixed shape is how raw arguments or handler output would reach a file that must hold none.
  it('rejects a record carrying a field outside the fixed shape', () => {
    const sink = createDurableAuditSink(auditDir);
    expect(() => {
      sink.record({ ...record(), rawArguments: { secret: 'x' } } as unknown as AuditRecord);
    }).toThrow('unexpected field');
    expect(existsSync(segmentPath())).toBe(false);
  });

  it('rejects a malformed record', () => {
    const sink = createDurableAuditSink(auditDir);
    expect(() => {
      sink.record(record({ phase: 'unknown' as unknown as AuditRecord['phase'] }));
    }).toThrow('malformed');
    expect(existsSync(segmentPath())).toBe(false);
  });
});

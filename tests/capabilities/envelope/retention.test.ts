// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { maintainRetention } from '../../../src/capabilities/envelope/retention.js';
import type * as NodeFs from 'node:fs';

// Durable deletion is half of what this module promises, and `fsyncSync` cannot be spied on a node
// builtin namespace (ESM exports are not configurable). The module mock delegates every call to the
// real filesystem and only counts the fsyncs — and, when armed, raises an errno whose message
// carries a path, so a leaked message is caught by the assertions below.
const fsync = vi.hoisted(() => ({ calls: 0, fault: false }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return {
    ...actual,
    default: actual,
    fsyncSync(fd: number): void {
      fsync.calls += 1;
      if (fsync.fault) {
        throw new Error('EIO: i/o error, fsync /private/state/targets/aaaa/backups');
      }
      actual.fsyncSync(fd);
    }
  };
});

const DAY_MS = 24 * 60 * 60 * 1000;
const CONFIG_XML = '<?xml version="1.0"?><opnsense/>';
// The two fixed sentences this module is allowed to report. Neither may ever carry a path, an id or
// a byte of the configuration, so every refusal leg asserts the message itself and not just a throw.
const STATE_CORRUPT = 'Durable state failed its retention checks';
const RETENTION_FAILED = 'Retention maintenance failed';

let root: string;
let backupsDir: string;
let auditDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'opnsense-retention-'));
  // Deliberately not created: a target that has never been mutated has neither, and retention must
  // be a no-op over it rather than a refusal.
  backupsDir = join(root, 'backups');
  auditDir = join(root, 'audit');
  fsync.calls = 0;
  fsync.fault = false;
});

afterEach(() => {
  fsync.fault = false;
  rmSync(root, { recursive: true, force: true });
});

function backupIdOf(index: number): string {
  return index.toString(16).padStart(32, '0');
}

// A disjoint hex range, so a leg that confuses the two ids cannot accidentally pass.
function transactionIdOf(index: number): string {
  return (index + 0x1000000).toString(16).padStart(32, '0');
}

// Backdated by construction: the age of a backup is read from the `createdAt` this module controls,
// so a deterministic ISO string is all a threshold leg needs — no sleeps, no clock mocking.
function isoAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

// The UTC month `n` months back, in the sink's segment spelling.
function segmentMonth(monthsAgo: number): string {
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
  return `${String(month.getUTCFullYear())}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`;
}

// The whole of what `config-backup.ts` publishes, so a fixture cannot pass by being thinner than the
// real file. Retention reads two of these fields; the rest are here to keep the fixture honest.
function metadataFor(index: number, ageDays: number): Record<string, unknown> {
  return {
    schemaVersion: 1,
    transactionId: transactionIdOf(index),
    backupId: backupIdOf(index),
    targetKey: 'opnsense-config',
    capabilityId: 'opnsense.create',
    mcpName: 'opn_create',
    argumentsSha256: 'a'.repeat(64),
    effectiveResourceScopes: ['firewall.alias'],
    observedStateDigest: 'b'.repeat(64),
    effectPlanDigest: 'c'.repeat(64),
    byteLength: CONFIG_XML.length,
    xmlSha256: 'd'.repeat(64),
    createdAt: isoAgo(ageDays)
  };
}

function writePrivateFile(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 });
  // The mode argument is masked by the umask and ignored outright for an existing file, so the bits
  // a permission-sensitive fixture depends on are planted explicitly.
  chmodSync(path, 0o600);
}

function seedBackupDirectory(index: number): string {
  const dir = join(backupsDir, backupIdOf(index));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function seedBackup(index: number, ageDays: number): string {
  const dir = seedBackupDirectory(index);
  writePrivateFile(join(dir, 'config.xml'), CONFIG_XML);
  writePrivateFile(join(dir, 'metadata.json'), JSON.stringify(metadataFor(index, ageDays)));
  return backupIdOf(index);
}

// The shape the durable sink writes, serialized the same way, so the parser under test is exercised
// against real lines rather than a two-field stand-in.
function auditLine(index: number, phase: 'intent' | 'result'): string {
  return `${JSON.stringify({
    capabilityId: 'opnsense.create',
    mcpName: 'opn_create',
    effect: 'firewall-write',
    argumentsSha256: 'a'.repeat(64),
    effectiveResourceScopes: ['firewall.alias'],
    phase,
    outcome: phase === 'intent' ? 'intent' : 'succeeded',
    transactionId: transactionIdOf(index)
  })}\n`;
}

function seedSegment(monthsAgo: number, lines: readonly string[]): string {
  mkdirSync(auditDir, { recursive: true, mode: 0o700 });
  const name = `${segmentMonth(monthsAgo)}.jsonl`;
  appendFileSync(join(auditDir, name), lines.join(''));
  chmodSync(join(auditDir, name), 0o600);
  return name;
}

// Seeds `count` backups whose ages come from `ageOf`, each with the intent and result lines that
// make its transaction resolved, and returns the ids in seeding order.
function seedResolvedBackups(count: number, ageOf: (index: number) => number): string[] {
  const ids: string[] = [];
  const lines: string[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(seedBackup(index, ageOf(index)));
    lines.push(auditLine(index, 'intent'), auditLine(index, 'result'));
  }
  seedSegment(0, lines);
  return ids;
}

function messageOf(run: () => void): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}

describe('durable state retention', () => {
  // The spec's two backup thresholds are a conjunction: 101 resolved snapshots all beyond 30 days
  // leave exactly one past the count, and that one is the only deletion allowed.
  it('purges a resolved backup only once it is beyond both the count and the age', () => {
    seedResolvedBackups(101, (index) => 40 + index);

    maintainRetention(root);

    const remaining = readdirSync(backupsDir);
    expect(remaining).toHaveLength(100);
    expect(remaining).not.toContain(backupIdOf(100));
    expect(remaining).toContain(backupIdOf(0));
    expect(remaining).toContain(backupIdOf(99));
  });

  // A transaction with no terminal result is one whose outcome nobody has established yet, so its
  // snapshot is the one thing a reconciliation still needs. It is the oldest here by a wide margin
  // and still outlives the purge, and it does not spend the count budget the resolved ones share.
  it('never purges a backup whose transaction has no terminal result', () => {
    seedResolvedBackups(101, (index) => 40 + index);
    const unresolved = seedBackup(500, 400);
    seedSegment(0, [auditLine(500, 'intent')]);

    maintainRetention(root);

    const remaining = readdirSync(backupsDir);
    expect(remaining).toHaveLength(101);
    expect(remaining).toContain(unresolved);
    expect(remaining).not.toContain(backupIdOf(100));
  });

  // The other half of the conjunction: being the 101st newest is not enough on its own.
  it('keeps a resolved backup inside 30 days even when it is beyond the newest 100', () => {
    const fresh = seedResolvedBackups(100, (index) => index / 10);
    const inside = seedBackup(200, 20);
    const beyond = seedBackup(201, 40);
    seedSegment(0, [
      auditLine(200, 'intent'),
      auditLine(200, 'result'),
      auditLine(201, 'intent'),
      auditLine(201, 'result')
    ]);

    maintainRetention(root);

    const remaining = readdirSync(backupsDir);
    expect(remaining).toHaveLength(101);
    expect(remaining).toContain(inside);
    expect(remaining).toContain(fresh[0]);
    expect(remaining).not.toContain(beyond);
  });

  // Scan first, delete second: a store this module cannot read in full is a store it must not start
  // taking snapshots out of, and the refusal names the fault rather than the file that caused it.
  it('refuses and deletes nothing when a stored metadata entry is corrupt', () => {
    seedResolvedBackups(101, (index) => 40 + index);
    const corrupt = seedBackupDirectory(500);
    writePrivateFile(join(corrupt, 'config.xml'), CONFIG_XML);
    writePrivateFile(join(corrupt, 'metadata.json'), 'not json at all');

    const message = messageOf(() => {
      maintainRetention(root);
    });

    expect(message).toBe(STATE_CORRUPT);
    expect(message).not.toMatch(/\//u);
    const remaining = readdirSync(backupsDir);
    expect(remaining).toHaveLength(102);
    expect(remaining).toContain(backupIdOf(100));
    expect(fsync.calls).toBe(0);
  });

  it('refuses when an audit line cannot be parsed', () => {
    seedResolvedBackups(101, (index) => 40 + index);
    seedSegment(0, ['{"transactionId":"broken"\n']);

    const message = messageOf(() => {
      maintainRetention(root);
    });

    expect(message).toBe(STATE_CORRUPT);
    expect(message).not.toMatch(/\//u);
    expect(readdirSync(backupsDir)).toHaveLength(101);
  });

  // The sink refuses to write a line above 4096 bytes, so a longer one in a segment was not written
  // by it. The line is valid JSON, which is what keeps this leg about the bound and not the parser,
  // and it is the only line in its segment, so it is handed over whole in a single read rather than
  // caught while it is still an over-long unterminated remainder.
  it('refuses an audit line longer than the segment line limit', () => {
    seedSegment(0, [
      `${JSON.stringify({
        capabilityId: 'opnsense.create',
        mcpName: 'opn_create',
        effect: 'firewall-write',
        argumentsSha256: 'a'.repeat(64),
        effectiveResourceScopes: ['firewall.alias'],
        phase: 'result',
        outcome: 'x'.repeat(5000),
        transactionId: transactionIdOf(0)
      })}\n`
    ]);

    expect(
      messageOf(() => {
        maintainRetention(root);
      })
    ).toBe(STATE_CORRUPT);
  });

  // A tail without its newline is a torn or edited segment: the sink appends whole lines and fsyncs
  // them, so what it wrote always ends in one.
  it('refuses a segment whose last line was never terminated', () => {
    seedSegment(0, [auditLine(0, 'intent').trimEnd()]);

    expect(
      messageOf(() => {
        maintainRetention(root);
      })
    ).toBe(STATE_CORRUPT);
  });

  // Age comes from the segment name, which bounds the newest record the file can hold, and a
  // segment holding an unresolved transaction is preserved however old it is.
  it('purges audit segments beyond 365 days only when every transaction in them is resolved', () => {
    const old = seedSegment(18, [auditLine(1, 'intent'), auditLine(1, 'result')]);
    const oldUnresolved = seedSegment(17, [auditLine(2, 'intent')]);
    const recent = seedSegment(3, [auditLine(3, 'intent'), auditLine(3, 'result')]);

    maintainRetention(root);

    const remaining = readdirSync(auditDir);
    expect(remaining).not.toContain(old);
    expect(remaining.sort()).toEqual([oldUnresolved, recent].sort());
  });

  // The terminal line may land in a later segment than the intent, which is the ordinary case for a
  // mutation that spans a month boundary: resolution is a property of the whole trail, not a file.
  it('resolves a transaction whose terminal line landed in a later segment', () => {
    const old = seedSegment(18, [auditLine(1, 'intent')]);
    seedSegment(17, [auditLine(1, 'result')]);

    maintainRetention(root);

    expect(readdirSync(auditDir)).not.toContain(old);
  });

  it('leaves a target directory that has never been mutated untouched', () => {
    maintainRetention(root);

    expect(readdirSync(root)).toEqual([]);
    expect(fsync.calls).toBe(0);
  });

  // The single-backup case the envelope's own tests exercise: inside both thresholds by
  // construction, so the first mutation of a target's life must not touch anything.
  it('retains a lone fresh backup and syncs nothing', () => {
    const ids = seedResolvedBackups(1, () => 0.1);

    maintainRetention(root);

    expect(readdirSync(backupsDir)).toEqual(ids);
    expect(fsync.calls).toBe(0);
  });

  // A purge that is not on the platters is a purge a crash can undo, and a store that keeps
  // resurrecting snapshots the audit has already closed is exactly what retention exists to bound.
  it('makes its deletions durable', () => {
    seedResolvedBackups(101, (index) => 40 + index);

    maintainRetention(root);

    expect(fsync.calls).toBeGreaterThanOrEqual(1);
  });

  // The errno raised here carries the private path of the state root, and this module's contract is
  // that no such message ever reaches its caller.
  it('reports a deletion that cannot be made durable as a static refusal', () => {
    seedResolvedBackups(101, (index) => 40 + index);
    fsync.fault = true;

    const message = messageOf(() => {
      maintainRetention(root);
    });

    expect(message).toBe(RETENTION_FAILED);
    expect(message).not.toMatch(/\//u);
  });

  // A purge unlinks the configuration first, so the residue of a crash between the two unlinks is a
  // metadata-only directory: this module dates it exactly as before and finishes what it started.
  it('completes a purge that crashed after the configuration was unlinked', () => {
    seedResolvedBackups(101, (index) => 40 + index);
    rmSync(join(backupsDir, backupIdOf(100), 'config.xml'));

    maintainRetention(root);

    const remaining = readdirSync(backupsDir);
    expect(remaining).toHaveLength(100);
    expect(remaining).not.toContain(backupIdOf(100));
  });

  // The next window of the same crash: both files gone, the directory not yet removed. Completing
  // it is provably lossless because rmdir refuses a directory that still holds anything.
  it('removes the empty directory a crashed purge left behind', () => {
    seedBackupDirectory(500);

    maintainRetention(root);

    expect(readdirSync(backupsDir)).toEqual([]);
    expect(fsync.calls).toBe(1);
  });

  // Publication renames a complete staging directory into place, so a published backup always has
  // both files. Configuration bytes with no metadata beside them are therefore not residue this
  // module produced, and it refuses rather than deleting a file it was never able to read.
  it('refuses a backup directory holding a configuration it cannot date', () => {
    const orphan = seedBackupDirectory(500);
    writePrivateFile(join(orphan, 'config.xml'), CONFIG_XML);

    const message = messageOf(() => {
      maintainRetention(root);
    });

    expect(message).toBe(STATE_CORRUPT);
    expect(readdirSync(join(backupsDir, backupIdOf(500)))).toEqual(['config.xml']);
  });

  // Residue of a crashed publication is named so that it cannot be mistaken for a backup, and an
  // entry no reader will ever claim as one is not an entry retention may read or date.
  it('ignores store entries that are not published backups', () => {
    seedResolvedBackups(1, () => 0.1);
    mkdirSync(join(backupsDir, '.staging-0123456789abcdef'), { mode: 0o700 });

    maintainRetention(root);

    expect(readdirSync(backupsDir)).toContain('.staging-0123456789abcdef');
  });
});

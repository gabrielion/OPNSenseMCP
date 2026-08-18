// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  openSync,
  readSync,
  readdirSync,
  rmdirSync,
  unlinkSync
} from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import type { Stats } from 'node:fs';

const BACKUPS_DIRECTORY = 'backups';
const AUDIT_DIRECTORY = 'audit';
const CONFIG_FILE = 'config.xml';
const METADATA_FILE = 'metadata.json';
// The published names of the store, and only those: a staging directory left by a crashed
// publication is deliberately spelled so that it does not match.
const BACKUP_ID_PATTERN = /^[0-9a-f]{32}$/u;
const TRANSACTION_ID_PATTERN = /^[0-9a-f]{32}$/u;
// The sink's UTC month, with the month itself constrained, so a name that could never have been
// written by it is not read, dated or deleted as if it had been.
const SEGMENT_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])\.jsonl$/u;
// Exactly what `new Date().toISOString()` produces, which is what `config-backup.ts` stamps: a
// hand-edited timestamp is not silently accepted as a date.
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const RETAINED_BACKUP_COUNT = 100;
const BACKUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SEGMENT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
// The same ceilings the writers enforce: 8 KiB is far above what a fixed set of ids, digests and
// lengths needs, and the sink refuses to append a line above one page.
const MAX_METADATA_BYTES = 8 * 1024;
const MAX_LINE_BYTES = 4096;
const MAX_FIELD_LENGTH = 512;
// Two pages of line limit: a segment of any size is read in bounded memory, because nothing beyond
// one chunk plus one line is ever held at once.
const READ_CHUNK_BYTES = 8 * 1024;
const NEWLINE = 0x0a;
const NOFOLLOW = (constants.O_NOFOLLOW as number | undefined) ?? 0;
const O_DIRECTORY = (constants.O_DIRECTORY as number | undefined) ?? 0;

const STATE_CORRUPT = 'Durable state failed its retention checks';
const RETENTION_FAILED = 'Retention maintenance failed';

// Every failure this module reports is one of its own two fixed sentences. A raw fs errno carries
// the private path of the state root in its message and a raw JSON parse error carries a slice of
// the text it choked on, so neither may ever escape as itself.
class RetentionError extends Error {}

function retentionError(message: string): RetentionError {
  return new RetentionError(message);
}

interface AuditEntry {
  readonly transactionId: string;
  readonly phase: 'intent' | 'result';
}

interface AuditSegment {
  readonly name: string;
  // The first instant of the month after the one the name states: the exclusive upper bound of
  // every record the file can hold.
  readonly upperBoundMs: number;
  readonly transactionIds: ReadonlySet<string>;
}

interface AuditIndex {
  readonly resolved: ReadonlySet<string>;
  readonly segments: readonly AuditSegment[];
}

interface BackupFacts {
  readonly transactionId: string;
  readonly createdAtMs: number;
}

interface PurgeCandidate {
  readonly name: string;
  readonly createdAtMs: number;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function isBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_LENGTH;
}

function isPhase(value: unknown): value is 'intent' | 'result' {
  return value === 'intent' || value === 'result';
}

function ownedByThisUser(uid: number): boolean {
  return uid === process.getuid?.();
}

function closeQuietly(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // A failed close invalidates nothing that already succeeded, and it must not become the
    // reported outcome of an otherwise good read.
  }
}

function fsyncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | O_DIRECTORY | NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeQuietly(fd);
  }
}

// A target whose first mutation is still in flight has neither directory yet, and retention over it
// is nothing rather than a refusal. Every other fault is one this module must not paper over.
function listStore(path: string): readonly string[] {
  try {
    return readdirSync(path);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return [];
    throw retentionError(RETENTION_FAILED);
  }
}

// One open, one fstat, one read, on the same descriptor: the checks and the bytes they vouch for
// come from the same inode even if the name is replaced between them.
function assertPrivateFile(stats: Stats): void {
  if (
    !stats.isFile() ||
    !ownedByThisUser(stats.uid) ||
    stats.nlink !== 1 ||
    (stats.mode & 0o777) !== 0o600
  ) {
    throw retentionError(STATE_CORRUPT);
  }
}

function readPrivateFile(path: string, maxBytes: number): Buffer {
  const fd = openSync(path, constants.O_RDONLY | NOFOLLOW);
  try {
    const stats = fstatSync(fd);
    assertPrivateFile(stats);
    if (stats.size > maxBytes) throw retentionError(STATE_CORRUPT);
    const buffer = Buffer.alloc(stats.size);
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    if (offset !== buffer.length) throw retentionError(STATE_CORRUPT);
    return buffer;
  } finally {
    closeQuietly(fd);
  }
}

function parseObject(bytes: Buffer): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw retentionError(STATE_CORRUPT);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw retentionError(STATE_CORRUPT);
  }
  return parsed as Record<string, unknown>;
}

// Only the two fields a retention decision turns on, held to the shape their writer guarantees: the
// transaction the snapshot belongs to and the moment this server stamped it. Everything else in the
// file is `exists`'s business, not this module's.
function parseBackupFacts(bytes: Buffer): BackupFacts {
  const record = parseObject(bytes);
  const transactionId = record.transactionId;
  const createdAt = record.createdAt;
  if (
    typeof transactionId !== 'string' ||
    !TRANSACTION_ID_PATTERN.test(transactionId) ||
    typeof createdAt !== 'string' ||
    !TIMESTAMP_PATTERN.test(createdAt)
  ) {
    throw retentionError(STATE_CORRUPT);
  }
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) throw retentionError(STATE_CORRUPT);
  return { transactionId, createdAtMs };
}

function parseAuditEntry(line: Buffer): AuditEntry {
  // The sink refuses to append a line above this, so a longer one was not written by it.
  if (line.byteLength > MAX_LINE_BYTES) throw retentionError(STATE_CORRUPT);
  const record = parseObject(line);
  const transactionId = record.transactionId;
  const phase = record.phase;
  if (!isBoundedString(transactionId) || !isPhase(phase)) throw retentionError(STATE_CORRUPT);
  return { transactionId, phase };
}

// Read forward in chunks and hand over whole lines. A segment holds a year of records, so it is
// never read into memory in one piece; what is bounded instead is the pending line, which the sink
// already bounds on the way in.
function forEachAuditEntry(path: string, visit: (entry: AuditEntry) => void): void {
  const fd = openSync(path, constants.O_RDONLY | NOFOLLOW);
  try {
    assertPrivateFile(fstatSync(fd));
    const chunk = Buffer.alloc(READ_CHUNK_BYTES);
    let pending = Buffer.alloc(0);
    for (;;) {
      const read = readSync(fd, chunk, 0, chunk.byteLength, null);
      if (read === 0) break;
      pending = Buffer.concat([pending, chunk.subarray(0, read)]);
      for (
        let newline = pending.indexOf(NEWLINE);
        newline !== -1;
        newline = pending.indexOf(NEWLINE)
      ) {
        visit(parseAuditEntry(pending.subarray(0, newline)));
        pending = pending.subarray(newline + 1);
      }
      if (pending.byteLength > MAX_LINE_BYTES) throw retentionError(STATE_CORRUPT);
    }
    // The sink appends whole lines and fsyncs them, so what it wrote always ends in a newline: a
    // tail without one is a torn or edited segment, and a trail this module cannot read in full is
    // one it must not draw a deletion from.
    if (pending.byteLength !== 0) throw retentionError(STATE_CORRUPT);
  } finally {
    closeQuietly(fd);
  }
}

// The whole trail, read before a single deletion is decided: resolution is a property of the trail
// and not of a file, because a mutation that spans a month boundary records its intent in one
// segment and its terminal outcome in the next.
function readAuditIndex(auditDir: string): AuditIndex {
  const resolved = new Set<string>();
  const segments: AuditSegment[] = [];
  for (const name of listStore(auditDir)) {
    const match = SEGMENT_PATTERN.exec(name);
    if (match === null) continue;
    const [, year, month] = match;
    if (year === undefined || month === undefined) continue;
    const transactionIds = new Set<string>();
    forEachAuditEntry(join(auditDir, name), (entry) => {
      transactionIds.add(entry.transactionId);
      if (entry.phase === 'result') resolved.add(entry.transactionId);
    });
    segments.push({
      name,
      // The month is 1-based in the name and 0-based in `Date.UTC`, so passing it unchanged names
      // the first instant of the following month. The name is the only source trusted for age: a
      // file timestamp is whatever the last toucher made it.
      upperBoundMs: Date.UTC(Number(year), Number(month), 1),
      transactionIds
    });
  }
  return { resolved, segments };
}

function readDirectoryEntries(path: string): readonly string[] {
  try {
    return readdirSync(path);
  } catch {
    throw retentionError(STATE_CORRUPT);
  }
}

function readBackupFacts(dir: string): BackupFacts | undefined {
  let bytes: Buffer;
  try {
    bytes = readPrivateFile(join(dir, METADATA_FILE), MAX_METADATA_BYTES);
  } catch (error) {
    if (error instanceof RetentionError) throw error;
    // Absent metadata is the one fault with an innocent explanation: the purge below unlinks the
    // configuration first, so this is what a crash between its two unlinks leaves.
    if (hasCode(error, 'ENOENT')) return undefined;
    throw retentionError(STATE_CORRUPT);
  }
  return parseBackupFacts(bytes);
}

// Newest first, and total: two snapshots stamped in the same millisecond must still order the same
// way on every run, or the same store could yield two different decisions.
function newestFirst(left: PurgeCandidate, right: PurgeCandidate): number {
  if (left.createdAtMs !== right.createdAtMs) return right.createdAtMs - left.createdAtMs;
  return left.name < right.name ? 1 : -1;
}

function unlinkIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw retentionError(RETENTION_FAILED);
  }
}

function removeDirectory(path: string): void {
  try {
    rmdirSync(path);
  } catch {
    throw retentionError(RETENTION_FAILED);
  }
}

// The configuration goes first, deliberately. The residue of a crash between the two unlinks is
// then a metadata-only directory, which the next pass dates exactly as it dated this one and purges
// again, and which `exists` already reports absent. The reverse order would leave configuration
// bytes behind with nothing that could ever claim them.
function removeBackup(dir: string): void {
  unlinkIfPresent(join(dir, CONFIG_FILE));
  unlinkIfPresent(join(dir, METADATA_FILE));
  removeDirectory(dir);
}

function purgeBackups(backupsDir: string, index: AuditIndex, now: number): void {
  const resolvedBackups: PurgeCandidate[] = [];
  const residue: string[] = [];
  // The scan runs to completion before the first unlink: a store this module cannot read in full is
  // a store it must not start taking snapshots out of.
  for (const name of listStore(backupsDir)) {
    if (!BACKUP_ID_PATTERN.test(name)) continue;
    const directory = join(backupsDir, name);
    const facts = readBackupFacts(directory);
    if (facts === undefined) {
      // Publication renames a complete staging directory into place, so a published backup always
      // carries both files. Without metadata the entry is the tail of a crashed purge — and only an
      // empty one is finished here, because a directory that still holds something is state this
      // module never produced and will not delete on a guess.
      if (readDirectoryEntries(directory).length !== 0) throw retentionError(STATE_CORRUPT);
      residue.push(name);
    } else if (index.resolved.has(facts.transactionId)) {
      // A transaction with no terminal result is one whose outcome nobody has established yet, so
      // its snapshot is the one thing a reconciliation still needs. It is never a candidate, and it
      // never spends the count budget the resolved ones share.
      resolvedBackups.push({ name, createdAtMs: facts.createdAtMs });
    }
  }
  resolvedBackups.sort(newestFirst);
  const doomed = resolvedBackups
    .slice(RETAINED_BACKUP_COUNT)
    .filter((candidate) => now - candidate.createdAtMs > BACKUP_RETENTION_MS);
  if (doomed.length === 0 && residue.length === 0) return;
  for (const candidate of doomed) removeBackup(join(backupsDir, candidate.name));
  for (const name of residue) removeDirectory(join(backupsDir, name));
  // One sync for the whole pass: what has to survive a crash is the removal of these entries from
  // this directory, and a directory sync after the last of them persists all of them. A pass that
  // dies before it gets here loses nothing but the work — the next one repeats exactly the same
  // decisions over exactly the same state.
  fsyncDirectory(backupsDir);
}

function purgeAuditSegments(auditDir: string, index: AuditIndex, now: number): void {
  const cutoff = now - SEGMENT_RETENTION_MS;
  const doomed = index.segments.filter(
    (segment) =>
      segment.upperBoundMs <= cutoff &&
      [...segment.transactionIds].every((id) => index.resolved.has(id))
  );
  if (doomed.length === 0) return;
  for (const segment of doomed) unlinkIfPresent(join(auditDir, segment.name));
  fsyncDirectory(auditDir);
}

/**
 * Bounds the durable state of one target, and refuses the mutation that is about to be attempted if
 * it cannot.
 *
 * It runs at the top of `backup.create` — envelope step 4, after the intent record is durable and
 * before the first firewall write. The spec words the hook point as "before a new intent"; running
 * it there would add a step to the kernel's fixed envelope, and the guarantee the sentence exists
 * for is kept exactly here: a throw from this function surfaces as `BACKUP_FAILED`, which refuses
 * the mutation before anything is written to the firewall. (Adjudicated 2026-08-18.)
 *
 * What it keeps. A backup is *resolved* once its transaction has a terminal `result` line anywhere
 * in the trail; an unresolved one is never purged automatically, because it is precisely the
 * snapshot a reconciliation of an undecided mutation would need. Resolved snapshots are kept until
 * they are past BOTH thresholds — beyond the newest 100 AND older than 30 days — so either one
 * alone retains. Audit segments are kept for 365 days, dated from the month in their own name, and
 * a segment holding an unresolved transaction is kept however old it is.
 *
 * How it fails. Loudly and closed: a metadata file or an audit line this module cannot read, an
 * unexpected file where a purge should have left an empty directory, a failed unlink or a failed
 * fsync all throw one of two fixed sentences carrying no path, no id and no configuration byte.
 * The scan of the store completes before the first unlink, so a refusal deletes nothing. Deletions
 * are durable: the parent directory is fsynced once the last entry has been removed from it, and
 * because the configuration is unlinked before the metadata that dates it, a purge interrupted by a
 * crash leaves only residue the next pass recognises and finishes.
 *
 * Insufficient space is refused before the first write too, but by the caller rather than here: a
 * store with no room left fails the very publication this maintenance precedes, and that failure is
 * already `BACKUP_FAILED`.
 */
export function maintainRetention(targetDir: string): void {
  try {
    // One clock for the whole pass, so a snapshot and the segment that resolves it are never dated
    // against two different "now"s.
    const now = Date.now();
    const auditDir = join(targetDir, AUDIT_DIRECTORY);
    const index = readAuditIndex(auditDir);
    // Backups first: dropping a segment removes the result lines that make a snapshot purgeable, so
    // the store is settled against the whole trail before any of the trail is dropped.
    purgeBackups(join(targetDir, BACKUPS_DIRECTORY), index, now);
    purgeAuditSegments(auditDir, index, now);
  } catch (error) {
    throw error instanceof RetentionError ? error : retentionError(RETENTION_FAILED);
  }
}

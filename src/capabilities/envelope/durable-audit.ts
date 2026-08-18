// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  writeSync
} from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import type { AuditRecord, AuditSink } from '../types.js';
import { toValidatedAuditRecord } from './audit.js';

// One page: large enough for the fixed shape with a long scope list, small enough that a single
// O_APPEND write of a whole line is the ordinary case rather than a hopeful one.
const MAX_LINE_BYTES = 4096;
const NOFOLLOW = (constants.O_NOFOLLOW as number | undefined) ?? 0;
const O_DIRECTORY = (constants.O_DIRECTORY as number | undefined) ?? 0;

const LINE_TOO_LARGE = 'Audit record exceeds the segment line limit';
const SEGMENT_REJECTED = 'Audit segment failed its integrity checks';
const APPEND_FAILED = 'Durable audit append failed';

// Every failure this module reports is one of its own fixed sentences. A raw fs errno carries the
// private path of the state root in its message, so it may never escape as itself.
class AuditError extends Error {}

function auditError(message: string): AuditError {
  return new AuditError(message);
}

function ownedByThisUser(uid: number): boolean {
  return uid === process.getuid?.();
}

function closeQuietly(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // A failed close invalidates nothing that already succeeded, and it must not become the
    // reported outcome of an append the kernel already made durable.
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

// The UTC month, so hosts in different timezones file the same record under the same segment name
// and a reader can date a segment from its name alone.
function segmentName(): string {
  return `${new Date().toISOString().slice(0, 7)}.jsonl`;
}

// The checks and the bytes they vouch for come from the same descriptor: the segment is validated
// after it is opened, so a name swapped between the open and the write cannot change what is
// appended to. Returns whether the segment is new — an empty one either was just created here or
// was created and never written, and in both cases its own name is not yet durable.
function assertPrivateSegment(fd: number): boolean {
  const stats = fstatSync(fd);
  if (
    !stats.isFile() ||
    !ownedByThisUser(stats.uid) ||
    stats.nlink !== 1 ||
    (stats.mode & 0o777) !== 0o600
  ) {
    throw auditError(SEGMENT_REJECTED);
  }
  return stats.size === 0;
}

function appendLine(auditDir: string, line: Buffer): void {
  try {
    mkdirSync(auditDir, { recursive: true, mode: 0o700 });
    const fd = openSync(
      join(auditDir, segmentName()),
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | NOFOLLOW,
      0o600
    );
    let fresh: boolean;
    try {
      fresh = assertPrivateSegment(fd);
      let offset = 0;
      while (offset < line.byteLength) {
        const written = writeSync(fd, line, offset, line.byteLength - offset);
        // A write that reports no progress would spin forever; the line is already partly on disk,
        // which is exactly the corruption this module refuses to hide.
        if (written <= 0) throw auditError(APPEND_FAILED);
        offset += written;
      }
      fsyncSync(fd);
    } finally {
      closeQuietly(fd);
    }
    // A segment that did not exist a moment ago is only as durable as its own name: the line is on
    // the platters, but the directory entry leading to it need not be until the directory is
    // synced. Once a month, therefore, and never on the hot path of an existing segment.
    if (fresh) fsyncDirectory(auditDir);
  } catch (error) {
    throw error instanceof AuditError ? error : auditError(APPEND_FAILED);
  }
}

// The envelope's durable audit trail: one canonical JSON line per record, appended to the monthly
// segment `<auditDir>/YYYY-MM.jsonl` (UTC), directory 0700, segment 0600, opened
// `O_APPEND | O_NOFOLLOW | O_CREAT` and validated on its own descriptor for owner, single link and
// mode before a byte is written, then fsynced before `record` returns. The line carries exactly the
// fields the audit shape names — ids, digests, scopes, phase, outcome and the optional backup id —
// because it is serialized from the same validated copy the in-memory ring stores, so raw
// arguments, handler output, credentials and endpoints have no path into the file.
//
// Its polarity is the opposite of the backup store's `exists`: a backup that cannot be verified is
// reported absent and the mutation is refused, whereas an audit line that is too large, or a
// segment that is not the private file this sink wrote, or an fsync that fails, throws. An audit
// trail that quietly loses records is worse than a mutation that does not happen, so no fault here
// is ever swallowed. It runs inside the target mutation lock (the envelope records intent and
// result within the lock/release span), so it adds no locking of its own.
export function createDurableAuditSink(auditDir: string): AuditSink {
  return Object.freeze({
    record(record: AuditRecord): void {
      const line = Buffer.from(`${JSON.stringify(toValidatedAuditRecord(record))}\n`, 'utf8');
      // Checked before the segment is touched, so an oversized record leaves no partial line and
      // no empty segment behind.
      if (line.byteLength > MAX_LINE_BYTES) throw auditError(LINE_TOO_LARGE);
      appendLine(auditDir, line);
    }
  });
}

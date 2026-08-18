// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeSync
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import type { BackupRequest, BackupService } from '../types.js';

const BACKUP_ID_BYTES = 16;
const STAGING_ID_BYTES = 16;
const BACKUP_ID_PATTERN = /^[0-9a-f]{32}$/u;
const TRANSACTION_ID_PATTERN = /^[0-9a-f]{32}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
// Exactly what `new Date().toISOString()` produces, so a stored timestamp is UTC by construction
// and a hand-edited one is not silently accepted as a date.
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_CONFIG_BACKUP_BYTES = 2 * 1024 * 1024;
// The metadata is a fixed set of ids, digests and lengths; 8 KiB is far above what those need and
// far below what an attempt to smuggle configuration bytes into the file would take.
const MAX_METADATA_BYTES = 8 * 1024;
const MAX_FIELD_LENGTH = 512;
const CONFIG_FILE = 'config.xml';
const METADATA_FILE = 'metadata.json';
const METADATA_SCHEMA_VERSION = 1;
// A staging name can never be mistaken for a published backup: a backup id is 32 hex characters and
// this is not, so a reader listing the store can tell a crashed publication from a snapshot.
const STAGING_PREFIX = '.staging-';
const METADATA_KEYS: readonly string[] = Object.freeze([
  'schemaVersion',
  'transactionId',
  'backupId',
  'targetKey',
  'capabilityId',
  'mcpName',
  'argumentsSha256',
  'effectiveResourceScopes',
  'observedStateDigest',
  'effectPlanDigest',
  'byteLength',
  'xmlSha256',
  'createdAt'
]);
const NOFOLLOW = (constants.O_NOFOLLOW as number | undefined) ?? 0;
const O_DIRECTORY = (constants.O_DIRECTORY as number | undefined) ?? 0;

const INVALID_BACKUP = 'Invalid OPNsense configuration backup';
const INTEGRITY_FAILED = 'Backup file failed its integrity checks';
const VERIFICATION_FAILED = 'Backup verification failed';
const PUBLICATION_FAILED = 'Backup publication failed';

// The envelope's strict backup snapshots the running OPNsense configuration before the first write. It is
// fetched over the closed HTTPS client and stored durably as `<backupsDir>/<backupId>/{config.xml,
// metadata.json}`: directory 0700, both files 0600, created O_EXCL in a private staging sibling and only ever
// opened O_NOFOLLOW. Publication writes and fsyncs both files, re-reads the bytes it just wrote, fsyncs the
// staging directory, renames it into place and fsyncs the store, so a backup is either absent or complete.
// The metadata persists the length and the sha256 of the configuration together with the transaction's safe
// ids and digests — never the configuration itself, never a credential, never an endpoint — which is what
// lets `exists` be a verification rather than a stat: it reopens both files, revalidates owner, link count
// and mode, and answers `true` only when the stored bytes still hash to the stored digest. Any fault at all
// is `false`. The stored bytes and the backupId never cross the MCP boundary.
export interface ConfigBackupSource {
  downloadConfigBackup(signal: AbortSignal): Promise<Uint8Array>;
}

interface BackupMetadata {
  readonly schemaVersion: number;
  readonly transactionId: string;
  readonly backupId: string;
  readonly targetKey: string;
  readonly capabilityId: string;
  readonly mcpName: string;
  readonly argumentsSha256: string;
  readonly effectiveResourceScopes: readonly string[];
  readonly observedStateDigest: string;
  readonly effectPlanDigest: string;
  readonly byteLength: number;
  readonly xmlSha256: string;
  readonly createdAt: string;
}

// Every failure this module reports is one of its own fixed sentences. A raw fs errno carries the
// private path of the state root in its message, and a raw JSON parse error carries a slice of the
// text it choked on, so neither may ever escape as itself.
class BackupError extends Error {}

function backupError(message: string): BackupError {
  return new BackupError(message);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_LENGTH;
}

function ownedByThisUser(uid: number): boolean {
  return uid === process.getuid?.();
}

function closeQuietly(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // A failed close invalidates nothing that already succeeded, and it must not become the
    // reported outcome of an otherwise good read or write.
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

// The published directory answers for itself: it is checked as the files are, because the mode of
// the directory is what governs who may replace an entry inside it.
function assertPrivateDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | O_DIRECTORY | NOFOLLOW);
  try {
    const stats = fstatSync(fd);
    if (!stats.isDirectory() || !ownedByThisUser(stats.uid) || (stats.mode & 0o777) !== 0o700) {
      throw backupError(INTEGRITY_FAILED);
    }
  } finally {
    closeQuietly(fd);
  }
}

// One open, one fstat, one read, on the same descriptor: the checks and the bytes they vouch for
// come from the same inode even if the name is replaced between them.
function readPrivateFile(path: string, maxBytes: number): Buffer {
  const fd = openSync(path, constants.O_RDONLY | NOFOLLOW);
  try {
    const stats = fstatSync(fd);
    if (
      !stats.isFile() ||
      !ownedByThisUser(stats.uid) ||
      stats.nlink !== 1 ||
      (stats.mode & 0o777) !== 0o600 ||
      stats.size > maxBytes
    ) {
      throw backupError(INTEGRITY_FAILED);
    }
    const buffer = Buffer.alloc(stats.size);
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    if (offset !== buffer.length) throw backupError(INTEGRITY_FAILED);
    return buffer;
  } finally {
    closeQuietly(fd);
  }
}

function writePrivateFile(path: string, content: Buffer): void {
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
    0o600
  );
  try {
    let offset = 0;
    while (offset < content.length) {
      offset += writeSync(fd, content, offset, content.length - offset, offset);
    }
    fsyncSync(fd);
  } finally {
    closeQuietly(fd);
  }
}

// The stored shape is validated as strictly as the audit ring validates a record, and for the same
// reason: an unexpected key is how configuration bytes or raw arguments would arrive in a file that
// is meant to hold none. What this module produces itself (the schema version, the id it minted,
// the length and digest it measured, the timestamp it stamped) is checked exactly; what the kernel
// supplies is checked as a bounded string, so a handler digest of a shape this module does not
// dictate cannot make a backup unverifiable after the fact.
function isBackupMetadata(value: unknown, backupId: string): value is BackupMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== METADATA_KEYS.length || METADATA_KEYS.some((key) => !(key in record))) {
    return false;
  }
  const scopes = record.effectiveResourceScopes;
  const byteLength = record.byteLength;
  return (
    record.schemaVersion === METADATA_SCHEMA_VERSION &&
    typeof record.transactionId === 'string' &&
    TRANSACTION_ID_PATTERN.test(record.transactionId) &&
    record.backupId === backupId &&
    isBoundedString(record.targetKey) &&
    isBoundedString(record.capabilityId) &&
    isBoundedString(record.mcpName) &&
    isBoundedString(record.argumentsSha256) &&
    Array.isArray(scopes) &&
    !scopes.some((scope: unknown) => !isBoundedString(scope)) &&
    isBoundedString(record.observedStateDigest) &&
    isBoundedString(record.effectPlanDigest) &&
    typeof byteLength === 'number' &&
    Number.isInteger(byteLength) &&
    byteLength > 0 &&
    byteLength <= MAX_CONFIG_BACKUP_BYTES &&
    typeof record.xmlSha256 === 'string' &&
    SHA256_PATTERN.test(record.xmlSha256) &&
    typeof record.createdAt === 'string' &&
    TIMESTAMP_PATTERN.test(record.createdAt)
  );
}

function parseMetadata(bytes: Uint8Array, backupId: string): BackupMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    throw backupError(INTEGRITY_FAILED);
  }
  if (!isBackupMetadata(parsed, backupId)) throw backupError(INTEGRITY_FAILED);
  return parsed;
}

function buildMetadata(
  request: BackupRequest,
  backupId: string,
  content: Buffer
): Readonly<BackupMetadata> {
  return Object.freeze({
    schemaVersion: METADATA_SCHEMA_VERSION,
    transactionId: request.transactionId,
    backupId,
    targetKey: request.targetKey,
    capabilityId: request.capabilityId,
    mcpName: request.mcpName,
    argumentsSha256: request.argumentsSha256,
    effectiveResourceScopes: [...request.effectiveResourceScopes],
    observedStateDigest: request.observedStateDigest,
    effectPlanDigest: request.effectPlanDigest,
    byteLength: content.byteLength,
    xmlSha256: sha256(content),
    createdAt: new Date().toISOString()
  });
}

function discardQuietly(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Best effort only: this runs while another failure is already being reported, and a staging
    // directory that outlives it is named so that a later reader can recognise it as residue.
  }
}

// Publication is all-or-nothing by construction: the snapshot is assembled and verified under a
// private staging name and enters the store as a single rename, so a crash anywhere before it
// leaves residue rather than a half-written backup that `exists` would have to adjudicate.
function publishBackup(
  rootDir: string,
  backupId: string,
  content: Buffer,
  metadataBytes: Buffer
): void {
  let stagingDir: string | undefined;
  try {
    mkdirSync(rootDir, { recursive: true, mode: 0o700 });
    const candidate = join(
      rootDir,
      `${STAGING_PREFIX}${randomBytes(STAGING_ID_BYTES).toString('hex')}`
    );
    // mkdir without `recursive` is the exclusive create, and the name is recorded for cleanup only
    // once it succeeds: a directory this call did not create is never a directory it may remove.
    mkdirSync(candidate, { mode: 0o700 });
    stagingDir = candidate;
    const configPath = join(stagingDir, CONFIG_FILE);
    writePrivateFile(configPath, content);
    writePrivateFile(join(stagingDir, METADATA_FILE), metadataBytes);
    // The write-path verification stays: the digest that `exists` will check later is only worth
    // its name if the bytes on disk matched it once, read back through a fresh descriptor.
    if (sha256(readPrivateFile(configPath, MAX_CONFIG_BACKUP_BYTES)) !== sha256(content)) {
      throw backupError(VERIFICATION_FAILED);
    }
    fsyncDirectory(stagingDir);
    renameSync(stagingDir, join(rootDir, backupId));
    // Inside the same guard as the rename, and for two reasons: the spec has `create` succeed only
    // once the store itself is durable, and an fs errno raised here would otherwise leave this
    // module carrying the private path in its message.
    fsyncDirectory(rootDir);
  } catch (error) {
    if (stagingDir !== undefined) discardQuietly(stagingDir);
    throw error instanceof BackupError ? error : backupError(PUBLICATION_FAILED);
  }
}

export function createOPNsenseConfigBackupService(
  source: ConfigBackupSource,
  rootDir: string
): BackupService {
  return Object.freeze({
    async create(
      request: BackupRequest,
      signal: AbortSignal
    ): Promise<{ readonly backupId: string }> {
      const downloaded = await source.downloadConfigBackup(signal);
      if (downloaded.byteLength === 0 || downloaded.byteLength > MAX_CONFIG_BACKUP_BYTES) {
        throw backupError(INVALID_BACKUP);
      }
      const content = Buffer.from(downloaded);
      const backupId = randomBytes(BACKUP_ID_BYTES).toString('hex');
      const metadataBytes = Buffer.from(
        JSON.stringify(buildMetadata(request, backupId, content)),
        'utf8'
      );
      // Written only if it can be read back: the same parser `exists` uses runs over the bytes
      // about to be stored, so a request this module could not verify later is refused now rather
      // than published as a snapshot that can never be confirmed.
      if (metadataBytes.byteLength > MAX_METADATA_BYTES) throw backupError(INVALID_BACKUP);
      try {
        parseMetadata(metadataBytes, backupId);
      } catch {
        throw backupError(INVALID_BACKUP);
      }
      publishBackup(rootDir, backupId, content, metadataBytes);
      return { backupId };
    },
    // Local filesystem work with nothing to abort, so the signal is accepted for the interface's
    // sake and deliberately unread (the repo's `void` idiom).
    exists(backupId: string, _signal: AbortSignal): Promise<boolean> {
      void _signal;
      if (!BACKUP_ID_PATTERN.test(backupId)) return Promise.resolve(false);
      try {
        const backupDir = join(rootDir, backupId);
        assertPrivateDirectory(backupDir);
        const metadata = parseMetadata(
          readPrivateFile(join(backupDir, METADATA_FILE), MAX_METADATA_BYTES),
          backupId
        );
        const content = readPrivateFile(join(backupDir, CONFIG_FILE), MAX_CONFIG_BACKUP_BYTES);
        return Promise.resolve(
          content.byteLength === metadata.byteLength && sha256(content) === metadata.xmlSha256
        );
      } catch {
        return Promise.resolve(false);
      }
    }
  });
}

#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn, spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, link, lstat, mkdir, open, unlink } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMAGE_SPEC = Object.freeze({
  release: '26.1.6',
  archiveName: 'OPNsense-26.1.6-nano-amd64.img.bz2',
  rawName: 'OPNsense-26.1.6-nano-amd64.img',
  url: 'https://mirror.wdc1.us.leaseweb.net/opnsense/releases/26.1/OPNsense-26.1.6-nano-amd64.img.bz2',
  archiveBytes: 556_631_322,
  archiveSha256: '3c16267c791abfc3e41d5249fcb0c245c03cb91e2f1aa4d53017f0f3454d03a1',
  rawMaxBytes: 8 * 1024 * 1024 * 1024
});

const COMMANDS = Object.freeze([
  ['qemu-system-x86_64', ['-accel', 'help']],
  ['qemu-img', ['--version']],
  ['curl', ['--version']],
  ['bzip2', ['--help']]
]);
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 5000;

const IMAGE_FAILURES = Object.freeze({
  ARCHIVE_TOO_LARGE: 'download exceeded the pinned archive size; retry image preparation',
  ARCHIVE_SIZE_MISMATCH: 'download size did not match the pinned archive; retry image preparation',
  ARCHIVE_DIGEST_MISMATCH: 'download digest did not match OPNsense 26.1.6; retry image preparation',
  DECOMPRESSION_FAILED: 'decompression failed, retry image preparation',
  DOWNLOAD_FAILED: 'download failed, check HTTPS access and retry image preparation',
  UNSAFE_CACHE_ENTRY: 'cache entry is unsafe; remove it manually before retrying',
  CACHE_UNAVAILABLE: 'user cache is unavailable; check its permissions and retry'
});

export class Product1bImageError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = 'Product1bImageError';
    this.code = code;
  }
}

function nodeStatus(nodeVersion) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(nodeVersion);
  if (match === null) return 'unsupported';
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major === 22 && minor >= 19 ? 'ready' : 'unsupported';
}

function commandStatus(result) {
  if (result.missing) return 'missing';
  return result.ok ? 'ready' : 'unavailable';
}

function selectAccelerator(platform, output) {
  const available = new Set(
    output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => /^(hvf|kvm|tcg)$/u.test(line))
  );
  const preference = platform === 'darwin' ? ['hvf', 'tcg'] : ['kvm', 'tcg'];
  return preference.find((accelerator) => available.has(accelerator)) ?? 'missing';
}

export function runDoctorCommand(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
    maxBuffer: 64 * 1024,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true
  });
  return {
    ok: result.status === 0,
    missing: result.error?.code === 'ENOENT',
    stdout: `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  };
}

export function doctorHost({
  platform = process.platform,
  nodeVersion = process.version,
  runCommand = runDoctorCommand
} = {}) {
  if (platform !== 'darwin' && platform !== 'linux') {
    return { ready: false, node: nodeStatus(nodeVersion), host: 'unsupported' };
  }

  const results = new Map();
  for (const [command, arguments_] of COMMANDS) {
    results.set(command, runCommand(command, arguments_));
  }
  const commands = Object.fromEntries(
    COMMANDS.map(([command]) => [command, commandStatus(results.get(command))])
  );
  const qemu = results.get('qemu-system-x86_64');
  const accelerator = qemu.ok ? selectAccelerator(platform, qemu.stdout) : 'missing';
  const node = nodeStatus(nodeVersion);
  const ready =
    node === 'ready' &&
    Object.values(commands).every((status) => status === 'ready') &&
    accelerator !== 'missing';

  return {
    ready,
    node,
    host: platform === 'darwin' ? 'macos' : 'linux',
    commands,
    accelerator
  };
}

function formatCommand(name, status) {
  if (status === 'ready') return `${name}: ready`;
  if (name === 'qemu-system-x86_64' || name === 'qemu-img') {
    return `${name}: ${status}; install the QEMU system and image utilities`;
  }
  return `${name}: ${status}; install ${name}`;
}

export function formatDoctorReport(report) {
  if (report.host === 'unsupported') {
    return 'Product 1B host: NOT READY\nHost: unsupported; use macOS or Linux\n';
  }

  const lines = [
    `Product 1B host: ${report.ready ? 'READY' : 'NOT READY'}`,
    report.node === 'ready'
      ? 'Node 22: ready'
      : 'Node 22: unsupported; install Node.js 22.19 or newer from the Node 22 line',
    `Host: ${report.host === 'macos' ? 'macOS' : 'Linux'}`,
    ...COMMANDS.map(([name]) => formatCommand(name, report.commands[name])),
    report.accelerator === 'missing'
      ? `Accelerator: missing; enable ${report.host === 'macos' ? 'hvf or tcg' : 'kvm or tcg'}`
      : `Accelerator: ${report.accelerator}`
  ];
  return `${lines.join('\n')}\n`;
}

function imageError(code, cause) {
  return new Product1bImageError(code, cause === undefined ? undefined : { cause });
}

function isMissing(error) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isUnsafeOpen(error) {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ELOOP' || error.code === 'EISDIR' || error.code === 'ENXIO')
  );
}

async function ensureCacheRoot(cacheRoot) {
  try {
    const before = await lstat(cacheRoot);
    if (!before.isDirectory() || before.isSymbolicLink()) throw imageError('UNSAFE_CACHE_ENTRY');
  } catch (error) {
    if (!isMissing(error)) {
      if (error instanceof Product1bImageError) throw error;
      throw imageError('CACHE_UNAVAILABLE', error);
    }
    try {
      await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
      const created = await lstat(cacheRoot);
      if (!created.isDirectory() || created.isSymbolicLink())
        throw imageError('UNSAFE_CACHE_ENTRY');
    } catch (mkdirError) {
      if (mkdirError instanceof Product1bImageError) throw mkdirError;
      throw imageError('CACHE_UNAVAILABLE', mkdirError);
    }
  }
}

function validateSpec(spec) {
  if (
    basename(spec.archiveName) !== spec.archiveName ||
    basename(spec.rawName) !== spec.rawName ||
    !spec.url.startsWith('https://') ||
    !Number.isSafeInteger(spec.archiveBytes) ||
    spec.archiveBytes <= 0 ||
    !/^[a-f\d]{64}$/u.test(spec.archiveSha256)
  ) {
    throw imageError('UNSAFE_CACHE_ENTRY');
  }
}

async function openRegular(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) {
      await handle.close();
      throw imageError('UNSAFE_CACHE_ENTRY');
    }
    return { handle, stat };
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    if (isMissing(error)) return undefined;
    if (error instanceof Product1bImageError) throw error;
    if (isUnsafeOpen(error)) throw imageError('UNSAFE_CACHE_ENTRY');
    throw imageError('CACHE_UNAVAILABLE', error);
  }
}

async function hashArchive(path, spec) {
  const opened = await openRegular(path);
  if (opened === undefined) return { state: 'missing' };
  const { handle, stat } = opened;
  try {
    if (stat.size > spec.archiveBytes) throw imageError('ARCHIVE_TOO_LARGE');
    if (stat.size !== spec.archiveBytes) throw imageError('ARCHIVE_SIZE_MISMATCH');
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < stat.size) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
      if (bytesRead === 0) throw imageError('ARCHIVE_SIZE_MISMATCH');
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    if (hash.digest('hex') !== spec.archiveSha256) {
      throw imageError('ARCHIVE_DIGEST_MISMATCH');
    }
    return { state: 'valid' };
  } finally {
    await handle.close();
  }
}

async function digestOpenedFile(opened, maxBytes) {
  const { handle, stat } = opened;
  try {
    if (stat.size <= 0 || stat.size > maxBytes) return undefined;
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < stat.size) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
      if (bytesRead === 0) return undefined;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return { bytes: stat.size, sha256: hash.digest('hex'), mode: stat.mode };
  } finally {
    await handle.close();
  }
}

async function readIntegrityProof(path) {
  const opened = await openRegular(path);
  if (opened === undefined) return undefined;
  try {
    if (opened.stat.size <= 0 || opened.stat.size > 1024 || (opened.stat.mode & 0o222) !== 0) {
      throw imageError('UNSAFE_CACHE_ENTRY');
    }
    const bytes = Buffer.alloc(opened.stat.size);
    const { bytesRead } = await opened.handle.read(bytes, 0, bytes.byteLength, 0);
    if (bytesRead !== bytes.byteLength) return undefined;
    const value = JSON.parse(bytes.toString('utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    return value;
  } catch (error) {
    if (error instanceof Product1bImageError) throw error;
    return undefined;
  } finally {
    await opened.handle.close();
  }
}

async function inspectRawBase(rawPath, proofPath, spec) {
  const proof = await readIntegrityProof(proofPath);
  const raw = await openRegular(rawPath);
  if (raw === undefined) return proof === undefined ? 'missing' : 'invalid';
  if ((raw.stat.mode & 0o222) !== 0) {
    await raw.handle.close();
    throw imageError('UNSAFE_CACHE_ENTRY');
  }
  const digest = await digestOpenedFile(raw, spec.rawMaxBytes);
  if (digest === undefined || proof === undefined) return 'invalid';
  return proof.schemaVersion === 1 &&
    proof.archiveSha256 === spec.archiveSha256 &&
    proof.rawBytes === digest.bytes &&
    proof.rawSha256 === digest.sha256
    ? 'valid'
    : 'invalid';
}

async function writeIntegrityProof(path, proof) {
  const handle = await open(path, constants.O_WRONLY | constants.O_NOFOLLOW);
  try {
    await handle.writeFile(`${JSON.stringify(proof)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, 0o444);
}

async function writeChunk(handle, chunk, position) {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(
      chunk,
      offset,
      chunk.byteLength - offset,
      position + offset
    );
    if (bytesWritten === 0) throw new Error('zero-byte write');
    offset += bytesWritten;
  }
}

async function streamCommand({ command, arguments_, destination, maxBytes, timeoutMs }) {
  const handle = await open(destination, constants.O_WRONLY | constants.O_NOFOLLOW);
  const child = spawn(command, arguments_, {
    env: { PATH: process.env.PATH ?? '' },
    shell: false,
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true
  });
  let timedOut = false;
  let spawnFailure;
  let streamFailure;
  let byteCount = 0;
  let finishTimeout;
  const timedCompletion = new Promise((resolve) => {
    finishTimeout = resolve;
  });
  const closed = new Promise((resolve) => {
    child.once('close', (status, signal) => resolve({ status, signal }));
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
    child.stdout.destroy();
    finishTimeout({ status: null, signal: 'timeout' });
  }, timeoutMs);
  timeout.unref();
  child.once('error', (error) => {
    spawnFailure = error;
  });

  try {
    try {
      for await (const value of child.stdout) {
        const chunk = Buffer.from(value);
        byteCount += chunk.byteLength;
        if (byteCount > maxBytes) throw imageError('ARCHIVE_TOO_LARGE');
        await writeChunk(handle, chunk, byteCount - chunk.byteLength);
      }
    } catch (error) {
      streamFailure = error;
      child.kill('SIGKILL');
    }
    const { status, signal } = await Promise.race([closed, timedCompletion]);
    if (streamFailure !== undefined) throw streamFailure;
    if (spawnFailure !== undefined || timedOut || status !== 0 || signal !== null) {
      throw spawnFailure ?? new Error('command failed');
    }
    await handle.sync();
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await handle.close();
  }
}

export async function downloadArchive({ destination, url, maxBytes }) {
  await streamCommand({
    command: 'curl',
    arguments_: [
      '--fail',
      '--silent',
      '--show-error',
      '--location',
      '--proto',
      '=https',
      '--proto-redir',
      '=https',
      '--max-filesize',
      String(maxBytes),
      '--max-time',
      String(Math.floor(DOWNLOAD_TIMEOUT_MS / 1000)),
      '--output',
      '-',
      url
    ],
    destination,
    maxBytes,
    timeoutMs: DOWNLOAD_TIMEOUT_MS
  });
}

export async function decompressArchive({ source, destination, maxBytes }) {
  await streamCommand({
    command: 'bzip2',
    arguments_: ['-dc', source],
    destination,
    maxBytes,
    timeoutMs: DOWNLOAD_TIMEOUT_MS
  });
}

function partialPath(cacheRoot, name) {
  return join(cacheRoot, `.${name}.partial-${process.pid}-${randomBytes(8).toString('hex')}`);
}

async function reservePartial(path) {
  const handle = await open(path, 'wx', 0o600);
  await handle.close();
}

async function unlinkIfPresent(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function installLink(source, destination) {
  try {
    await link(source, destination);
    return 'installed';
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return 'exists';
    throw error;
  }
}

async function ensureArchive({ cacheRoot, spec, download }) {
  const archivePath = join(cacheRoot, spec.archiveName);
  try {
    const existing = await hashArchive(archivePath, spec);
    if (existing.state === 'valid') return { path: archivePath, state: 'reused' };
  } catch (error) {
    if (!(error instanceof Product1bImageError) || error.code === 'UNSAFE_CACHE_ENTRY') throw error;
    await unlink(archivePath);
  }

  const temporary = partialPath(cacheRoot, spec.archiveName);
  await reservePartial(temporary);
  try {
    await download({ destination: temporary, url: spec.url, maxBytes: spec.archiveBytes });
    await hashArchive(temporary, spec);
    const installed = await installLink(temporary, archivePath);
    if (installed === 'exists') {
      await hashArchive(archivePath, spec);
      return { path: archivePath, state: 'reused' };
    }
    return { path: archivePath, state: 'downloaded' };
  } catch (error) {
    if (error instanceof Product1bImageError) throw error;
    throw imageError('DOWNLOAD_FAILED', error);
  } finally {
    await unlinkIfPresent(temporary);
  }
}

async function ensureRawBase({ cacheRoot, spec, archivePath, decompress }) {
  const rawPath = join(cacheRoot, spec.rawName);
  const proofPath = join(cacheRoot, `${spec.rawName}.integrity.json`);
  const existing = await inspectRawBase(rawPath, proofPath, spec);
  if (existing === 'valid') return 'reused';
  if (existing === 'invalid') {
    await unlinkIfPresent(rawPath);
    await unlinkIfPresent(proofPath);
  }

  const temporaryRaw = partialPath(cacheRoot, spec.rawName);
  const temporaryProof = partialPath(cacheRoot, `${spec.rawName}.integrity.json`);
  await reservePartial(temporaryRaw);
  await reservePartial(temporaryProof);
  let rawInstalled = false;
  let proofInstalled = false;
  try {
    await decompress({
      source: archivePath,
      destination: temporaryRaw,
      maxBytes: spec.rawMaxBytes
    });
    const opened = await openRegular(temporaryRaw);
    if (opened === undefined) throw imageError('DECOMPRESSION_FAILED');
    const digest = await digestOpenedFile(opened, spec.rawMaxBytes);
    if (digest === undefined) throw imageError('DECOMPRESSION_FAILED');
    await writeIntegrityProof(temporaryProof, {
      schemaVersion: 1,
      archiveSha256: spec.archiveSha256,
      rawBytes: digest.bytes,
      rawSha256: digest.sha256
    });
    await chmod(temporaryRaw, 0o444);
    if ((await installLink(temporaryRaw, rawPath)) !== 'installed') {
      throw imageError('DECOMPRESSION_FAILED');
    }
    rawInstalled = true;
    if ((await installLink(temporaryProof, proofPath)) !== 'installed') {
      throw imageError('DECOMPRESSION_FAILED');
    }
    proofInstalled = true;
    return 'created';
  } catch (error) {
    if (proofInstalled) await unlinkIfPresent(proofPath);
    if (rawInstalled) await unlinkIfPresent(rawPath);
    if (error instanceof Product1bImageError && error.code === 'UNSAFE_CACHE_ENTRY') throw error;
    throw imageError('DECOMPRESSION_FAILED', error);
  } finally {
    await unlinkIfPresent(temporaryProof);
    await unlinkIfPresent(temporaryRaw);
  }
}

export async function prepareImage({
  cacheRoot,
  spec = IMAGE_SPEC,
  download = downloadArchive,
  decompress = decompressArchive
}) {
  validateSpec(spec);
  await ensureCacheRoot(cacheRoot);
  const archive = await ensureArchive({ cacheRoot, spec, download });
  const raw = await ensureRawBase({
    cacheRoot,
    spec,
    archivePath: archive.path,
    decompress
  });
  return { archive: archive.state, raw };
}

export function formatImageFailure(error) {
  const code = error instanceof Product1bImageError ? error.code : 'CACHE_UNAVAILABLE';
  const detail = IMAGE_FAILURES[code] ?? IMAGE_FAILURES.CACHE_UNAVAILABLE;
  return `Product 1B image: FAILED; ${detail}\n`;
}

function userCacheRoot() {
  return process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Caches', 'opnsense-mcp', 'product1b')
    : join(homedir(), '.cache', 'opnsense-mcp', 'product1b');
}

async function main() {
  const command = process.argv[2];
  if (command === 'doctor') {
    const report = doctorHost();
    process.stdout.write(formatDoctorReport(report));
    process.exitCode = report.ready ? 0 : 2;
    return;
  }
  if (command === 'prepare-image') {
    try {
      await prepareImage({ cacheRoot: userCacheRoot() });
      process.stdout.write(
        'Product 1B image: READY; verified immutable OPNsense 26.1.6 base cached\n'
      );
    } catch (error) {
      process.stderr.write(formatImageFailure(error));
      process.exitCode = 2;
    }
    return;
  }
  process.stderr.write('Usage: product1b.mjs doctor|prepare-image\n');
  process.exitCode = 2;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}

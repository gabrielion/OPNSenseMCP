// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, unlink } from 'node:fs/promises';
import { isIP } from 'node:net';
import { isAbsolute, join } from 'node:path';
import { connect as connectTls } from 'node:tls';

const API_HOST = '127.0.0.1';
const API_PORT = 18443;
const CONNECTION_NAME = 'connection.json';
const CA_NAME = 'ca.pem';
const CERTIFICATE_MAX_BYTES = 128 * 1024;
const CERTIFICATE_TIMEOUT_MS = 5000;
const BASIC_KEY = /^[\x20-\x39\x3b-\x7e]+$/u;
const BASIC_SECRET = /^[\x20-\x7e]+$/u;

export const PRODUCT1B_CONNECTION_ARTIFACTS = Object.freeze([CA_NAME, CONNECTION_NAME]);

export class Product1bConnectionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'Product1bConnectionError';
    this.code = code;
  }
}

function connectionError(code) {
  return new Product1bConnectionError(code);
}

function isMissing(error) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyPresent(error) {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function validServerName(value) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 253 ||
    isIP(value) !== 0 ||
    value.endsWith('.')
  ) {
    return false;
  }
  const labels = value.split('.');
  return labels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label)
  );
}

function validateCredentials(credentials) {
  if (
    typeof credentials !== 'object' ||
    credentials === null ||
    Array.isArray(credentials) ||
    Object.keys(credentials).sort().join(',') !== 'key,secret,serverName' ||
    typeof credentials.key !== 'string' ||
    credentials.key.length < 1 ||
    credentials.key.length > 1024 ||
    !BASIC_KEY.test(credentials.key) ||
    typeof credentials.secret !== 'string' ||
    credentials.secret.length < 1 ||
    credentials.secret.length > 1024 ||
    !BASIC_SECRET.test(credentials.secret) ||
    !validServerName(credentials.serverName)
  ) {
    throw connectionError('CONNECTION_INVALID');
  }
}

async function assertPrivateInstanceRoot(instanceRoot) {
  if (!isAbsolute(instanceRoot)) throw connectionError('CONNECTION_INVALID');
  try {
    const stat = await lstat(instanceRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
      throw connectionError('CONNECTION_UNSAFE_STATE');
    }
  } catch (error) {
    if (error instanceof Product1bConnectionError) throw error;
    throw connectionError('CONNECTION_UNSAFE_STATE');
  }
}

async function assertAbsent(path) {
  try {
    await lstat(path);
    throw connectionError('CONNECTION_EXISTS');
  } catch (error) {
    if (isMissing(error)) return;
    if (error instanceof Product1bConnectionError) throw error;
    throw connectionError('CONNECTION_UNSAFE_STATE');
  }
}

async function writePrivateTemporary(path, bytes) {
  let handle;
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) {
      throw connectionError('CONNECTION_UNSAFE_STATE');
    }
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (error instanceof Product1bConnectionError) throw error;
    if (isAlreadyPresent(error)) throw connectionError('CONNECTION_EXISTS');
    throw connectionError('CONNECTION_WRITE_FAILED');
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
  }
}

async function installPrivateTemporary(temporary, destination) {
  try {
    await link(temporary, destination);
  } catch (error) {
    if (isAlreadyPresent(error)) throw connectionError('CONNECTION_EXISTS');
    throw connectionError('CONNECTION_WRITE_FAILED');
  }
}

function certificatePem(der) {
  if (!Buffer.isBuffer(der) || der.byteLength < 1 || der.byteLength > CERTIFICATE_MAX_BYTES) {
    throw connectionError('CONNECTION_CERTIFICATE_FAILED');
  }
  const base64 = der.toString('base64');
  const lines = base64.match(/.{1,64}/gu);
  if (lines === null) throw connectionError('CONNECTION_CERTIFICATE_FAILED');
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

export function capturePeerCertificate({
  host = API_HOST,
  port = API_PORT,
  serverName,
  timeoutMs = CERTIFICATE_TIMEOUT_MS
}) {
  return new Promise((resolve, reject) => {
    const socket = connectTls({
      host,
      port,
      servername: serverName,
      rejectUnauthorized: false
    });
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      callback();
    };
    socket.setTimeout(timeoutMs, () =>
      finish(() => reject(connectionError('CONNECTION_CERTIFICATE_FAILED')))
    );
    socket.once('error', () =>
      finish(() => reject(connectionError('CONNECTION_CERTIFICATE_FAILED')))
    );
    socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate(true);
      const raw = certificate?.raw;
      finish(() => {
        if (!Buffer.isBuffer(raw)) {
          reject(connectionError('CONNECTION_CERTIFICATE_FAILED'));
          return;
        }
        resolve(Buffer.from(raw));
      });
    });
  });
}

export async function createConnectionArtifacts({
  instanceRoot,
  credentials,
  captureCertificate = capturePeerCertificate
}) {
  validateCredentials(credentials);
  await assertPrivateInstanceRoot(instanceRoot);
  const caPath = join(instanceRoot, CA_NAME);
  const configPath = join(instanceRoot, CONNECTION_NAME);
  await assertAbsent(caPath);
  await assertAbsent(configPath);

  let certificate;
  try {
    certificate = await captureCertificate({
      host: API_HOST,
      port: API_PORT,
      serverName: credentials.serverName
    });
  } catch {
    throw connectionError('CONNECTION_CERTIFICATE_FAILED');
  }
  const ca = certificatePem(certificate);
  const config = `${JSON.stringify({
    url: `https://${API_HOST}:${API_PORT}`,
    apiKey: credentials.key,
    apiSecret: credentials.secret,
    caFile: caPath,
    tlsServerName: credentials.serverName,
    timeoutMs: 120_000
  })}\n`;
  const nonce = randomBytes(8).toString('hex');
  const temporaryCa = join(instanceRoot, `.${CA_NAME}.pending-${nonce}`);
  const temporaryConfig = join(instanceRoot, `.${CONNECTION_NAME}.pending-${nonce}`);
  let installedCa = false;
  let installedConfig = false;
  try {
    await writePrivateTemporary(temporaryCa, ca);
    await writePrivateTemporary(temporaryConfig, config);
    await installPrivateTemporary(temporaryCa, caPath);
    installedCa = true;
    await installPrivateTemporary(temporaryConfig, configPath);
    installedConfig = true;
    return Object.freeze({ configPath, caPath });
  } catch (error) {
    if (installedConfig) await unlink(configPath).catch(() => undefined);
    if (installedCa) await unlink(caPath).catch(() => undefined);
    if (error instanceof Product1bConnectionError) throw error;
    throw connectionError('CONNECTION_WRITE_FAILED');
  } finally {
    await unlink(temporaryConfig).catch(() => undefined);
    await unlink(temporaryCa).catch(() => undefined);
  }
}

export async function removeConnectionArtifacts(instanceRoot) {
  for (const name of PRODUCT1B_CONNECTION_ARTIFACTS) {
    const path = join(instanceRoot, name);
    try {
      const stat = await lstat(path);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        throw connectionError('CONNECTION_UNSAFE_STATE');
      }
      await unlink(path);
    } catch (error) {
      if (isMissing(error)) continue;
      if (error instanceof Product1bConnectionError) throw error;
      throw connectionError('CONNECTION_WRITE_FAILED');
    }
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import { Buffer } from 'node:buffer';
import { closeSync, constants, fstatSync, openSync, readSync, type Stats } from 'node:fs';
import { isAbsolute } from 'node:path';
import * as z from 'zod/v4';

const CONFIG_MAX_BYTES = 16 * 1024;
const CA_MAX_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const INVALID_CONFIGURATION_MESSAGE = 'Invalid OPNsense configuration.';
const BASIC_KEY = /^[\x20-\x39\x3b-\x7e]+$/u;
const BASIC_SECRET = /^[\x20-\x7e]+$/u;

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.origin === value &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

const PrivateConfigurationSchema = z
  .object({
    url: z.string().refine(isHttpsOrigin),
    apiKey: z.string().min(1).max(1024).regex(BASIC_KEY),
    apiSecret: z.string().min(1).max(1024).regex(BASIC_SECRET),
    caFile: z.string().refine(isAbsolute).optional(),
    timeoutMs: z.number().int().min(1).max(MAX_TIMEOUT_MS).optional(),
    maxResponseBytes: z.number().int().min(1).max(MAX_RESPONSE_BYTES).optional()
  })
  .strict();

export interface OPNsenseConnectionConfig {
  readonly url: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly ca?: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

function invalidConfiguration(): never {
  throw new Error(INVALID_CONFIGURATION_MESSAGE);
}

function requireRegularFile(stats: Stats): void {
  if (!stats.isFile()) invalidConfiguration();
}

function readOpenedBoundedFile(
  path: string,
  maximumBytes: number,
  validate: (stats: Stats) => void
) {
  if (!isAbsolute(path)) invalidConfiguration();
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = fstatSync(descriptor);
    requireRegularFile(stats);
    validate(stats);
    if (stats.size > maximumBytes) invalidConfiguration();
    const output = Buffer.allocUnsafe(maximumBytes + 1);
    let offset = 0;
    while (offset < output.length) {
      const count = readSync(descriptor, output, offset, output.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > maximumBytes) invalidConfiguration();
    return output.subarray(0, offset);
  } catch {
    return invalidConfiguration();
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The public startup error remains fixed even when descriptor cleanup fails.
      }
    }
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return invalidConfiguration();
  }
}

function currentUserId(): number {
  if (typeof process.getuid !== 'function') invalidConfiguration();
  return process.getuid();
}

export function loadOPNsenseConnectionConfig(path: string): OPNsenseConnectionConfig {
  try {
    const bytes = readOpenedBoundedFile(path, CONFIG_MAX_BYTES, (stats) => {
      if (stats.uid !== currentUserId() || stats.nlink !== 1 || (stats.mode & 0o7777) !== 0o600) {
        invalidConfiguration();
      }
    });
    const parsedJson: unknown = JSON.parse(decodeUtf8(bytes));
    const parsed = PrivateConfigurationSchema.parse(parsedJson);
    const ca =
      parsed.caFile === undefined
        ? undefined
        : decodeUtf8(
            readOpenedBoundedFile(parsed.caFile, CA_MAX_BYTES, () => {
              // CA bundles may be shared system files; regular, non-symlink and bounded is sufficient.
            })
          );
    return Object.freeze({
      url: parsed.url,
      apiKey: parsed.apiKey,
      apiSecret: parsed.apiSecret,
      ...(ca === undefined ? {} : { ca }),
      timeoutMs: parsed.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxResponseBytes: parsed.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
    });
  } catch {
    return invalidConfiguration();
  }
}

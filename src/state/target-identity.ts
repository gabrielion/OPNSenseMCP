// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHmac } from 'node:crypto';
import { join } from 'node:path';

export const INVALID_ORIGIN = 'Invalid OPNsense origin';

// The canonical origin is the whole lock/state identity: scheme, lower-case ASCII host, effective
// port. Credentials, TLS material, paths and queries must never influence or enter it.
export function canonicalizeOrigin(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(INVALID_ORIGIN);
  }
  if (parsed.protocol !== 'https:') throw new Error(INVALID_ORIGIN);
  if (parsed.username !== '' || parsed.password !== '') throw new Error(INVALID_ORIGIN);
  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new Error(INVALID_ORIGIN);
  }
  const host = parsed.hostname;
  if (host === '' || !/^[\x21-\x7e]+$/u.test(host) || host !== host.toLowerCase()) {
    // URL already lower-cases and punycodes hostnames; anything still outside printable ASCII or
    // still upper-case did not come from that normalization and is refused rather than repaired.
    throw new Error(INVALID_ORIGIN);
  }
  const port = parsed.port === '' ? '443' : parsed.port;
  return `https://${host}:${port}`;
}

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const IDENTITY_KEY_BYTES = 32;
const TARGET_ID_PATTERN = /^[a-z2-7]{52}$/u;

export function base32LowerNoPadding(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET.charAt((value << (5 - bits)) & 31);
  return out;
}

export function deriveTargetId(identityKey: Uint8Array, canonicalOrigin: string): string {
  if (identityKey.length !== IDENTITY_KEY_BYTES) throw new Error('Invalid identity key');
  if (canonicalizeOrigin(canonicalOrigin) !== canonicalOrigin) {
    throw new Error(INVALID_ORIGIN);
  }
  const digest = createHmac('sha256', identityKey).update(canonicalOrigin, 'utf8').digest();
  return base32LowerNoPadding(digest);
}

export function targetDirectoryPath(stateRootPath: string, targetId: string): string {
  if (!TARGET_ID_PATTERN.test(targetId)) throw new Error('Invalid target id');
  return join(stateRootPath, 'targets', targetId);
}

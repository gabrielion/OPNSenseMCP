// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHmac } from 'node:crypto';
import { join } from 'node:path';

export const INVALID_ORIGIN = 'Invalid OPNsense origin';

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/u;

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
  // URL brackets an IPv6 literal and re-spells an IPv4 one, so a literal already has a single
  // spelling and the DNS rules below must not apply to it.
  const isIpLiteral = host.startsWith('[') || IPV4_LITERAL.test(host);
  if (!isIpLiteral && (host.split('.').includes('') || host.includes('_'))) {
    // A DNS host carrying an empty label — a trailing dot leaves one — or an underscore reaches the
    // same firewall as its clean spelling, yet URL preserves it. Admitting both spellings would give
    // one firewall two target ids, hence two lock files and two state directories, so the second
    // spelling is refused rather than repaired into the first.
    throw new Error(INVALID_ORIGIN);
  }
  // Port 0 never identifies a listening firewall; it is caught before the substitution below, which
  // only fills in the default port for a bare origin.
  if (parsed.port === '0') throw new Error(INVALID_ORIGIN);
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

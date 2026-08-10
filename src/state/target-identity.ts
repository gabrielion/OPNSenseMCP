// SPDX-License-Identifier: AGPL-3.0-or-later

const INVALID_ORIGIN = 'Invalid OPNsense origin';

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

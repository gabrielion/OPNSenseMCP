// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  base32LowerNoPadding,
  canonicalizeOrigin,
  deriveTargetId,
  targetDirectoryPath
} from '../../src/state/target-identity.js';

describe('canonicalizeOrigin', () => {
  it('lower-cases the host and makes the default port explicit', () => {
    expect(canonicalizeOrigin('https://Firewall.Example.NET')).toBe(
      'https://firewall.example.net:443'
    );
  });

  it('keeps an explicit port and accepts IP literals', () => {
    expect(canonicalizeOrigin('https://192.0.2.1:8443')).toBe('https://192.0.2.1:8443');
    expect(canonicalizeOrigin('https://[2001:DB8::1]')).toBe('https://[2001:db8::1]:443');
  });

  it('treats an explicit default port and a bare origin as the same identity', () => {
    expect(canonicalizeOrigin('https://a.example:443')).toBe(
      canonicalizeOrigin('https://a.example')
    );
  });

  it.each([
    ['http://a.example', 'non-https scheme'],
    ['https://user:pw@a.example', 'credentials in the URL'],
    ['https://a.example/api', 'a path'],
    ['https://a.example/?x=1', 'a query'],
    ['https://a.example/#f', 'a fragment'],
    ['not a url', 'unparseable input'],
    ['', 'empty input']
  ])('rejects %s (%s)', (input) => {
    expect(() => canonicalizeOrigin(input)).toThrow('Invalid OPNsense origin');
  });

  // The URL parser preserves each of these spellings verbatim, so accepting them would give one
  // firewall a second canonical origin, a second target id, and a second lock and state directory.
  it.each([
    ['https://fw.example.', 'trailing dot'],
    ['https://a..example', 'empty label'],
    ['https://a_b.example', 'underscore in label'],
    ['https://a.example:0', 'port zero'],
    ['https://192.0.2.1:0', 'port zero on an IP literal']
  ])('rejects %s (%s)', (input) => {
    expect(() => canonicalizeOrigin(input)).toThrow('Invalid OPNsense origin');
  });

  it('still accepts IP literals that the label rules do not apply to', () => {
    expect(canonicalizeOrigin('https://192.0.2.1:8443')).toBe('https://192.0.2.1:8443');
    expect(canonicalizeOrigin('https://[2001:DB8::1]')).toBe('https://[2001:db8::1]:443');
    // A trailing dot after an IPv4 literal is consumed by the URL parser's address parser, not by
    // the label rules: the host is already normalized to one spelling, so there is nothing to split.
    expect(canonicalizeOrigin('https://192.0.2.1.')).toBe('https://192.0.2.1:443');
  });

  it('still accepts an internationalized host, which URL punycodes into hyphenated labels', () => {
    expect(canonicalizeOrigin('https://café.example')).toBe('https://xn--caf-dma.example:443');
  });
});

describe('base32LowerNoPadding', () => {
  // RFC 4648 section 10 test vectors, lower-cased, padding stripped.
  it.each([
    ['f', 'my'],
    ['fo', 'mzxq'],
    ['foo', 'mzxw6'],
    ['foob', 'mzxw6yq'],
    ['fooba', 'mzxw6ytb'],
    ['foobar', 'mzxw6ytboi']
  ])('encodes %s as %s', (input, expected) => {
    expect(base32LowerNoPadding(Buffer.from(input, 'ascii'))).toBe(expected);
  });
});

describe('deriveTargetId', () => {
  const key = randomBytes(32);
  const origin = 'https://firewall.example.net:443';

  it('is deterministic, 52 chars of lower-case base32', () => {
    const id = deriveTargetId(key, origin);
    expect(id).toMatch(/^[a-z2-7]{52}$/u);
    expect(deriveTargetId(key, origin)).toBe(id);
  });

  it('changes with the origin but not with anything else', () => {
    expect(deriveTargetId(key, 'https://firewall.example.net:8443')).not.toBe(
      deriveTargetId(key, origin)
    );
  });

  it('changes with the identity key, so ids are not enumerable from origins', () => {
    expect(deriveTargetId(randomBytes(32), origin)).not.toBe(deriveTargetId(key, origin));
  });

  it('rejects a wrong-size key and a non-canonical origin', () => {
    expect(() => deriveTargetId(randomBytes(31), origin)).toThrow('Invalid identity key');
    expect(() => deriveTargetId(key, 'https://Firewall.example.net:443')).toThrow(
      'Invalid OPNsense origin'
    );
    expect(() => deriveTargetId(key, 'https://firewall.example.net')).toThrow(
      'Invalid OPNsense origin'
    );
  });
});

describe('targetDirectoryPath', () => {
  it('lays out targets/<id> under the state root', () => {
    const id = deriveTargetId(randomBytes(32), 'https://a.example:443');
    expect(targetDirectoryPath('/private/state', id)).toBe(join('/private/state', 'targets', id));
  });

  it('rejects anything that is not a derived id', () => {
    for (const bad of ['', 'UPPER', 'short', '../escape', 'a'.repeat(52).replace('a', '/')]) {
      expect(() => targetDirectoryPath('/private/state', bad)).toThrow('Invalid target id');
    }
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { canonicalizeOrigin } from '../../src/state/target-identity.js';

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
});

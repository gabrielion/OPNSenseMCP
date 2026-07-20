// SPDX-License-Identifier: AGPL-3.0-or-later
import { chmod, link, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOPNsenseConnectionConfig } from '../../src/opnsense/config.js';

const INVALID = /^Invalid OPNsense configuration\.$/u;
let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'opnsense-config-test-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function privateFile(name: string, value: string | Uint8Array): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, value, { mode: 0o600 });
  return path;
}

describe('private OPNsense configuration', () => {
  it('loads an explicit DNS TLS server name without changing the HTTPS origin', async () => {
    const path = await privateFile(
      'config.json',
      JSON.stringify({
        url: 'https://127.0.0.1:18443',
        apiKey: 'key',
        apiSecret: 'secret',
        tlsServerName: 'OPNsense.internal'
      })
    );

    expect(loadOPNsenseConnectionConfig(path)).toMatchObject({
      url: 'https://127.0.0.1:18443',
      tlsServerName: 'OPNsense.internal'
    });
  });

  it.each([
    { label: 'an empty name', tlsServerName: '' },
    { label: 'an IPv4 address', tlsServerName: '127.0.0.1' },
    { label: 'an IPv6 address', tlsServerName: '2001:db8::1' },
    { label: 'a path', tlsServerName: 'firewall.example/path' },
    { label: 'an underscore', tlsServerName: 'firewall_name.example' },
    { label: 'a wildcard', tlsServerName: '*.example' },
    { label: 'a non-ASCII name', tlsServerName: 'pare-feu.exemple\u00e9' },
    { label: 'an empty label', tlsServerName: 'firewall..example' },
    { label: 'a leading label hyphen', tlsServerName: '-firewall.example' },
    { label: 'a trailing label hyphen', tlsServerName: 'firewall-.example' },
    { label: 'an overlong label', tlsServerName: `${'a'.repeat(64)}.example` },
    {
      label: 'an overlong DNS name',
      tlsServerName: Array.from({ length: 4 }, () => 'a'.repeat(63)).join('.')
    }
  ])('rejects $label as a TLS server name with one fixed error', async ({ tlsServerName }) => {
    const path = await privateFile(
      'config.json',
      JSON.stringify({
        url: 'https://127.0.0.1:18443',
        apiKey: 'key',
        apiSecret: 'secret',
        tlsServerName
      })
    );

    expect(() => loadOPNsenseConnectionConfig(path)).toThrow(INVALID);
    try {
      loadOPNsenseConnectionConfig(path);
    } catch (error) {
      expect(String(error)).toBe('Error: Invalid OPNsense configuration.');
      if (tlsServerName.length > 0) expect(String(error)).not.toContain(tlsServerName);
      expect(String(error)).not.toContain('secret');
    }
  });

  it('loads only the strict reviewed fields and an explicit bounded CA', async () => {
    const caFile = await privateFile('ca.pem', 'TEST CA');
    const path = await privateFile(
      'config.json',
      JSON.stringify({
        url: 'https://firewall.example:8443',
        apiKey: 'key',
        apiSecret: 'secret',
        caFile,
        timeoutMs: 3210,
        maxResponseBytes: 8192
      })
    );

    expect(loadOPNsenseConnectionConfig(path)).toEqual({
      url: 'https://firewall.example:8443',
      apiKey: 'key',
      apiSecret: 'secret',
      ca: 'TEST CA',
      timeoutMs: 3210,
      maxResponseBytes: 8192
    });
  });

  it('accepts an unambiguous printable Basic credential pair including colons in the secret', async () => {
    const path = await privateFile(
      'config.json',
      JSON.stringify({
        url: 'https://firewall.example',
        apiKey: 'printable key',
        apiSecret: 'secret:with:colons'
      })
    );

    expect(loadOPNsenseConnectionConfig(path)).toMatchObject({
      apiKey: 'printable key',
      apiSecret: 'secret:with:colons'
    });
  });

  it.each([
    ['colon in key', 'key:forged', 'secret'],
    ['newline in key', 'key\nforged', 'secret'],
    ['tab in key', 'key\tforged', 'secret'],
    ['DEL in key', 'key\u007fforged', 'secret'],
    ['non-ASCII key', 'k\u00e9y', 'secret'],
    ['newline in secret', 'key', 'secret\nforged'],
    ['tab in secret', 'key', 'secret\tforged'],
    ['NUL in secret', 'key', 'secret\u0000forged'],
    ['DEL in secret', 'key', 'secret\u007fforged'],
    ['non-ASCII secret', 'key', 'secr\u00e8t']
  ])('rejects %s with the fixed configuration error', async (_label, apiKey, apiSecret) => {
    const path = await privateFile(
      'config.json',
      JSON.stringify({ url: 'https://firewall.example', apiKey, apiSecret })
    );

    expect(() => loadOPNsenseConnectionConfig(path)).toThrow(INVALID);
    try {
      loadOPNsenseConnectionConfig(path);
    } catch (error) {
      expect(String(error)).toBe('Error: Invalid OPNsense configuration.');
      expect(String(error)).not.toContain(apiKey);
      expect(String(error)).not.toContain(apiSecret);
    }
  });

  it.each([
    ['relative config path', () => 'relative-config.json'],
    [
      'group-readable config',
      async () => {
        const path = await privateFile('config.json', '{}');
        await chmod(path, 0o640);
        return path;
      }
    ],
    [
      'symlink config',
      async () => {
        const target = await privateFile('target.json', '{}');
        const path = join(directory, 'config.json');
        await symlink(target, path);
        return path;
      }
    ],
    [
      'multiply-linked config',
      async () => {
        const path = await privateFile('config.json', '{}');
        await link(path, join(directory, 'second-link.json'));
        return path;
      }
    ],
    ['oversized config', () => privateFile('config.json', ' '.repeat(16 * 1024 + 1))],
    ['invalid UTF-8 config', () => privateFile('config.json', Uint8Array.from([0xc3, 0x28]))]
  ])('rejects a %s with one fixed error', async (_label, makePath) => {
    const path = await makePath();
    expect(() => loadOPNsenseConnectionConfig(path)).toThrow(INVALID);
  });

  it.each([
    'http://firewall.example',
    'https://user:password@firewall.example',
    'https://firewall.example/',
    'https://firewall.example/path',
    'https://firewall.example?query=sentinel',
    'https://firewall.example#sentinel'
  ])('rejects non-origin URL %s without reflecting it', async (url) => {
    const path = await privateFile(
      'config.json',
      JSON.stringify({ url, apiKey: 'key', apiSecret: 'secret' })
    );
    expect(() => loadOPNsenseConnectionConfig(path)).toThrow(INVALID);
    try {
      loadOPNsenseConnectionConfig(path);
    } catch (error) {
      expect(String(error)).not.toContain(url);
      expect(String(error)).not.toContain('secret');
    }
  });

  it('rejects unknown keys and a symlink CA without exposing sentinels', async () => {
    const realCa = await privateFile('real-ca.pem', 'SENTINEL_CA_BYTES');
    const linkedCa = join(directory, 'ca.pem');
    await symlink(realCa, linkedCa);
    const cases = [
      { url: 'https://firewall.example', apiKey: 'key', apiSecret: 'secret', insecure: true },
      { url: 'https://firewall.example', apiKey: 'key', apiSecret: 'secret', caFile: linkedCa }
    ];
    for (const [index, value] of cases.entries()) {
      const path = await privateFile(`config-${String(index)}.json`, JSON.stringify(value));
      expect(() => loadOPNsenseConnectionConfig(path)).toThrow(INVALID);
      try {
        loadOPNsenseConnectionConfig(path);
      } catch (error) {
        expect(String(error)).not.toContain('SENTINEL');
        expect(String(error)).not.toContain('secret');
      }
    }
  });
});

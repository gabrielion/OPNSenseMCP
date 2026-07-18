// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

interface PackageDocument {
  name: string;
  license: string;
  engines: { node: string };
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

interface LockPackage {
  readonly version?: string;
  readonly resolved?: string;
  readonly integrity?: string;
  readonly dev?: boolean;
}

interface LockDocument {
  readonly packages: Record<
    string,
    LockPackage & { readonly dependencies?: Record<string, string> }
  >;
}

describe('package contract', () => {
  it('pins the MCP v2 beta and AGPL foundation exactly', async () => {
    const document = JSON.parse(await readFile('package.json', 'utf8')) as PackageDocument;

    expect(document.name).toBe('@gabrielion/opnsense-mcp');
    expect(document.license).toBe('AGPL-3.0-or-later');
    expect(document.engines.node).toBe('>=22.19 <23');
    expect(document.scripts['license:check']).toBe('node scripts/check-license-headers.mjs');
    expect(document.dependencies).toMatchObject({
      '@modelcontextprotocol/server': '2.0.0-beta.4',
      '@modelcontextprotocol/node': '2.0.0-beta.4',
      '@modelcontextprotocol/express': '2.0.0-beta.4',
      '@modelcontextprotocol/sdk': '1.29.0',
      express: '5.2.1',
      zod: '4.2.0'
    });
    expect(document.devDependencies['@modelcontextprotocol/client']).toBe('2.0.0-beta.4');
    expect(document.devDependencies['@modelcontextprotocol/conformance']).toBe('0.2.0-alpha.9');
    expect(document.devDependencies.vitest).toBe('4.1.10');
    expect(document.scripts['release:check:legacy-sse']).toBe(
      'node scripts/check-legacy-sse-dependency.mjs'
    );

    const lock = JSON.parse(await readFile('package-lock.json', 'utf8')) as LockDocument;
    expect(lock.packages['']?.dependencies?.['@modelcontextprotocol/sdk']).toBe('1.29.0');
    const sdkNodes = Object.entries(lock.packages).filter(([path]) =>
      /(?:^|\/)node_modules\/@modelcontextprotocol\/sdk$/u.test(path)
    );
    expect(sdkNodes.map(([path]) => path)).toEqual(['node_modules/@modelcontextprotocol/sdk']);
    expect(sdkNodes[0]?.[1]).toMatchObject({
      version: '1.29.0',
      resolved: 'https://registry.npmjs.org/@modelcontextprotocol/sdk/-/sdk-1.29.0.tgz',
      integrity:
        'sha512-zo37mZA9hJWpULgkRpowewez1y6ML5GsXJPY8FI0tBBCd77HEvza4jDqRKOXgHNn867PVGCyTdzqpz0izu5ZjQ=='
    });
    expect(sdkNodes[0]?.[1].dev).toBeUndefined();
  });

  it('contains no forbidden internal MCP dependency', async () => {
    const packageText = await readFile('package.json', 'utf8');
    const lockText = await readFile('package-lock.json', 'utf8');

    expect(packageText).not.toContain('@modelcontextprotocol/core-internal');
    expect(lockText).not.toContain('node_modules/@modelcontextprotocol/core-internal');
  });

  it('gives repository agents the minimum runtime, safety, and gate contract', async () => {
    const [agents, claude] = await Promise.all([
      readFile('AGENTS.md', 'utf8'),
      readFile('CLAUDE.md', 'utf8')
    ]);

    for (const instructions of [agents, claude]) {
      expect(instructions).toContain('Node.js 22.19.0');
      expect(instructions).toContain('production firewall');
      expect(instructions).toContain('npm run verify');
      expect(instructions).toContain('npm run test:conformance');
      expect(instructions).toContain('git diff --check');
    }
  });
});

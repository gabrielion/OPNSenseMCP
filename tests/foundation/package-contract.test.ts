// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

interface PackageDocument {
  name: string;
  license: string;
  private?: boolean;
  publishConfig: { access: string };
  repository: { type: string; url: string };
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
  readonly devDependencies?: Record<string, string>;
}

interface LockDocument {
  readonly packages: Record<
    string,
    LockPackage & { readonly dependencies?: Record<string, string> }
  >;
}

describe('package contract', () => {
  it('forces LF TypeScript emission and an exact executable byte prefix', async () => {
    const buildConfig = JSON.parse(await readFile('tsconfig.build.json', 'utf8')) as {
      readonly compilerOptions?: { readonly newLine?: unknown };
    };
    expect(buildConfig.compilerOptions?.newLine).toBe('lf');

    const emitted = await readFile('dist/main.js');
    const prefix = Buffer.from(
      '#!/usr/bin/env node\n// SPDX-License-Identifier: AGPL-3.0-or-later\n',
      'utf8'
    );
    expect(emitted.subarray(0, prefix.length)).toEqual(prefix);
  });

  it('contains no Error.name-derived runtime diagnostic', async () => {
    for (const file of [
      'src/main.ts',
      'src/entrypoints/stdio.ts',
      'src/entrypoints/http.ts',
      'src/http/runtime.ts'
    ]) {
      expect(await readFile(file, 'utf8'), file).not.toContain('error.name');
    }
  });

  // The README header states the verified firmware and protocol revision as hand-written badge
  // strings. Nothing regenerates them, so without this check they quietly outlive the evidence
  // they summarise at the next attestation renewal or protocol bump — and a stale evidence badge
  // on the front page is a worse overclaim than no badge at all.
  it('keeps the README evidence badges in step with the attestation they cite', async () => {
    const [readme, evidence] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('docs/evidence/product3-vm.json', 'utf8')
    ]);
    const attestation = JSON.parse(evidence) as {
      image: { release: string };
      protocolVersion: string;
    };

    const firmwareBadge = /verified%20on-OPNsense%20(?<release>[\d.]+)-/u.exec(readme);
    expect(firmwareBadge?.groups?.release).toBe(attestation.image.release);

    const escaped = attestation.protocolVersion.replaceAll('-', '--');
    expect(readme).toContain(`badge/MCP-${escaped}-`);
  });

  it('pins the MCP v2 beta and AGPL foundation exactly', async () => {
    const document = JSON.parse(await readFile('package.json', 'utf8')) as PackageDocument;

    expect(document.name).toBe('@gabrielion/opnsense-mcp');
    expect(document.license).toBe('AGPL-3.0-or-later');
    // The package is publishable: a quickstart that cannot be installed is the friction the
    // setup tutorial exists to remove. A scoped package defaults to restricted, so the public
    // access declaration is what actually makes `npx @gabrielion/opnsense-mcp` reachable, and
    // `prepare` is what makes a git-URL install build its own dist/.
    expect(document.private).toBeUndefined();
    expect(document.publishConfig).toEqual({ access: 'public' });
    expect(document.scripts.prepare).toBe('npm run build');
    expect(document.repository.url).toBe('git+https://github.com/gabrielion/OPNSenseMCP.git');
    expect(document.engines.node).toBe('>=22.19 <23');
    expect(document.scripts['license:check']).toBe('node scripts/check-license-headers.mjs');
    expect(document.dependencies).toMatchObject({
      '@modelcontextprotocol/server': '2.0.0-beta.4',
      '@modelcontextprotocol/node': '2.0.0-beta.4',
      '@modelcontextprotocol/sdk': '1.29.0',
      express: '5.2.1',
      zod: '4.2.0'
    });
    expect(document.dependencies).not.toHaveProperty('@modelcontextprotocol/express');
    expect(document.devDependencies).not.toHaveProperty('@modelcontextprotocol/express');
    expect(document.devDependencies['@modelcontextprotocol/client']).toBe('2.0.0-beta.4');
    expect(document.devDependencies['@modelcontextprotocol/conformance']).toBe('0.2.0-alpha.9');
    expect(document.scripts['test:conformance:2025']).toBe(
      'npm run build && node scripts/run-conformance.mjs 2025-11-25'
    );
    expect(document.scripts['test:conformance:2026']).toBe(
      'npm run build && node scripts/run-conformance.mjs 2026-07-28'
    );
    expect(document.scripts['test:conformance']).toBe(
      'npm run test:conformance:2025 && npm run test:conformance:2026'
    );
    expect(document.devDependencies.vitest).toBe('4.1.10');
    expect(document.scripts['release:check:legacy-sse']).toBe(
      'node scripts/check-legacy-sse-dependency.mjs'
    );

    const lock = JSON.parse(await readFile('package-lock.json', 'utf8')) as LockDocument;
    expect(lock.packages['']?.dependencies).not.toHaveProperty('@modelcontextprotocol/express');
    expect(lock.packages['']?.devDependencies).not.toHaveProperty('@modelcontextprotocol/express');
    expect(lock.packages).not.toHaveProperty('node_modules/@modelcontextprotocol/express');
    expect(lock.packages['']?.devDependencies?.['@modelcontextprotocol/conformance']).toBe(
      '0.2.0-alpha.9'
    );
    expect(lock.packages['node_modules/@modelcontextprotocol/conformance']).toMatchObject({
      version: '0.2.0-alpha.9',
      resolved:
        'https://registry.npmjs.org/@modelcontextprotocol/conformance/-/conformance-0.2.0-alpha.9.tgz',
      integrity:
        'sha512-Bi5P5TQlOQGPJxCT7UAHbpG7wsR7sNZskHGtCoZBo6vDu416D2FXPgM4wKbg91teIgj4HjGkhnzlvP7U2dszfQ==',
      dev: true
    });
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

    const vitestConfig = await readFile('vitest.config.ts', 'utf8');
    expect(vitestConfig).toContain("include: ['tests/**/*.test.{ts,mjs}']");
  });

  it('contains no forbidden internal MCP dependency', async () => {
    const packageText = await readFile('package.json', 'utf8');
    const lockText = await readFile('package-lock.json', 'utf8');

    expect(packageText).not.toContain('@modelcontextprotocol/core-internal');
    expect(lockText).not.toContain('node_modules/@modelcontextprotocol/core-internal');
  });

  it('keeps producer-canonical VM evidence outside Prettier ownership', async () => {
    const ignoredPaths = (await readFile('.prettierignore', 'utf8'))
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));

    expect(ignoredPaths.filter((path) => path === 'docs/evidence/product3-vm.json')).toEqual([
      'docs/evidence/product3-vm.json'
    ]);
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

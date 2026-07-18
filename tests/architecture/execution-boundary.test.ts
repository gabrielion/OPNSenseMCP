// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

describe('closed capability execution boundary', () => {
  it('keeps raw handler and confirmation authority inside the lexical kernel', async () => {
    const files = await sourceFiles('src');
    const sources = await Promise.all(
      files.map(async (path) => ({
        path: relative('.', path),
        source: await readFile(path, 'utf8')
      }))
    );

    for (const forbidden of [
      'invokeCapabilityHandler',
      'VerifiedConfirmation',
      'verifiedConfirmationFromAdapter'
    ]) {
      expect(sources.filter(({ source }) => source.includes(forbidden))).toEqual([]);
    }

    expect(
      sources.filter(({ source }) => source.includes('capabilityHandlers')).map(({ path }) => path)
    ).toEqual(['src/capabilities/kernel.ts']);
    expect(
      sources
        .filter(({ source }) => source.includes('isKernelDefinedCapability'))
        .map(({ path }) => path)
        .sort()
    ).toEqual(['src/capabilities/catalog.ts', 'src/capabilities/kernel.ts']);
    expect(files.some((path) => path.endsWith('verified-confirmation.ts'))).toBe(false);
  });

  it('keeps execution factories, policy options, and settlement authority out of the root', async () => {
    const root = await readFile('src/index.ts', 'utf8');
    for (const forbidden of [
      'CapabilityDispatcher',
      'createCapabilityDispatcher',
      'ConfirmationCompletion',
      'CapabilityPolicyOptions',
      'defineCapability',
      'isKernelDefinedCapability',
      'capabilityHandlers'
    ]) {
      expect(root).not.toContain(forbidden);
    }
  });

  it('keeps CapabilityDefinition metadata-only and transport contracts authority-free', async () => {
    const types = await readFile('src/capabilities/types.ts', 'utf8');
    const definition = /export interface CapabilityDefinition \{(?<body>[\s\S]*?)\n\}/u.exec(types)
      ?.groups?.body;
    expect(definition).toBeDefined();
    for (const forbidden of ['handler', 'preflight', 'service', 'resolver', 'confirmationId']) {
      expect(definition).not.toContain(forbidden);
    }
    for (const contract of [
      'CapabilityRequest',
      'CapabilityInvocationContext',
      'CapabilityDispatcher'
    ]) {
      const body = new RegExp(
        `export interface ${contract} \\{(?<body>[\\s\\S]*?)\\n\\}`,
        'u'
      ).exec(types)?.groups?.body;
      expect(body).toBeDefined();
      expect(body).not.toContain('confirmation');
      expect(body).not.toContain('handler');
    }
  });

  it('does not expose internal source subpaths from the package', async () => {
    const document = JSON.parse(await readFile('package.json', 'utf8')) as {
      exports: Record<string, unknown>;
    };
    expect(Object.keys(document.exports)).toEqual(['.']);
  });
});

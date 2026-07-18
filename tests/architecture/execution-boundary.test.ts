// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApplicationContext } from '../../src/app/application-context.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';

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
  it('exposes exactly the safe catalog reference from ApplicationContext', () => {
    const config: RuntimeConfig = {
      readOnly: true,
      allowedResourceScopes: null,
      enabledFeatureFlags: new Set(),
      requestStateKey: new TextEncoder().encode('0123456789abcdef0123456789abcdef'),
      http: {
        enabled: false,
        host: '127.0.0.1',
        port: 3000,
        allowedHosts: ['localhost'],
        allowedOrigins: [],
        legacySseEnabled: false
      }
    };
    const application = createApplicationContext(config);
    expect(Object.getOwnPropertyNames(application)).toEqual(['catalog']);
    expect(Object.getOwnPropertySymbols(application)).toEqual([]);
    for (const forbidden of [
      'config',
      'capabilities',
      'dispatcher',
      'token',
      'key',
      'service',
      'settlement',
      'completion'
    ]) {
      expect(Reflect.get(application, forbidden)).toBeUndefined();
    }
  });

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
      'ApplicationContext',
      'createApplicationContext',
      'ConfirmationState',
      'ConfirmationStateSchema',
      'RequestStateCodec',
      'settleApplicationConfirmation',
      'defineCapability',
      'isKernelDefinedCapability',
      'capabilityHandlers'
    ]) {
      expect(root).not.toContain(forbidden);
    }
  });

  it('restricts opaque application helpers to their exact adapters', async () => {
    const files = await sourceFiles('src');
    const sources = await Promise.all(
      files.map(async (path) => ({
        path: relative('.', path),
        source: await readFile(path, 'utf8')
      }))
    );
    const allowLists: Readonly<Record<string, readonly string[]>> = {
      listApplicationCapabilities: [
        'src/app/application-context.ts',
        'src/mcp/register-capabilities.ts'
      ],
      dispatchApplicationCapability: [
        'src/app/application-context.ts',
        'src/capabilities/dispatch.ts'
      ],
      settleApplicationConfirmation: ['src/app/application-context.ts', 'src/mcp/confirmation.ts'],
      createApplicationRequestStateCodec: [
        'src/app/application-context.ts',
        'src/server/build-server.ts'
      ]
    };
    for (const [helper, allowed] of Object.entries(allowLists)) {
      expect(
        sources
          .filter(({ source }) => source.includes(helper))
          .map(({ path }) => path)
          .sort()
      ).toEqual([...allowed].sort());
    }
  });

  it('does not duplicate kernel policy branches in MCP adapters', async () => {
    for (const path of [
      'src/capabilities/dispatch.ts',
      'src/mcp/register-capabilities.ts',
      'src/mcp/confirmation.ts',
      'src/server/build-server.ts'
    ]) {
      const source = await readFile(path, 'utf8');
      for (const forbidden of [
        'allowedResourceScopes',
        'enabledFeatureFlags',
        "effect !== 'read'",
        'FEATURE_DISABLED',
        'RESOURCE_NOT_ALLOWED',
        'READ_ONLY'
      ]) {
        expect(source, `${path} contains duplicate gate ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('keeps continuation routing local to capability registration', async () => {
    const files = await sourceFiles('src');
    const sources = await Promise.all(
      files.map(async (path) => ({
        path: relative('.', path),
        source: await readFile(path, 'utf8')
      }))
    );
    expect(
      sources
        .filter(({ source }) => source.includes('requestCarriesContinuation'))
        .map(({ path }) => path)
    ).toEqual(['src/mcp/register-capabilities.ts']);
    const registration = await readFile('src/mcp/register-capabilities.ts', 'utf8');
    expect(registration).not.toMatch(/export\s+function\s+requestCarriesContinuation/u);
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

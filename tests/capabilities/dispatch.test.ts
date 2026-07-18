// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createApplicationContext } from '../../src/app/application-context.js';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import { dispatchCapability } from '../../src/capabilities/dispatch.js';
import type { RefusalCode, ServerContext } from '../../src/capabilities/types.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';
import { formatCapabilityResult, refusalResult } from '../../src/mcp/results.js';
import { createReadFixture } from '../fixtures/capabilities.js';

function config(): RuntimeConfig {
  return {
    readOnly: false,
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
}

function context(application: ReturnType<typeof createApplicationContext>): ServerContext {
  return { application, transport: 'stdio' };
}

describe('opaque application dispatch', () => {
  it('routes valid and forged cached names through the closed kernel', async () => {
    const handler = vi.fn(({ value }: { value: string }) => Promise.resolve({ echoed: value }));
    const fixture = createReadFixture({ handler });
    const application = createApplicationContext(config(), new CapabilityCatalog([fixture]));

    await expect(
      dispatchCapability(
        { name: fixture.mcpName, arguments: { value: 'safe' } },
        context(application)
      )
    ).resolves.toEqual({ kind: 'success', output: { echoed: 'safe' } });
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(
      dispatchCapability(
        { name: 'stale_cached_name', arguments: { value: 'unsafe' } },
        context(application)
      )
    ).resolves.toMatchObject({ kind: 'refused', code: 'UNKNOWN_CAPABILITY' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('reveals exactly catalog and rejects spread, clone, and constructed lookalikes', () => {
    const application = createApplicationContext(config());
    expect(Object.getOwnPropertyNames(application)).toEqual(['catalog']);
    expect(Object.getOwnPropertySymbols(application)).toEqual([]);
    expect({ ...application }).toEqual({ catalog: application.catalog });
    expect(Object.keys(JSON.parse(JSON.stringify(application)) as object)).toEqual(['catalog']);
    expect(Reflect.get(application, 'dispatcher')).toBeUndefined();
    expect(Reflect.get(application, 'settlement')).toBeUndefined();

    for (const forged of [
      { catalog: application.catalog },
      { ...application },
      Object.assign({}, application)
    ]) {
      expect(() =>
        dispatchCapability({ name: 'server_status', arguments: {} }, {
          application: forged,
          transport: 'stdio'
        } as ServerContext)
      ).toThrow(/^Application context is not initialized$/);
    }
  });

  it('keeps the sole facade free of duplicate policy conditions', async () => {
    const source = await readFile('src/capabilities/dispatch.ts', 'utf8');
    for (const forbidden of [
      'readOnly',
      'allowedResource',
      'enabledFeature',
      '.policy',
      '.catalog'
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('formats every refusal code without reflecting raw messages, exceptions, or secrets', () => {
    const codes: RefusalCode[] = [
      'CANCELLED',
      'CONFIRMATION_DECLINED',
      'CONFIRMATION_INVALID',
      'CONFIRMATION_UNAVAILABLE',
      'EXECUTION_FAILED',
      'FEATURE_DISABLED',
      'INVALID_INPUT',
      'INVALID_OUTPUT',
      'INVALID_POLICY',
      'OUTCOME_INDETERMINATE',
      'READ_ONLY',
      'RESOURCE_NOT_ALLOWED',
      'TIMEOUT',
      'UNKNOWN_CAPABILITY',
      'UNSUPPORTED_TRANSPORT'
    ];
    for (const code of codes) {
      const direct = refusalResult(code);
      const formatted = formatCapabilityResult({
        kind: 'refused',
        code,
        message: 'SENTINEL_SECRET raw Zod issue stack requestState HMAC_KEY'
      });
      expect(formatted).toEqual(direct);
      expect(formatted.structuredContent).toEqual({ code });
      expect(JSON.stringify(formatted)).not.toMatch(
        /SENTINEL_SECRET|Zod|stack|requestState|HMAC_KEY/u
      );
    }
  });
});

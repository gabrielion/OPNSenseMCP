// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import * as runtimeConfig from '../../src/config/runtime-config.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';

describe('loadRuntimeConfig', () => {
  it('resolves bounded platform-default configuration paths without consulting process state', () => {
    const resolveDefaultOPNsenseConfigPath = Reflect.get(
      runtimeConfig,
      'resolveDefaultOPNsenseConfigPath'
    ) as unknown;

    expect(resolveDefaultOPNsenseConfigPath).toEqual(expect.any(Function));
    if (typeof resolveDefaultOPNsenseConfigPath !== 'function') return;

    const resolve = resolveDefaultOPNsenseConfigPath as (
      platform: NodeJS.Platform,
      environment: { HOME?: string; XDG_CONFIG_HOME?: string; APPDATA?: string }
    ) => string | undefined;
    expect(resolve('darwin', { HOME: '/Users/tester' })).toBe(
      '/Users/tester/Library/Application Support/opnsense-mcp/config.json'
    );
    expect(resolve('linux', { XDG_CONFIG_HOME: '/var/config', HOME: '/home/tester' })).toBe(
      '/var/config/opnsense-mcp/config.json'
    );
    expect(resolve('linux', { HOME: '/home/tester' })).toBe(
      '/home/tester/.config/opnsense-mcp/config.json'
    );
    expect(resolve('win32', { APPDATA: 'C:\\Users\\tester\\AppData\\Roaming' })).toBe(
      'C:\\Users\\tester\\AppData\\Roaming\\opnsense-mcp\\config.json'
    );
    expect(resolve('linux', { HOME: 'relative' })).toBeUndefined();
    expect(resolve('win32', { APPDATA: 'relative' })).toBeUndefined();
  });

  it('defaults to read-only stdio with a private ephemeral request-state key', () => {
    const config = loadRuntimeConfig({});

    expect(config.readOnly).toBe(true);
    expect(config.http.enabled).toBe(false);
    expect(config.http.host).toBe('127.0.0.1');
    expect(config.http.allowedOrigins).toEqual([]);
    expect(config.http.legacySseEnabled).toBe(false);
    expect(config.requestStateKey).toBeInstanceOf(Uint8Array);
    expect(config.requestStateKey).toHaveLength(32);
    expect(config.allowedResourceScopes).toBeNull();
    expect(config.enabledFeatureFlags.size).toBe(0);
    expect(config.opnsenseConfigFile).toBeUndefined();
  });

  it('parses explicit policy lists and a supplied request-state key', () => {
    const config = loadRuntimeConfig({
      READ_ONLY: 'false',
      ALLOWED_RESOURCES: 'firewall.rule, dns.host,firewall.rule',
      ENABLED_FEATURE_FLAGS: 'advanced-api,ssh',
      MCP_ALLOWED_ORIGINS: 'https://console.example:8443',
      MCP_REQUEST_STATE_SECRET: '0123456789abcdef0123456789abcdef',
      OPNSENSE_CONFIG_FILE: '/private/opnsense-config.json'
    });

    expect(config.readOnly).toBe(false);
    expect(config.allowedResourceScopes).toEqual(new Set(['firewall.rule', 'dns.host']));
    expect(config.enabledFeatureFlags).toEqual(new Set(['advanced-api', 'ssh']));
    expect(config.http.allowedOrigins).toEqual(['https://console.example:8443']);
    expect(new TextDecoder().decode(config.requestStateKey)).toBe(
      '0123456789abcdef0123456789abcdef'
    );
    expect(config.opnsenseConfigFile).toBe('/private/opnsense-config.json');
  });

  it('requires authentication whenever HTTP is enabled', () => {
    expect(() => loadRuntimeConfig({ MCP_HTTP_ENABLED: 'true' })).toThrow(
      'Invalid runtime configuration: MCP_HTTP_TOKEN'
    );
  });

  it('never includes a supplied secret in an error', () => {
    const secret = 'short-secret';

    expect(() => loadRuntimeConfig({ MCP_HTTP_ENABLED: 'true', MCP_HTTP_TOKEN: secret })).toThrow(
      'Invalid runtime configuration: MCP_HTTP_TOKEN'
    );

    try {
      loadRuntimeConfig({ MCP_HTTP_ENABLED: 'true', MCP_HTTP_TOKEN: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('rejects unknown feature flags and non-loopback HTTP hosts', () => {
    expect(() => loadRuntimeConfig({ ENABLED_FEATURE_FLAGS: 'unknown' })).toThrow(
      'Invalid runtime configuration: ENABLED_FEATURE_FLAGS'
    );
    expect(() => loadRuntimeConfig({ MCP_HTTP_HOST: '0.0.0.0' })).toThrow(
      'Invalid runtime configuration: MCP_HTTP_HOST'
    );
  });

  it('requires exact serialized HTTP origins and rejects opaque or malformed values', () => {
    for (const origin of [
      'null',
      'not-an-origin',
      'https://console.example/',
      'https://console.example:443'
    ]) {
      expect(() => loadRuntimeConfig({ MCP_ALLOWED_ORIGINS: origin })).toThrow(
        'Invalid runtime configuration: MCP_ALLOWED_ORIGINS'
      );
    }
  });

  it('does not enable deprecated SSE independently of hardened HTTP', () => {
    expect(() => loadRuntimeConfig({ MCP_LEGACY_SSE_ENABLED: 'true' })).toThrow(
      'Invalid runtime configuration: MCP_LEGACY_SSE_ENABLED'
    );
  });
});

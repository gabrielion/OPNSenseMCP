// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { createOPNsenseHttpsClient } from '../../src/opnsense/https-client.js';
import type { OPNsenseConnectionConfig } from '../../src/opnsense/config.js';
import { startSyntheticOPNsenseTarget } from '../support/https-opnsense-mock.js';

function config(
  url: string,
  overrides: Partial<OPNsenseConnectionConfig> = {}
): OPNsenseConnectionConfig {
  return {
    url,
    apiKey: 'test-key',
    apiSecret: 'test-secret',
    timeoutMs: 1000,
    maxResponseBytes: 4096,
    ...overrides
  };
}

function request(
  method: 'GET' | 'POST',
  path: string,
  overrides: Partial<Parameters<ReturnType<typeof createOPNsenseHttpsClient>['request']>[0]> = {}
) {
  return {
    method,
    path,
    ...(method === 'POST' ? { body: { page: 1 } } : {}),
    maxInputBytes: 1024,
    maxResponseBytes: 1024,
    signal: new AbortController().signal,
    ...overrides
  };
}

describe('closed OPNsense HTTPS client', () => {
  it('uses exact Basic auth/method/path and omits GET body/content-type', async () => {
    const target = await startSyntheticOPNsenseTarget(() => ({ body: '{"ok":true}' }));
    const client = createOPNsenseHttpsClient(config(target.url, { ca: target.ca }));
    try {
      await expect(client.request(request('GET', '/api/core/system/status'))).resolves.toEqual({
        ok: true
      });
      await expect(
        client.request(
          request('POST', '/api/core/service/search', {
            body: { current: 2, rowCount: 25, sort: {}, searchPhrase: 'dns' }
          })
        )
      ).resolves.toEqual({ ok: true });

      expect(target.requests).toHaveLength(2);
      expect(target.requests[0]).toMatchObject({
        method: 'GET',
        path: '/api/core/system/status',
        body: ''
      });
      expect(target.requests[0]?.headers.authorization).toBe('Basic dGVzdC1rZXk6dGVzdC1zZWNyZXQ=');
      expect(target.requests[0]?.headers['content-type']).toBeUndefined();
      expect(target.requests[0]?.headers['content-length']).toBeUndefined();
      expect(target.requests[1]).toMatchObject({
        method: 'POST',
        path: '/api/core/service/search',
        body: JSON.stringify({ current: 2, rowCount: 25, sort: {}, searchPhrase: 'dns' })
      });
      expect(target.requests[1]?.headers['content-type']).toBe('application/json');
    } finally {
      client.close();
      await target.close();
    }
  });

  it('rejects the synthetic certificate by default and succeeds only with its explicit CA', async () => {
    const target = await startSyntheticOPNsenseTarget(() => ({ body: '{"ok":true}' }));
    const defaultTrust = createOPNsenseHttpsClient(config(target.url));
    const explicitCa = createOPNsenseHttpsClient(config(target.url, { ca: target.ca }));
    try {
      await expect(defaultTrust.request(request('GET', '/api/core/system/status'))).rejects.toThrow(
        /^OPNsense request failed\.$/u
      );
      await expect(explicitCa.request(request('GET', '/api/core/system/status'))).resolves.toEqual({
        ok: true
      });
    } finally {
      defaultTrust.close();
      explicitCa.close();
      await target.close();
    }
  });

  it('times out, honors caller cancellation, and refuses work after idempotent close', async () => {
    const target = await startSyntheticOPNsenseTarget(() => ({
      delayMs: 250,
      body: '{"sentinel":"SENTINEL_DELAYED_BODY"}'
    }));
    const timed = createOPNsenseHttpsClient(config(target.url, { ca: target.ca, timeoutMs: 20 }));
    const cancelled = createOPNsenseHttpsClient(config(target.url, { ca: target.ca }));
    try {
      await expect(timed.request(request('GET', '/api/core/system/status'))).rejects.toThrow(
        /^OPNsense request failed\.$/u
      );
      const controller = new AbortController();
      const pending = cancelled.request(
        request('GET', '/api/core/system/status', { signal: controller.signal })
      );
      controller.abort();
      await expect(pending).rejects.toThrow(/^OPNsense request failed\.$/u);
      cancelled.close();
      cancelled.close();
      await expect(cancelled.request(request('GET', '/api/core/system/status'))).rejects.toThrow(
        /^OPNsense client is closed\.$/u
      );
    } finally {
      timed.close();
      cancelled.close();
      await target.close();
    }
  });

  it.each([
    {
      label: 'oversized response',
      response: { body: JSON.stringify({ sentinel: 'SENTINEL_RESPONSE'.repeat(50) }) },
      limit: 32
    },
    {
      label: 'oversized chunked response',
      response: {
        headers: { 'transfer-encoding': 'chunked' },
        body: JSON.stringify({ sentinel: 'SENTINEL_CHUNK'.repeat(50) })
      },
      limit: 32
    },
    {
      label: 'non-2xx response',
      response: { statusCode: 503, body: '{"sentinel":"SENTINEL_STATUS"}' },
      limit: 1024
    },
    {
      label: 'redirect response',
      response: {
        statusCode: 302,
        headers: { location: '/api/SENTINEL_REDIRECT_TARGET' },
        body: '{"sentinel":"SENTINEL_REDIRECT"}'
      },
      limit: 1024
    },
    {
      label: 'non-JSON response',
      response: { headers: { 'content-type': 'text/plain' }, body: 'SENTINEL_NOT_JSON' },
      limit: 1024
    },
    {
      label: 'invalid JSON response',
      response: { body: '{"sentinel":"SENTINEL_INVALID_JSON"' },
      limit: 1024
    }
  ])('returns one sanitized fixed error for $label', async ({ response, limit }) => {
    const target = await startSyntheticOPNsenseTarget(() => response);
    const client = createOPNsenseHttpsClient(config(target.url, { ca: target.ca }));
    try {
      let thrown: unknown;
      try {
        await client.request(
          request('GET', '/api/core/system/status', { maxResponseBytes: limit })
        );
      } catch (error) {
        thrown = error;
      }
      expect(String(thrown)).toBe('Error: OPNsense request failed.');
      expect(String(thrown)).not.toContain('SENTINEL');
      expect(target.requests).toHaveLength(1);
    } finally {
      client.close();
      await target.close();
    }
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
import { Buffer } from 'node:buffer';
import { ClientRequest, type IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
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

type ClientRequestInput = Parameters<ReturnType<typeof createOPNsenseHttpsClient>['request']>[0];

function forgedRequest(value: unknown): ClientRequestInput {
  return value as ClientRequestInput;
}

function statusRequest(signal = new AbortController().signal): ClientRequestInput {
  return {
    operation: 'system.status/get',
    signal
  };
}

function servicesRequest(
  payload = { current: 2, rowCount: 25, sort: {}, searchPhrase: 'dns' },
  signal = new AbortController().signal
): ClientRequestInput {
  return { operation: 'core.services/list', payload, signal };
}

describe('closed OPNsense HTTPS client', () => {
  it('uses exact Basic auth/method/path and omits GET body/content-type', async () => {
    const target = await startSyntheticOPNsenseTarget(() => ({ body: '{"ok":true}' }));
    const client = createOPNsenseHttpsClient(
      config(target.url, { ca: target.ca, apiSecret: 'test:secret:tail' })
    );
    try {
      await expect(client.request(statusRequest())).resolves.toEqual({
        ok: true
      });
      await expect(client.request(servicesRequest())).resolves.toEqual({ ok: true });

      expect(target.requests).toHaveLength(2);
      expect(target.requests[0]).toMatchObject({
        method: 'GET',
        path: '/api/core/system/status',
        body: ''
      });
      expect(target.requests[0]?.headers.authorization).toBe(
        `Basic ${Buffer.from('test-key:test:secret:tail', 'ascii').toString('base64')}`
      );
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

  it('cannot express a valid-looking arbitrary API path through the public-internal interface', async () => {
    const target = await startSyntheticOPNsenseTarget(() => ({ body: '{"ok":true}' }));
    const client = createOPNsenseHttpsClient(config(target.url, { ca: target.ca }));
    try {
      await expect(
        client.request(
          forgedRequest({
            method: 'GET',
            path: '/api/diagnostics/arbitrary/read',
            maxInputBytes: 1024,
            maxResponseBytes: 1024,
            signal: new AbortController().signal
          })
        )
      ).rejects.toThrow(/^OPNsense request failed\.$/u);
      expect(target.requests).toHaveLength(0);
    } finally {
      client.close();
      await target.close();
    }
  });

  it('refuses a forged unknown operation identity before network I/O', async () => {
    const target = await startSyntheticOPNsenseTarget(() => ({ body: '{"ok":true}' }));
    const client = createOPNsenseHttpsClient(config(target.url, { ca: target.ca }));
    try {
      await expect(
        client.request(
          forgedRequest({
            operation: 'diagnostics.arbitrary/get',
            method: 'GET',
            path: '/api/core/system/status',
            maxInputBytes: 1024,
            maxResponseBytes: 1024,
            signal: new AbortController().signal
          })
        )
      ).rejects.toThrow(/^OPNsense request failed\.$/u);
      expect(target.requests).toHaveLength(0);
    } finally {
      client.close();
      await target.close();
    }
  });

  it.each([
    ['GET payload', { operation: 'system.status/get', payload: {} }],
    [
      'GET method/path override',
      { operation: 'system.status/get', method: 'POST', path: '/api/core/service/search' }
    ],
    ['missing POST payload', { operation: 'core.services/list' }],
    [
      'extra POST payload field',
      {
        operation: 'core.services/list',
        payload: { current: 1, rowCount: 10, sort: {}, searchPhrase: '', extra: true }
      }
    ],
    [
      'wrong POST payload shape',
      {
        operation: 'core.services/list',
        payload: { current: 1, rowCount: 10, sort: [], searchPhrase: '' }
      }
    ]
  ])('enforces exact operation-owned body rules for %s', async (_label, fields) => {
    const target = await startSyntheticOPNsenseTarget(() => ({ body: '{"ok":true}' }));
    const client = createOPNsenseHttpsClient(config(target.url, { ca: target.ca }));
    try {
      await expect(
        client.request(forgedRequest({ ...fields, signal: new AbortController().signal }))
      ).rejects.toThrow(/^OPNsense request failed\.$/u);
      expect(target.requests).toHaveLength(0);
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
      await expect(defaultTrust.request(statusRequest())).rejects.toThrow(
        /^OPNsense request failed\.$/u
      );
      await expect(explicitCa.request(statusRequest())).resolves.toEqual({
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
      await expect(timed.request(statusRequest())).rejects.toThrow(/^OPNsense request failed\.$/u);
      const controller = new AbortController();
      const pending = cancelled.request(statusRequest(controller.signal));
      controller.abort();
      await expect(pending).rejects.toThrow(/^OPNsense request failed\.$/u);
      cancelled.close();
      cancelled.close();
      await expect(cancelled.request(statusRequest())).rejects.toThrow(
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
      limit: 4096
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
    const client = createOPNsenseHttpsClient(
      config(target.url, { ca: target.ca, maxResponseBytes: limit })
    );
    try {
      let thrown: unknown;
      try {
        await client.request(statusRequest());
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

  it('rejects non-identity Content-Encoding before JSON parsing', async () => {
    const target = await startSyntheticOPNsenseTarget(() => ({
      headers: { 'content-encoding': 'gzip' },
      body: '{"status":"would-otherwise-parse"}'
    }));
    const client = createOPNsenseHttpsClient(config(target.url, { ca: target.ca }));
    try {
      await expect(client.request(statusRequest())).rejects.toThrow(/^OPNsense request failed\.$/u);
      expect(target.requests).toHaveLength(1);
    } finally {
      client.close();
      await target.close();
    }
  });

  it.each([
    ['success', { body: '{"status":"ok"}' }],
    ['failure', { headers: { 'content-type': 'text/plain' }, body: 'invalid' }]
  ])('detaches its AbortSignal listener after %s settlement', async (label, response) => {
    const target = await startSyntheticOPNsenseTarget(() => response);
    const client = createOPNsenseHttpsClient(config(target.url, { ca: target.ca }));
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    try {
      const settlement = client.request(statusRequest(controller.signal));
      if (label === 'success') await expect(settlement).resolves.toEqual({ status: 'ok' });
      else await expect(settlement).rejects.toThrow(/^OPNsense request failed\.$/u);
      const abortHandler = add.mock.calls.find(([type]) => type === 'abort')?.[1];
      expect(abortHandler).toEqual(expect.any(Function));
      expect(remove).toHaveBeenCalledWith('abort', abortHandler);
    } finally {
      client.close();
      await target.close();
    }
  });

  it('preserves listeners it does not own when a response fails', async () => {
    const target = await startSyntheticOPNsenseTarget(() => ({
      headers: { 'content-type': 'text/plain' },
      body: 'invalid'
    }));
    const client = createOPNsenseHttpsClient(config(target.url, { ca: target.ca }));
    const external = vi.fn();
    let observedResponse: IncomingMessage | undefined;
    // Retaining the unbound method is intentional: the wrapper forwards each request instance.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalEmit = ClientRequest.prototype.emit;
    const emit = vi.spyOn(ClientRequest.prototype, 'emit').mockImplementation(function (
      this: ClientRequest,
      event: string | symbol,
      ...args: unknown[]
    ) {
      if (event === 'response') {
        observedResponse = args[0] as IncomingMessage;
        observedResponse.on('close', external);
      }
      return Reflect.apply(originalEmit, this, [event, ...args]);
    });
    try {
      await expect(client.request(statusRequest())).rejects.toThrow(/^OPNsense request failed\.$/u);
      expect(observedResponse).toBeDefined();
      expect(observedResponse?.listeners('close')).toContain(external);
    } finally {
      emit.mockRestore();
      client.close();
      await target.close();
    }
  });
});

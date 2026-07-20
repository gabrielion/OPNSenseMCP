// SPDX-License-Identifier: AGPL-3.0-or-later
import { Buffer } from 'node:buffer';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { Agent, request as httpsRequest } from 'node:https';
import { getRuntimeOperationDescriptor } from '../operations/loader.js';
import type { RuntimeOperationDescriptor } from '../operations/types.js';
import type { OPNsenseConnectionConfig } from './config.js';

const REQUEST_FAILED_MESSAGE = 'OPNsense request failed.';
const CLOSED_CLIENT_MESSAGE = 'OPNsense client is closed.';

export interface SystemStatusHttpsRequest {
  readonly operation: 'system.status/get';
  readonly signal: AbortSignal;
}

export interface CoreServicesListPayload {
  readonly current: number;
  readonly rowCount: number;
  readonly sort: Readonly<Record<string, never>>;
  readonly searchPhrase: string;
}

export interface CoreServicesHttpsRequest {
  readonly operation: 'core.services/list';
  readonly payload: CoreServicesListPayload;
  readonly signal: AbortSignal;
}

export type ClosedOPNsenseRequest = SystemStatusHttpsRequest | CoreServicesHttpsRequest;

export interface OPNsenseHttpsClient {
  request(request: ClosedOPNsenseRequest): Promise<unknown>;
  close(): void;
}

interface ResolvedRequest {
  readonly operation: RuntimeOperationDescriptor;
  readonly body?: CoreServicesListPayload;
  readonly signal: AbortSignal;
}

function requestFailure(): Error {
  return new Error(REQUEST_FAILED_MESSAGE);
}

function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true;
}

function isIdentityContentEncoding(value: string | readonly string[] | undefined): boolean {
  return (
    value === undefined || (typeof value === 'string' && value.trim().toLowerCase() === 'identity')
  );
}

function strictJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw requestFailure();
  }
}

function declaredLength(response: IncomingMessage): number | undefined {
  const value = response.headers['content-length'];
  if (value === undefined || Array.isArray(value) || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    return value === undefined ? undefined : Number.NaN;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => actual.includes(key)) &&
    actual.every((key) => typeof key === 'string')
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireOperation(
  resource: string,
  name: string,
  expected: {
    readonly method: 'GET' | 'POST';
    readonly path: string;
    readonly maxInputBytes: number;
    readonly maxOutputBytes: number;
    readonly maxItems: number;
  }
): RuntimeOperationDescriptor {
  const operation = getRuntimeOperationDescriptor(resource, name);
  if (
    operation?.resourceScope !== resource ||
    operation.command.method !== expected.method ||
    operation.command.path !== expected.path ||
    operation.limits.maxInputBytes !== expected.maxInputBytes ||
    operation.limits.maxOutputBytes !== expected.maxOutputBytes ||
    operation.limits.maxItems !== expected.maxItems
  ) {
    throw new Error('Invalid OPNsense read contract');
  }
  return operation;
}

const SYSTEM_STATUS_OPERATION = requireOperation('system.status', 'get', {
  method: 'GET',
  path: '/api/core/system/status',
  maxInputBytes: 256,
  maxOutputBytes: 4096,
  maxItems: 1
});
const CORE_SERVICES_OPERATION = requireOperation('core.services', 'list', {
  method: 'POST',
  path: '/api/core/service/search',
  maxInputBytes: 2048,
  maxOutputBytes: 131072,
  maxItems: 100
});

function resolveClosedRequest(request: unknown): ResolvedRequest | undefined {
  try {
    if (!isPlainRecord(request) || !(request.signal instanceof AbortSignal)) return undefined;
    if (request.operation === 'system.status/get') {
      if (!hasExactKeys(request, ['operation', 'signal'])) return undefined;
      return { operation: SYSTEM_STATUS_OPERATION, signal: request.signal };
    }
    if (request.operation !== 'core.services/list') return undefined;
    if (!hasExactKeys(request, ['operation', 'payload', 'signal'])) return undefined;
    const payload = request.payload;
    if (
      !isPlainRecord(payload) ||
      !hasExactKeys(payload, ['current', 'rowCount', 'sort', 'searchPhrase']) ||
      !Number.isInteger(payload.current) ||
      (payload.current as number) < 1 ||
      (payload.current as number) > 1000 ||
      !Number.isInteger(payload.rowCount) ||
      (payload.rowCount as number) < 1 ||
      (payload.rowCount as number) > 100 ||
      !isPlainRecord(payload.sort) ||
      !hasExactKeys(payload.sort, []) ||
      typeof payload.searchPhrase !== 'string' ||
      payload.searchPhrase.length > 128
    ) {
      return undefined;
    }
    return {
      operation: CORE_SERVICES_OPERATION,
      body: {
        current: payload.current as number,
        rowCount: payload.rowCount as number,
        sort: {},
        searchPhrase: payload.searchPhrase
      },
      signal: request.signal
    };
  } catch {
    return undefined;
  }
}

export function createOPNsenseHttpsClient(config: OPNsenseConnectionConfig): OPNsenseHttpsClient {
  const origin = new URL(config.url);
  const agent = new Agent({
    keepAlive: true,
    rejectUnauthorized: true,
    ...(config.ca === undefined ? {} : { ca: config.ca })
  });
  let closed = false;

  return Object.freeze({
    request(closedRequest: ClosedOPNsenseRequest): Promise<unknown> {
      if (closed) return Promise.reject(new Error(CLOSED_CLIENT_MESSAGE));
      const resolved = resolveClosedRequest(closedRequest);
      if (resolved === undefined) return Promise.reject(requestFailure());
      let body: Buffer | undefined;
      try {
        body =
          resolved.body === undefined
            ? undefined
            : Buffer.from(JSON.stringify(resolved.body), 'utf8');
      } catch {
        return Promise.reject(requestFailure());
      }
      if (body !== undefined && body.byteLength > resolved.operation.limits.maxInputBytes) {
        return Promise.reject(requestFailure());
      }
      if (resolved.signal.aborted) return Promise.reject(requestFailure());
      const responseLimit = Math.min(
        config.maxResponseBytes,
        resolved.operation.limits.maxOutputBytes
      );
      const settlement = new Promise<unknown>((resolve, reject) => {
        let settled = false;
        let failing = false;
        let response: IncomingMessage | undefined;
        let request: ClientRequest | undefined;
        let timer: NodeJS.Timeout | undefined;
        const cleanup = () => {
          if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
          }
          resolved.signal.removeEventListener('abort', onAbort);
          request?.off('response', onResponse);
          request?.off('error', onRequestError);
          request?.off('close', onFailureRequestClose);
          response?.off('data', onResponseData);
          response?.off('aborted', onResponseAborted);
          response?.off('error', onResponseError);
          response?.off('end', onResponseEnd);
          response?.off('close', onFailureResponseClose);
        };
        const finishFailure = () => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(requestFailure());
        };
        const maybeFinishFailure = () => {
          if (
            failing &&
            (request === undefined || request.closed) &&
            (response === undefined || response.closed)
          ) {
            finishFailure();
          }
        };
        const onFailureRequestClose = () => {
          maybeFinishFailure();
        };
        const onFailureResponseClose = () => {
          maybeFinishFailure();
        };
        const fail = () => {
          if (settled || failing) return;
          failing = true;
          if (request !== undefined && !request.closed) {
            request.once('close', onFailureRequestClose);
          }
          if (response !== undefined && !response.closed) {
            response.once('close', onFailureResponseClose);
          }
          response?.destroy();
          request?.destroy();
          maybeFinishFailure();
        };
        const succeed = (value: unknown) => {
          if (settled || failing) return;
          settled = true;
          cleanup();
          resolve(value);
        };
        const onAbort = () => {
          fail();
        };
        const onTimeout = () => {
          fail();
        };
        const onRequestError = () => {
          fail();
        };
        const onResponseAborted = () => {
          fail();
        };
        const onResponseError = () => {
          fail();
        };
        const chunks: Buffer[] = [];
        let received = 0;
        const onResponseData = (chunk: Buffer | string) => {
          if (settled || failing) return;
          const bytes = Buffer.from(chunk);
          received += bytes.byteLength;
          if (received > responseLimit) {
            fail();
            return;
          }
          chunks.push(bytes);
        };
        const onResponseEnd = () => {
          if (settled || failing) return;
          try {
            succeed(strictJson(Buffer.concat(chunks, received)));
          } catch {
            fail();
          }
        };
        const onResponse = (incoming: IncomingMessage) => {
          if (settled || failing) {
            incoming.destroy();
            return;
          }
          response = incoming;
          incoming.once('aborted', onResponseAborted);
          incoming.once('error', onResponseError);
          const length = declaredLength(incoming);
          if (
            incoming.statusCode === undefined ||
            incoming.statusCode < 200 ||
            incoming.statusCode >= 300 ||
            !isJsonContentType(incoming.headers['content-type']) ||
            !isIdentityContentEncoding(incoming.headers['content-encoding']) ||
            (length !== undefined && (!Number.isFinite(length) || length > responseLimit))
          ) {
            fail();
            return;
          }
          incoming.on('data', onResponseData);
          incoming.once('end', onResponseEnd);
        };

        resolved.signal.addEventListener('abort', onAbort, { once: true });
        if (resolved.signal.aborted) {
          fail();
          return;
        }
        timer = setTimeout(onTimeout, config.timeoutMs);
        timer.unref();

        const headers: Record<string, string | number> = {
          accept: 'application/json',
          authorization: `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`, 'ascii').toString('base64')}`
        };
        if (body !== undefined) {
          headers['content-type'] = 'application/json';
          headers['content-length'] = body.byteLength;
        }
        try {
          request = httpsRequest({
            protocol: origin.protocol,
            hostname: origin.hostname,
            port: origin.port,
            method: resolved.operation.command.method,
            path: resolved.operation.command.path,
            headers,
            agent,
            rejectUnauthorized: true,
            ...(config.tlsServerName === undefined ? {} : { servername: config.tlsServerName })
          });
          request.once('response', onResponse);
          request.once('error', onRequestError);
          if (body !== undefined) request.end(body);
          else request.end();
        } catch {
          fail();
        }
      });
      return settlement.catch(() => {
        throw requestFailure();
      });
    },
    close(): void {
      if (closed) return;
      closed = true;
      agent.destroy();
    }
  });
}

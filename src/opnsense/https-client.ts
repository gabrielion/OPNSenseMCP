// SPDX-License-Identifier: AGPL-3.0-or-later
import { Buffer } from 'node:buffer';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { Agent, request as httpsRequest } from 'node:https';
import type { OPNsenseConnectionConfig } from './config.js';

const REQUEST_FAILED_MESSAGE = 'OPNsense request failed.';
const CLOSED_CLIENT_MESSAGE = 'OPNsense client is closed.';
const API_PATH = /^\/api\/[A-Za-z0-9/_-]+$/u;

export interface ClosedOPNsenseRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body?: Readonly<Record<string, unknown>>;
  readonly maxInputBytes: number;
  readonly maxResponseBytes: number;
  readonly signal: AbortSignal;
}

export interface OPNsenseHttpsClient {
  request(request: ClosedOPNsenseRequest): Promise<unknown>;
  close(): void;
}

function requestFailure(): Error {
  return new Error(REQUEST_FAILED_MESSAGE);
}

function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true;
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
      if (
        !API_PATH.test(closedRequest.path) ||
        !Number.isInteger(closedRequest.maxInputBytes) ||
        closedRequest.maxInputBytes < 1 ||
        !Number.isInteger(closedRequest.maxResponseBytes) ||
        closedRequest.maxResponseBytes < 1 ||
        (closedRequest.method === 'GET' && closedRequest.body !== undefined) ||
        (closedRequest.method === 'POST' && closedRequest.body === undefined)
      ) {
        return Promise.reject(requestFailure());
      }
      let body: Buffer | undefined;
      try {
        body =
          closedRequest.body === undefined
            ? undefined
            : Buffer.from(JSON.stringify(closedRequest.body), 'utf8');
      } catch {
        return Promise.reject(requestFailure());
      }
      if (body !== undefined && body.byteLength > closedRequest.maxInputBytes) {
        return Promise.reject(requestFailure());
      }
      if (closedRequest.signal.aborted) return Promise.reject(requestFailure());
      const responseLimit = Math.min(config.maxResponseBytes, closedRequest.maxResponseBytes);
      const settlement = new Promise<unknown>((resolve, reject) => {
        let settled = false;
        let response: IncomingMessage | undefined;
        const state: { request?: ClientRequest } = {};
        const timer = setTimeout(() => {
          fail();
        }, config.timeoutMs);
        timer.unref();
        const cleanup = () => {
          clearTimeout(timer);
          closedRequest.signal.removeEventListener('abort', onAbort);
        };
        const fail = () => {
          if (settled) return;
          settled = true;
          cleanup();
          if (response !== undefined) {
            response.removeAllListeners();
            response.once('error', () => {
              settled = true;
            });
            response.destroy();
          }
          if (state.request !== undefined) {
            state.request.removeAllListeners();
            state.request.once('error', () => {
              settled = true;
            });
            state.request.destroy();
          }
          reject(requestFailure());
        };
        const succeed = (value: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        };
        const onAbort = () => {
          fail();
        };
        closedRequest.signal.addEventListener('abort', onAbort, { once: true });

        const headers: Record<string, string | number> = {
          accept: 'application/json',
          authorization: `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`, 'utf8').toString('base64')}`
        };
        if (body !== undefined) {
          headers['content-type'] = 'application/json';
          headers['content-length'] = body.byteLength;
        }
        try {
          state.request = httpsRequest(
            {
              protocol: origin.protocol,
              hostname: origin.hostname,
              port: origin.port,
              method: closedRequest.method,
              path: closedRequest.path,
              headers,
              agent,
              rejectUnauthorized: true
            },
            (incoming) => {
              response = incoming;
              const length = declaredLength(incoming);
              if (
                incoming.statusCode === undefined ||
                incoming.statusCode < 200 ||
                incoming.statusCode >= 300 ||
                !isJsonContentType(incoming.headers['content-type']) ||
                (length !== undefined && (!Number.isFinite(length) || length > responseLimit))
              ) {
                fail();
                return;
              }
              const chunks: Buffer[] = [];
              let received = 0;
              incoming.on('data', (chunk: Buffer | string) => {
                if (settled) return;
                const bytes = Buffer.from(chunk);
                received += bytes.byteLength;
                if (received > responseLimit) {
                  fail();
                  return;
                }
                chunks.push(bytes);
              });
              incoming.once('aborted', fail);
              incoming.once('error', fail);
              incoming.once('end', () => {
                if (settled) return;
                try {
                  succeed(strictJson(Buffer.concat(chunks, received)));
                } catch {
                  fail();
                }
              });
            }
          );
        } catch {
          fail();
          return;
        }
        const request = state.request;
        request.once('error', fail);
        if (body !== undefined) request.end(body);
        else request.end();
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

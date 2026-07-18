// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Request, RequestHandler } from 'express';

function rawHeaderValues(request: Request, name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) {
      const value = request.rawHeaders[index + 1];
      if (value !== undefined) values.push(value);
    }
  }
  return values;
}

function reject(request: Request, response: Parameters<RequestHandler>[1]): void {
  response.once('finish', () => {
    setImmediate(() => {
      if (!request.destroyed) request.destroy();
    });
  });
  response
    .status(403)
    .set('Connection', 'close')
    .json({
      jsonrpc: '2.0',
      error: { code: -32_000, message: 'Forbidden' },
      id: null
    });
}

function parsedHostname(authority: string): string | undefined {
  if (
    authority.length === 0 ||
    /[\s,@/\\]/u.test(authority) ||
    authority.includes('#') ||
    authority.includes('?')
  ) {
    return undefined;
  }

  const bracketed = /^(\[[0-9a-f:.]+\])(?::([0-9]{1,5}))?$/iu.exec(authority);
  const named = /^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/iu.exec(authority);
  const match = bracketed ?? named;
  if (match === null) return undefined;
  const portText = match[2];
  if (portText !== undefined && Number(portText) > 65_535) return undefined;

  try {
    return new URL(`http://${authority}`).hostname;
  } catch {
    return undefined;
  }
}

export function isExactHostname(value: string): boolean {
  return parsedHostname(value) === value;
}

export function exactHostValidation(allowedHosts: readonly string[]): RequestHandler {
  const allowed = new Set(allowedHosts);
  return (request, response, next) => {
    const rawHosts = rawHeaderValues(request, 'host');
    const hostname = rawHosts.length === 1 ? parsedHostname(rawHosts[0] ?? '') : undefined;
    if (hostname === undefined || !allowed.has(hostname)) {
      reject(request, response);
      return;
    }
    next();
  };
}

export function exactOriginValidation(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (request, response, next) => {
    const origins = rawHeaderValues(request, 'origin');
    if (origins.length === 0) {
      next();
      return;
    }
    const origin = origins[0] ?? '';
    if (origins.length !== 1 || origin.includes(',') || !allowed.has(origin)) {
      reject(request, response);
      return;
    }
    next();
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer, type RequestListener, type Server, type ServerOptions } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler, type NodeMcpRequestHandler } from '@modelcontextprotocol/node';
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import {
  buildApplicationHttpSecurity,
  type ApplicationContext,
  type ApplicationHttpSecurity
} from '../app/application-context.js';
import { createServerFactory } from '../mcp/server-factory.js';
import { resolveHttpLimits, type HttpLimits } from './limits.js';
import { exactHostValidation, exactOriginValidation, isExactHostname } from './origin.js';

export interface HttpStartOptions {
  readonly port?: number;
  readonly limits?: Partial<HttpLimits>;
}

export interface HttpRuntime {
  readonly url: string;
  readonly limits: HttpLimits;
  close(): Promise<void>;
}

interface DeadlineClock {
  set(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
  clear(handle: ReturnType<typeof setTimeout>): void;
}

const SYSTEM_CLOCK: DeadlineClock = Object.freeze({
  set: (callback: () => void, milliseconds: number) => setTimeout(callback, milliseconds),
  clear: (handle: ReturnType<typeof setTimeout>) => {
    clearTimeout(handle);
  }
});

export interface HttpRuntimeDependencies {
  readonly createHandler: typeof createMcpHandler;
  readonly adaptHandler: typeof toNodeHandler;
  readonly createNodeServer: (options: ServerOptions, listener: RequestListener) => Server;
  readonly listen: (server: Server, port: number, host: string) => Promise<AddressInfo>;
}

const DEFAULT_DEPENDENCIES: HttpRuntimeDependencies = Object.freeze({
  createHandler: createMcpHandler,
  adaptHandler: toNodeHandler,
  createNodeServer: (options: ServerOptions, listener: RequestListener) =>
    createServer(options, listener),
  listen: (server: Server, port: number, host: string) =>
    new Promise<AddressInfo>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('HTTP server did not expose a TCP address'));
          return;
        }
        resolve(address);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    })
});

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function flattenFailure(value: unknown): Error[] {
  if (value instanceof AggregateError) return value.errors.flatMap(flattenFailure);
  return [toError(value)];
}

function failuresFrom(results: readonly PromiseSettledResult<void>[]): Error[] {
  return results.flatMap((result) =>
    result.status === 'rejected' ? flattenFailure(result.reason) : []
  );
}

async function settleOperations(operations: readonly (() => Promise<void>)[]): Promise<Error[]> {
  return failuresFrom(
    await Promise.allSettled(operations.map((operation) => Promise.resolve().then(operation)))
  );
}

export function createAggregateClose(
  operations: readonly (() => Promise<void>)[],
  recordedFailures: () => readonly Error[] = () => []
): () => Promise<void> {
  let settlement: Promise<void> | undefined;
  return () => {
    settlement ??= (async () => {
      const operationFailures = await settleOperations(operations);
      const failures = [...recordedFailures().flatMap(flattenFailure), ...operationFailures];
      if (failures.length > 0) throw new AggregateError(failures, 'Owned cleanup failed');
    })();
    return settlement;
  };
}

function closeNodeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

function diagnose(error: Error): void {
  process.stderr.write(`${error.name}\n`);
}

function rejectUnreadRequest(
  request: Parameters<RequestHandler>[0],
  response: Parameters<RequestHandler>[1],
  status: number,
  error: string
): void {
  response.status(status).set('Connection', 'close').json({ error });
  response.once('finish', () => {
    setImmediate(() => request.destroy());
  });
}

function concurrentRequestLimit(maximum: number): RequestHandler {
  let active = 0;
  return (request, response, next) => {
    if (active >= maximum) {
      rejectUnreadRequest(request, response, 503, 'request_limit_reached');
      return;
    }
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
    };
    response.once('finish', release);
    response.once('close', release);
    next();
  };
}

function bodyReceiptDeadline(milliseconds: number): RequestHandler {
  return (request, response, next) => {
    if (request.readableEnded || request.complete) {
      next();
      return;
    }
    let settled = false;
    const clear = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      rejectUnreadRequest(request, response, 408, 'request_body_timeout');
    }, milliseconds);
    timer.unref();
    request.once('end', clear);
    request.once('aborted', clear);
    request.once('close', clear);
    response.once('finish', clear);
    response.once('close', clear);
    next();
  };
}

const bodyErrorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  void _next;
  if (response.headersSent) return;
  const candidateStatus =
    typeof error === 'object' && error !== null
      ? (error as { readonly status?: unknown }).status
      : undefined;
  const status = candidateStatus === 413 ? 413 : 400;
  rejectUnreadRequest(
    request,
    response,
    status,
    status === 413 ? 'request_body_too_large' : 'invalid_json'
  );
};

function bodyTypeAndDeclaredSize(limit: number): RequestHandler {
  return (request, response, next) => {
    const method = request.method.toUpperCase();
    const contentLength = request.headers['content-length'];
    if (
      contentLength !== undefined &&
      (typeof contentLength !== 'string' || !/^[0-9]+$/u.test(contentLength))
    ) {
      rejectUnreadRequest(request, response, 413, 'request_body_too_large');
      return;
    }
    const declaredLength = contentLength === undefined ? 0 : Number(contentLength);
    const hasTransferEncoding = request.headers['transfer-encoding'] !== undefined;
    const hasBody = declaredLength > 0 || hasTransferEncoding;
    if (new Set(['GET', 'HEAD']).has(method) && hasBody) {
      rejectUnreadRequest(request, response, 400, 'request_body_not_allowed');
      return;
    }
    if (declaredLength > limit) {
      rejectUnreadRequest(request, response, 413, 'request_body_too_large');
      return;
    }
    if (method !== 'POST' && !hasBody) {
      next();
      return;
    }
    const contentType = request.headers['content-type'];
    if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|\s*$)/iu.test(contentType)) {
      rejectUnreadRequest(request, response, 415, 'unsupported_media_type');
      return;
    }
    next();
  };
}

const stopAfterAnswered: RequestHandler = (_request, response, next) => {
  if (!response.headersSent) next();
};

const terminalErrorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  void _next;
  diagnose(toError(error));
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.status(500).json({ error: 'internal_server_error' });
};

interface WritableResponseProjection {
  writeHead: (...arguments_: unknown[]) => unknown;
  once(event: 'finish' | 'close', listener: () => void): unknown;
  destroy(): void;
}

function contentTypeFromWriteHead(arguments_: readonly unknown[]): string | undefined {
  const headers = typeof arguments_[1] === 'string' ? arguments_[2] : arguments_[1];
  if (headers === null || typeof headers !== 'object' || Array.isArray(headers)) return undefined;
  for (const key of Reflect.ownKeys(headers)) {
    if (typeof key === 'string' && key.toLowerCase() === 'content-type') {
      const value = (headers as Record<PropertyKey, unknown>)[key];
      if (typeof value === 'string') return value;
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    }
  }
  return undefined;
}

export function withResponseDeadline(
  handler: NodeMcpRequestHandler,
  limits: Pick<HttpLimits, 'executionTimeoutMs' | 'streamLifetimeMs'>,
  clock: DeadlineClock = SYSTEM_CLOCK
): RequestHandler {
  return (request, response, next) => {
    const projected = response as unknown as WritableResponseProjection;
    const originalWriteHead = projected.writeHead;
    let terminal = false;
    let deadline = clock.set(() => {
      if (terminal) return;
      terminal = true;
      projected.destroy();
    }, limits.executionTimeoutMs);
    let streaming = false;
    const clear = () => {
      if (terminal) return;
      terminal = true;
      clock.clear(deadline);
    };
    projected.once('finish', clear);
    projected.once('close', clear);
    projected.writeHead = (...arguments_: unknown[]) => {
      const contentType = contentTypeFromWriteHead(arguments_);
      if (
        !terminal &&
        !streaming &&
        contentType?.split(';', 1)[0]?.trim().toLowerCase() === 'text/event-stream'
      ) {
        streaming = true;
        clock.clear(deadline);
        deadline = clock.set(() => {
          if (terminal) return;
          terminal = true;
          projected.destroy();
        }, limits.streamLifetimeMs);
      }
      return Reflect.apply(originalWriteHead, response, arguments_);
    };
    const parsedBody = (request as unknown as { readonly body?: unknown }).body;
    void handler(request, response, parsedBody).catch(next);
  };
}

export function buildHttpExpressApplication(
  security: ApplicationHttpSecurity,
  limits: HttpLimits,
  handler: NodeMcpRequestHandler,
  clock: DeadlineClock = SYSTEM_CLOCK
): Express {
  const application = express();
  application.use(exactHostValidation(security.allowedHosts));
  application.use(exactOriginValidation(security.allowedOrigins));
  application.use(concurrentRequestLimit(limits.maxConcurrentRequests));
  application.use(bodyReceiptDeadline(limits.bodyReceiptTimeoutMs));
  application.use(bodyTypeAndDeclaredSize(limits.bodyBytes));
  application.use(express.json({ limit: limits.bodyBytes }));
  application.use(bodyErrorHandler);
  application.use(stopAfterAnswered);
  application.use(security.authenticate);
  application.all('/mcp', withResponseDeadline(handler, limits, clock));
  application.use(terminalErrorHandler);
  return application;
}

function validateSecurity(
  security: ApplicationHttpSecurity,
  portOverride: number | undefined
): number {
  if (!security.enabled) throw new Error('HTTP transport is disabled');
  const configuredHost: string = security.host;
  if (!new Set(['127.0.0.1', 'localhost']).has(configuredHost)) {
    throw new Error('HTTP host must be loopback-only');
  }
  if (security.allowedHosts.length === 0 || !security.allowedHosts.every(isExactHostname)) {
    throw new Error('Invalid HTTP Host allow-list');
  }
  for (const origin of security.allowedOrigins) {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin)
        throw new Error();
    } catch {
      throw new Error('Invalid HTTP Origin allow-list');
    }
  }
  const port = portOverride ?? security.port;
  if (port === 0 && portOverride === 0) return port;
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new Error('Invalid HTTP port');
  }
  return port;
}

export async function startHttpWithDependencies(
  application: ApplicationContext,
  options: HttpStartOptions,
  dependencies: HttpRuntimeDependencies
): Promise<HttpRuntime> {
  const security = buildApplicationHttpSecurity(application);
  const port = validateSecurity(security, options.port);
  const limits = resolveHttpLimits(options.limits);
  let handler: McpHttpHandler | undefined;
  let server: Server | undefined;
  try {
    handler = dependencies.createHandler(createServerFactory(application, 'http'), {
      legacy: 'stateless',
      maxSubscriptions: limits.maxSubscriptions,
      onerror: diagnose
    });
    const nodeHandler = dependencies.adaptHandler(handler, { onerror: diagnose });
    const expressApplication = buildHttpExpressApplication(security, limits, nodeHandler);
    server = dependencies.createNodeServer(
      {
        connectionsCheckingInterval: Math.min(1_000, limits.headersTimeoutMs),
        headersTimeout: limits.headersTimeoutMs,
        keepAliveTimeout: limits.keepAliveTimeoutMs,
        requestTimeout: Math.max(limits.bodyReceiptTimeoutMs, limits.headersTimeoutMs)
      },
      expressApplication
    );
    server.maxRequestsPerSocket = limits.maxRequestsPerSocket;
    const address = await dependencies.listen(server, port, security.host);
    const ownedHandler = handler;
    const ownedServer = server;
    const close = createAggregateClose([
      () => ownedHandler.close(),
      () => closeNodeServer(ownedServer)
    ]);
    return Object.freeze({
      url: `http://${security.host}:${String(address.port)}/mcp`,
      limits,
      close
    });
  } catch (startupFailure) {
    const operations: (() => Promise<void>)[] = [];
    if (handler !== undefined) {
      const initializedHandler = handler;
      operations.push(() => initializedHandler.close());
    }
    if (server !== undefined) {
      const initializedServer = server;
      operations.push(() => closeNodeServer(initializedServer));
    }
    const cleanupFailures = await settleOperations(operations);
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [...flattenFailure(startupFailure), ...cleanupFailures],
        'HTTP startup and cleanup failed'
      );
    }
    throw startupFailure;
  }
}

export function startHttp(
  application: ApplicationContext,
  options: HttpStartOptions = {}
): Promise<HttpRuntime> {
  return startHttpWithDependencies(application, options, DEFAULT_DEPENDENCIES);
}

export { DEFAULT_HTTP_LIMITS } from './limits.js';

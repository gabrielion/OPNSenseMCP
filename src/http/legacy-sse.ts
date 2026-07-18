// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-deprecated */
import { Server as LegacyServer } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult as LegacyCallToolResult,
  type Tool as LegacyTool
} from '@modelcontextprotocol/sdk/types.js';
import type { Express, RequestHandler } from 'express';
import * as z from 'zod/v4';
import {
  listApplicationCapabilities,
  type ApplicationContext
} from '../app/application-context.js';
import { dispatchCapability } from '../capabilities/dispatch.js';
import type {
  CapabilityDefinition,
  CapabilityResult,
  ServerContext
} from '../capabilities/types.js';
import { SERVER_INSTRUCTIONS } from '../mcp/instructions.js';
import type { HttpLimits } from './limits.js';

export const LEGACY_SCHEMA_ERROR = 'Legacy SSE capability schema is not representable';

export interface LegacySseHandle {
  close(): Promise<void>;
}

export interface LegacySseMountOptions {
  readonly application: ApplicationContext;
  readonly authenticate: RequestHandler;
  readonly limits: Pick<HttpLimits, 'maxLegacySseSessions' | 'legacySessionIdleTimeoutMs'>;
  readonly onerror: (error: Error) => void;
}

interface PreparedLegacyTool {
  readonly definition: CapabilityDefinition;
  readonly listed: LegacyTool;
}

interface LegacySession {
  readonly server: LegacyServer;
  readonly transport: SSEServerTransport;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function flattenError(value: unknown): Error[] {
  return value instanceof AggregateError ? value.errors.flatMap(flattenError) : [toError(value)];
}

function rejectedErrors(results: readonly PromiseSettledResult<void>[]): Error[] {
  return results.flatMap((result) =>
    result.status === 'rejected' ? flattenError(result.reason) : []
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isLegacyObjectSchema(value: unknown): value is LegacyTool['inputSchema'] {
  if (!isRecord(value) || value.type !== 'object') return false;
  if (
    value.properties !== undefined &&
    (!isRecord(value.properties) || !Object.values(value.properties).every(isRecord))
  ) {
    return false;
  }
  return (
    value.required === undefined ||
    (Array.isArray(value.required) &&
      value.required.every((entry): entry is string => typeof entry === 'string'))
  );
}

function toLegacyObjectSchema(
  schema: z.ZodType,
  io: 'input' | 'output'
): LegacyTool['inputSchema'] {
  let converted: unknown;
  try {
    converted = z.toJSONSchema(schema, { io });
  } catch {
    throw new Error(LEGACY_SCHEMA_ERROR);
  }
  if (!isLegacyObjectSchema(converted)) throw new Error(LEGACY_SCHEMA_ERROR);
  return converted;
}

function prepareLegacyTools(application: ApplicationContext): readonly PreparedLegacyTool[] {
  return Object.freeze(
    listApplicationCapabilities(application, 'http')
      .filter((definition) => definition.policy.confirmation === 'none')
      .map((definition): PreparedLegacyTool => {
        const listed: LegacyTool = {
          name: definition.mcpName,
          title: definition.title,
          description: definition.description,
          inputSchema: toLegacyObjectSchema(definition.inputSchema, 'input'),
          outputSchema: toLegacyObjectSchema(definition.outputSchema, 'output'),
          annotations: { ...definition.annotations }
        };
        return Object.freeze({ definition, listed: Object.freeze(listed) });
      })
  );
}

function unknownLegacyResult(): LegacyCallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: 'Capability is not available.' }],
    structuredContent: { code: 'UNKNOWN_CAPABILITY' }
  };
}

function formatLegacyResult(result: CapabilityResult): LegacyCallToolResult {
  if (result.kind === 'success') {
    return {
      content: [{ type: 'text', text: JSON.stringify(result.output) }],
      structuredContent: result.output
    };
  }
  if (result.kind === 'refused') {
    return {
      isError: true,
      content: [{ type: 'text', text: result.message }],
      structuredContent: { code: result.code }
    };
  }
  return {
    isError: true,
    content: [{ type: 'text', text: 'Capability confirmation is unavailable.' }],
    structuredContent: { code: 'CONFIRMATION_UNAVAILABLE' }
  };
}

function buildLegacySseServer(
  application: ApplicationContext,
  prepared: readonly PreparedLegacyTool[],
  onerror: (error: Error) => void
): LegacyServer {
  const byName = new Map(prepared.map((entry) => [entry.definition.mcpName, entry] as const));
  const server = new LegacyServer(
    { name: 'opnsense-mcp', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS }
  );
  server.onerror = onerror;
  server.registerCapabilities({ tools: {} });
  server.setRequestHandler(ListToolsRequestSchema, () =>
    Promise.resolve({ tools: prepared.map(({ listed }) => listed) })
  );
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const entry = byName.get(request.params.name);
    if (entry === undefined) return unknownLegacyResult();
    const context: ServerContext = {
      application,
      transport: 'http',
      signal: extra.signal,
      principalId: extra.authInfo?.clientId ?? 'http:local-bearer'
    };
    return formatLegacyResult(
      await dispatchCapability(
        { name: entry.definition.mcpName, arguments: request.params.arguments ?? {} },
        context
      )
    );
  });
  return server;
}

export function mountLegacySseCompatibility(
  router: Express,
  options: LegacySseMountOptions
): LegacySseHandle {
  const prepared = prepareLegacyTools(options.application);
  const sessions = new Map<string, LegacySession>();
  let closing = false;
  let closePromise: Promise<void> | undefined;

  function forgetSession(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (session === undefined) return;
    sessions.delete(sessionId);
    if (session.idleTimer !== undefined) clearTimeout(session.idleTimer);
    session.idleTimer = undefined;
  }

  async function closeSession(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (session === undefined) return;
    forgetSession(sessionId);
    await session.server.close();
  }

  function touchSession(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (session === undefined) return;
    if (session.idleTimer !== undefined) clearTimeout(session.idleTimer);
    const idleTimer = setTimeout(() => {
      void closeSession(sessionId).catch(options.onerror);
    }, options.limits.legacySessionIdleTimeoutMs);
    idleTimer.unref();
    session.idleTimer = idleTimer;
  }

  router.get('/sse', options.authenticate, (_request, response, next) => {
    void (async () => {
      if (closing || sessions.size >= options.limits.maxLegacySseSessions) {
        response.status(503).json({ error: 'legacy_sse_capacity_reached' });
        return;
      }
      const transport = new SSEServerTransport('/messages', response);
      const server = buildLegacySseServer(options.application, prepared, options.onerror);
      const sessionId = transport.sessionId;
      sessions.set(sessionId, { server, transport, idleTimer: undefined });
      server.onclose = () => {
        forgetSession(sessionId);
      };
      try {
        await server.connect(transport);
        touchSession(sessionId);
      } catch (startupFailure) {
        const cleanupFailures = rejectedErrors(await Promise.allSettled([closeSession(sessionId)]));
        if (cleanupFailures.length > 0) {
          throw new AggregateError(
            [...flattenError(startupFailure), ...cleanupFailures],
            'Legacy SSE session startup and cleanup failed'
          );
        }
        throw startupFailure;
      }
    })().catch(next);
  });

  router.post('/messages', options.authenticate, (request, response, next) => {
    void (async () => {
      const candidate = request.query.sessionId;
      if (typeof candidate !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(candidate)) {
        response.status(400).json({ error: 'invalid_legacy_session' });
        return;
      }
      const session = sessions.get(candidate);
      if (session === undefined) {
        response.status(404).json({ error: 'legacy_session_not_found' });
        return;
      }
      touchSession(candidate);
      const parsedBody = (request as unknown as { readonly body?: unknown }).body;
      await session.transport.handlePostMessage(request, response, parsedBody);
      touchSession(candidate);
    })().catch(next);
  });

  return Object.freeze({
    close() {
      closePromise ??= (async () => {
        closing = true;
        const failures = rejectedErrors(
          await Promise.allSettled([...sessions.keys()].map(closeSession))
        );
        if (failures.length > 0) throw new AggregateError(failures, 'Legacy SSE cleanup failed');
      })();
      return closePromise;
    }
  });
}

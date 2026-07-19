// SPDX-License-Identifier: AGPL-3.0-or-later
import type {
  CallToolResult,
  InputRequiredResult,
  JsonSchemaType,
  McpServer,
  RequestStateCodec,
  ServerContext as McpServerContext,
  Tool
} from '@modelcontextprotocol/server';
import { isInputRequiredResult } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  listApplicationCapabilities,
  type ApplicationContext
} from '../app/application-context.js';
import { dispatchCapability } from '../capabilities/dispatch.js';
import type { CapabilityRequest, ServerContext, TransportKind } from '../capabilities/types.js';
import {
  definitionUsesElicitation,
  handleConfirmationCall,
  principalForRequest,
  type ConfirmationState
} from './confirmation.js';
import { formatCapabilityResult } from './results.js';

function requestCarriesContinuation(context: McpServerContext): boolean {
  return (
    context.mcpReq.requestState() !== undefined ||
    context.mcpReq.inputResponses !== undefined ||
    (context.mcpReq.droppedInputResponseKeys?.length ?? 0) > 0
  );
}

interface PreparedTool {
  readonly definition: ReturnType<typeof listApplicationCapabilities>[number];
  readonly listed: Tool;
  readonly advertisedOutputSchema: Readonly<Record<string, unknown>>;
}

function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeJson(nested);
    Object.freeze(value);
  }
  return value;
}

function isJsonSchemaObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isProvablyObjectShapedRoot(schema: Readonly<Record<string, unknown>>): boolean {
  if (
    'properties' in schema ||
    'patternProperties' in schema ||
    'additionalProperties' in schema ||
    'required' in schema
  ) {
    return true;
  }
  for (const keyword of ['oneOf', 'anyOf', 'allOf'] as const) {
    const members = schema[keyword];
    if (Array.isArray(members) && members.length > 0) {
      return members.every(
        (member) =>
          isJsonSchemaObject(member) &&
          (member.type === 'object' || isProvablyObjectShapedRoot(member))
      );
    }
  }
  return false;
}

function discoverySchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchemaType {
  const converted = z.toJSONSchema(schema, { target: 'draft-2020-12', io }) as Readonly<
    Record<string, unknown>
  >;
  if (io === 'input') {
    if (converted.type !== undefined && converted.type !== 'object') {
      throw new Error('Capability input schema is not representable');
    }
    return freezeJson(
      converted.type === undefined ? { ...converted, type: 'object' } : converted
    ) as JsonSchemaType;
  }
  return freezeJson(
    converted.type === undefined && isProvablyObjectShapedRoot(converted)
      ? { ...converted, type: 'object' }
      : converted
  ) as JsonSchemaType;
}

function inputDiscoverySchema(schema: z.ZodType): Tool['inputSchema'] {
  return discoverySchema(schema, 'input') as Tool['inputSchema'];
}

export function registerCapabilities(
  server: McpServer,
  application: ApplicationContext,
  transport: TransportKind,
  codec: RequestStateCodec<ConfirmationState>
): void {
  const prepared = Object.freeze(
    listApplicationCapabilities(application, transport).map((definition): PreparedTool => {
      const inputSchema = inputDiscoverySchema(definition.inputSchema);
      const advertisedOutputSchema = discoverySchema(definition.outputSchema, 'output');
      const listed: Tool = Object.freeze({
        name: definition.mcpName,
        title: definition.title,
        description: definition.description,
        inputSchema,
        outputSchema: advertisedOutputSchema,
        annotations: definition.annotations
      });
      return Object.freeze({ definition, listed, advertisedOutputSchema });
    })
  );
  const byName = new Map(prepared.map((entry) => [entry.definition.mcpName, entry] as const));

  server.server.registerCapabilities({ tools: {} });
  server.server.setRequestHandler('tools/list', () =>
    Promise.resolve({ tools: prepared.map(({ listed }) => listed) })
  );
  server.server.setRequestHandler('tools/call', async (wireRequest, mcpContext) => {
    const entry = byName.get(wireRequest.params.name);
    const request: CapabilityRequest = {
      name: wireRequest.params.name,
      arguments: wireRequest.params.arguments ?? {}
    };
    let result: CallToolResult | InputRequiredResult | undefined;
    if (
      requestCarriesContinuation(mcpContext) ||
      (entry !== undefined && definitionUsesElicitation(entry.definition))
    ) {
      const confirmationResult = await handleConfirmationCall(
        server,
        application,
        request,
        transport,
        codec,
        mcpContext
      );
      if (entry !== undefined) result = confirmationResult;
    }
    if (result === undefined) {
      const context: ServerContext = {
        application,
        transport,
        signal: mcpContext.mcpReq.signal,
        principalId: principalForRequest(transport, mcpContext)
      };
      result = formatCapabilityResult(await dispatchCapability(request, context));
    }
    return isInputRequiredResult(result)
      ? result
      : server.server.projectCallToolResult(result, entry?.advertisedOutputSchema);
  });
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  CLIENT_CAPABILITIES_META_KEY,
  acceptedContent,
  inputRequired,
  inputResponse,
  type CallToolResult,
  type ClientCapabilities,
  type InputRequiredResult,
  type McpServer,
  type RequestStateCodec,
  type ServerContext as McpServerContext
} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  settleApplicationConfirmation,
  type ApplicationContext
} from '../app/application-context.js';
import type {
  CapabilityDefinition,
  CapabilityRequest,
  CapabilityResult,
  ServerContext
} from '../capabilities/types.js';
import { dispatchCapability } from '../capabilities/dispatch.js';
import { formatCapabilityResult, refusalResult } from './results.js';

export const CONFIRMATION_QUESTION = 'Apply this exact OPNsense change?';

export const ConfirmationResponseSchema = z.object({ confirm: z.boolean() }).strict();

export const ConfirmationStateSchema = z
  .object({
    confirmationId: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    capabilityId: z.string().min(1),
    argumentsSha256: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict();

export type ConfirmationState = z.infer<typeof ConfirmationStateSchema>;

interface EnvelopeWithClientCapabilities {
  readonly [CLIENT_CAPABILITIES_META_KEY]?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasFormCapability(value: unknown, legacy: boolean): boolean {
  if (!isRecord(value)) return false;
  const elicitation = value.elicitation;
  if (!isRecord(elicitation)) return false;
  if (legacy && !Object.hasOwn(elicitation, 'form') && !Object.hasOwn(elicitation, 'url')) {
    return true;
  }
  return isRecord(elicitation.form);
}

function clientSupportsForm(
  context: McpServerContext,
  legacyCapabilities: ClientCapabilities | undefined
): boolean {
  if (context.mcpReq.envelope !== undefined) {
    const envelope = context.mcpReq.envelope as EnvelopeWithClientCapabilities;
    return hasFormCapability(envelope[CLIENT_CAPABILITIES_META_KEY], false);
  }
  return hasFormCapability(legacyCapabilities, true);
}

export function principalForRequest(
  transport: ServerContext['transport'],
  context: McpServerContext
): string {
  if (transport === 'stdio') return 'stdio:local-connection';
  return context.http?.authInfo?.clientId ?? 'http:local-bearer';
}

function invocationContext(
  application: ApplicationContext,
  transport: ServerContext['transport'],
  context: McpServerContext
): ServerContext {
  return {
    application,
    transport,
    signal: context.mcpReq.signal,
    principalId: principalForRequest(transport, context)
  };
}

function finish(result: CapabilityResult): CallToolResult {
  if (result.kind === 'confirmation-required') return refusalResult('CONFIRMATION_INVALID');
  return formatCapabilityResult(result);
}

export async function handleConfirmationCall(
  server: McpServer,
  application: ApplicationContext,
  request: CapabilityRequest,
  transport: ServerContext['transport'],
  codec: RequestStateCodec<ConfirmationState>,
  context: McpServerContext
): Promise<CallToolResult | InputRequiredResult> {
  const invocation = invocationContext(application, transport, context);
  const priorState = context.mcpReq.requestState();

  if (priorState !== undefined) {
    const parsedState = ConfirmationStateSchema.safeParse(priorState);
    if (!parsedState.success) return refusalResult('CONFIRMATION_INVALID');

    const response = inputResponse(context.mcpReq.inputResponses, 'confirmation');
    const accepted = acceptedContent(
      context.mcpReq.inputResponses,
      'confirmation',
      ConfirmationResponseSchema
    );
    const decision =
      response.kind === 'elicit' && response.action === 'accept' && accepted?.confirm === true
        ? 'accept'
        : 'decline';
    return finish(
      await settleApplicationConfirmation(
        application,
        decision,
        parsedState.data,
        request,
        invocation
      )
    );
  }

  if (
    context.mcpReq.inputResponses !== undefined ||
    (context.mcpReq.droppedInputResponseKeys?.length ?? 0) > 0
  ) {
    return refusalResult('CONFIRMATION_INVALID');
  }
  // beta.4 retains this accessor specifically for the 2025 initialize-scoped compatibility path.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  if (!clientSupportsForm(context, server.server.getClientCapabilities())) {
    return refusalResult('CONFIRMATION_UNAVAILABLE');
  }

  const initial = await dispatchCapability(request, invocation);
  if (initial.kind !== 'confirmation-required') return finish(initial);
  const claims: ConfirmationState = {
    confirmationId: initial.challenge.confirmationId,
    capabilityId: initial.challenge.capabilityId,
    argumentsSha256: initial.challenge.argumentsSha256
  };
  const requestState = await codec.mint(claims, context);
  return inputRequired({
    inputRequests: {
      confirmation: inputRequired.elicit({
        message: CONFIRMATION_QUESTION,
        requestedSchema: {
          type: 'object',
          properties: { confirm: { type: 'boolean' } },
          required: ['confirm']
        }
      })
    },
    requestState
  });
}

export function definitionUsesElicitation(definition: CapabilityDefinition): boolean {
  return definition.policy.confirmation === 'elicitation';
}

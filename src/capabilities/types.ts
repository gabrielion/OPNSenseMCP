// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ToolAnnotations } from '@modelcontextprotocol/server';
import type * as z from 'zod/v4';
import type { FeatureFlag } from '../config/feature-flags.js';

export type TransportKind = 'stdio' | 'http';
export type CapabilityEffect = 'read' | 'local-write' | 'firewall-write';
export type BackupPolicy = 'none' | 'strict';
export type AuditPolicy = 'none' | 'required';
export type ConfirmationPolicy = 'none' | 'elicitation';

export interface CapabilityExecutionContext {
  readonly signal: AbortSignal;
  readonly readOnly: boolean;
  readonly transport: TransportKind;
  readonly principalId?: string;
}

export interface CapabilityPolicy {
  readonly effect: CapabilityEffect;
  readonly resourceScopes: readonly string[];
  readonly requiredFeatureFlags: readonly FeatureFlag[];
  readonly backup: BackupPolicy;
  readonly audit: AuditPolicy;
  readonly confirmation: ConfirmationPolicy;
  readonly timeoutMs: number;
  readonly redactFields: readonly string[];
}

export interface CapabilityDefinition {
  readonly id: string;
  readonly mcpName: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
  readonly outputSchema: z.ZodType;
  readonly annotations: ToolAnnotations;
  readonly transports: readonly TransportKind[];
  readonly policy: CapabilityPolicy;
  readonly parseInput: (value: unknown) => unknown;
  readonly parseOutput: (value: unknown) => Record<string, unknown>;
}

const capabilityHandlers = new WeakMap<
  CapabilityDefinition,
  (input: unknown, context: CapabilityExecutionContext) => Promise<unknown>
>();

interface TypedCapabilityDefinition<
  TInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>
> {
  readonly id: string;
  readonly mcpName: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly annotations: ToolAnnotations;
  readonly transports: readonly TransportKind[];
  readonly policy: CapabilityPolicy;
  readonly handler: (input: TInput, context: CapabilityExecutionContext) => Promise<TOutput>;
}

export function defineCapability<
  TInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>
>(definition: TypedCapabilityDefinition<TInput, TOutput>): CapabilityDefinition {
  const capability: CapabilityDefinition = Object.freeze({
    id: definition.id,
    mcpName: definition.mcpName,
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    annotations: Object.freeze({ ...definition.annotations }),
    transports: Object.freeze([...definition.transports]),
    policy: Object.freeze({
      ...definition.policy,
      resourceScopes: Object.freeze([...definition.policy.resourceScopes]),
      requiredFeatureFlags: Object.freeze([...definition.policy.requiredFeatureFlags]),
      redactFields: Object.freeze([...definition.policy.redactFields])
    }),
    parseInput: (value: unknown) => definition.inputSchema.parse(value),
    parseOutput: (value: unknown) => definition.outputSchema.parse(value)
  });
  capabilityHandlers.set(capability, (input, context) =>
    definition.handler(input as TInput, context)
  );
  return capability;
}

export function invokeCapabilityHandler(
  capability: CapabilityDefinition,
  input: unknown,
  context: CapabilityExecutionContext
): Promise<unknown> {
  const handler = capabilityHandlers.get(capability);
  if (handler === undefined) return Promise.reject(new Error('Undeclared capability handler'));
  return handler(input, context);
}

export interface ExposureContext {
  readonly readOnly: boolean;
  readonly transport: TransportKind;
  readonly enabledFeatureFlags: ReadonlySet<FeatureFlag>;
  readonly allowedResourceScopes: ReadonlySet<string> | null;
}

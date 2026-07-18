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

export interface CapabilityRequest {
  readonly name: string;
  readonly arguments: unknown;
}

export interface CapabilityInvocationContext {
  readonly transport: TransportKind;
  readonly signal?: AbortSignal;
  readonly principalId?: string;
}

export interface ConfirmationChallenge {
  readonly confirmationId: string;
  readonly capabilityId: string;
  readonly argumentsSha256: string;
  readonly expiresAt: string;
}

export type RefusalCode =
  | 'CANCELLED'
  | 'CONFIRMATION_DECLINED'
  | 'CONFIRMATION_INVALID'
  | 'CONFIRMATION_UNAVAILABLE'
  | 'EXECUTION_FAILED'
  | 'FEATURE_DISABLED'
  | 'INVALID_INPUT'
  | 'INVALID_OUTPUT'
  | 'INVALID_POLICY'
  | 'OUTCOME_INDETERMINATE'
  | 'READ_ONLY'
  | 'RESOURCE_NOT_ALLOWED'
  | 'TIMEOUT'
  | 'UNKNOWN_CAPABILITY'
  | 'UNSUPPORTED_TRANSPORT';

export type CapabilityResult =
  | { readonly kind: 'success'; readonly output: Record<string, unknown> }
  | { readonly kind: 'confirmation-required'; readonly challenge: ConfirmationChallenge }
  | { readonly kind: 'refused'; readonly code: RefusalCode; readonly message: string };

export interface CapabilityDispatcher {
  listExposed(transport: TransportKind): readonly CapabilityDefinition[];
  dispatch(
    request: CapabilityRequest,
    context: CapabilityInvocationContext
  ): Promise<CapabilityResult>;
}

export interface ExposureContext {
  readonly readOnly: boolean;
  readonly transport: TransportKind;
  readonly enabledFeatureFlags: ReadonlySet<FeatureFlag>;
  readonly allowedResourceScopes: ReadonlySet<string> | null;
}

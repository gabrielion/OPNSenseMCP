// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ToolAnnotations } from '@modelcontextprotocol/server';
import type * as z from 'zod/v4';
import type { ApplicationContext } from '../app/application-context.js';
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

export interface ResourceCapabilityExecutionContext extends CapabilityExecutionContext {
  readonly effectiveResourceScopes: readonly string[];
}

export interface ResourceResolutionContext {
  readonly visibleResourceScopes: readonly string[];
}

export interface ResourceRefusalDetailByCode {
  readonly UNKNOWN_RESOURCE: {
    readonly suggestions: readonly string[];
  };
  readonly OPERATION_NOT_AVAILABLE: {
    readonly resource: string;
    readonly availableOperations: readonly string[];
  };
  readonly INVALID_RESOURCE_INPUT: {
    readonly resource: string;
    readonly operation: string;
    readonly fields: readonly string[];
  };
  readonly TARGET_UNAVAILABLE: {
    readonly resource: string;
    readonly operation: string;
  };
}

export type ResourceRefusalCode = keyof ResourceRefusalDetailByCode;
export type ResourceRefusalDetails = ResourceRefusalDetailByCode[ResourceRefusalCode];
export type ResourceRefusal = {
  readonly [TCode in ResourceRefusalCode]: {
    readonly code: TCode;
    readonly details: ResourceRefusalDetailByCode[TCode];
  };
}[ResourceRefusalCode];

export type ResourceResolution<TInput extends Record<string, unknown>> =
  | {
      readonly kind: 'resolved';
      readonly input: TInput;
      readonly effectiveResourceScopes: readonly string[];
    }
  | ({
      readonly kind: 'refused';
    } & ResourceRefusal);

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

export interface ServerContext extends CapabilityInvocationContext {
  readonly application: ApplicationContext;
}

export interface ConfirmationChallenge {
  readonly confirmationId: string;
  readonly capabilityId: string;
  readonly argumentsSha256: string;
  readonly expiresAt: string;
}

export type RefusalCode =
  | 'BACKUP_FAILED'
  | 'CANCELLED'
  | 'CONFIRMATION_DECLINED'
  | 'CONFIRMATION_INVALID'
  | 'CONFIRMATION_UNAVAILABLE'
  | 'EXECUTION_FAILED'
  | 'FEATURE_DISABLED'
  | 'INVALID_INPUT'
  | 'INVALID_OUTPUT'
  | 'INVALID_POLICY'
  | 'INVALID_RESOURCE_INPUT'
  | 'LOCK_UNAVAILABLE'
  | 'OPERATION_NOT_AVAILABLE'
  | 'OUTCOME_INDETERMINATE'
  | 'OUTCOME_UNVERIFIED'
  | 'PREFLIGHT_FAILED'
  | 'READ_ONLY'
  | 'RESOURCE_NOT_ALLOWED'
  | 'STATE_REVALIDATION_FAILED'
  | 'TIMEOUT'
  | 'TARGET_UNAVAILABLE'
  | 'UNKNOWN_CAPABILITY'
  | 'UNKNOWN_RESOURCE'
  | 'UNSUPPORTED_TRANSPORT';

export type CapabilityResult =
  | { readonly kind: 'success'; readonly output: Record<string, unknown> }
  | { readonly kind: 'confirmation-required'; readonly challenge: ConfirmationChallenge }
  | {
      readonly kind: 'refused';
      readonly code: RefusalCode;
      readonly message: string;
      readonly details?: ResourceRefusalDetails;
    };

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

// Mutation envelope service seam (Product 2). These are injected, cross-cutting services that a write
// capability's fixed lifecycle uses. They are trusted startup dependencies; they never accept caller data
// beyond the sealed, canonicalized values the kernel supplies.

export interface PreflightResult {
  readonly effectPlanDigest: string;
  readonly observedStateDigest: string;
}

export interface LockHandle {
  release(): Promise<void>;
}

export interface MutationLockManager {
  acquire(targetKey: string, signal: AbortSignal): Promise<LockHandle | null>;
}

export interface BackupService {
  create(scope: string, signal: AbortSignal): Promise<{ readonly backupId: string }>;
  exists(backupId: string): Promise<boolean>;
}

export type AuditPhase = 'intent' | 'result';

export interface AuditRecord {
  readonly capabilityId: string;
  readonly mcpName: string;
  readonly effect: CapabilityEffect;
  readonly argumentsSha256: string;
  readonly effectiveResourceScopes: readonly string[];
  readonly phase: AuditPhase;
  readonly outcome: string;
  readonly backupId?: string;
}

export interface AuditSink {
  record(record: AuditRecord): void;
}

export interface MutationEnvelopeServices {
  readonly lock: MutationLockManager;
  readonly backup: BackupService;
  readonly audit: AuditSink;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import { Buffer } from 'node:buffer';
import { randomBytes as secureRandomBytes } from 'node:crypto';
import { isProxy } from 'node:util/types';
import type { ToolAnnotations } from '@modelcontextprotocol/server';
import type * as z from 'zod/v4';
import { FeatureFlagSchema } from '../config/feature-flags.js';
import type { FeatureFlag } from '../config/feature-flags.js';
import { createCanonicalJsonSnapshot } from '../security/canonical-json.js';
import { PRODUCT_MCP_NAMES } from './resource-scopes.js';
import { areResourceScopesAllowedForEffect } from './exposure.js';
import type {
  ChangeSummary,
  AuditPhase,
  AuditRecord,
  CapabilityDefinition,
  CapabilityDispatcher,
  CapabilityEffect,
  CapabilityExecutionContext,
  CapabilityInvocationContext,
  CapabilityPolicy,
  CapabilityRequest,
  CapabilityResult,
  ExposureContext,
  MutationEnvelopeServices,
  PreflightResult,
  RefusalCode,
  ResourceCapabilityExecutionContext,
  ResourceRefusal,
  ResourceRefusalCode,
  ResourceRefusalDetailByCode,
  ResourceRefusalDetails,
  ResourceResolution,
  ResourceResolutionContext,
  TransportKind
} from './types.js';

const DEFAULT_CONFIRMATION_TTL_MS = 300_000;
const DEFAULT_LEDGER_CAPACITY = 1024;
const MAX_TIMEOUT_MS = 300_000;
const CONFIRMATION_ID_BYTES = 32;
const CONFIRMATION_ID_ATTEMPTS = 4;
const INVALID_CAPABILITY_DEFINITION_MESSAGE = 'Invalid capability definition';
// Capability declarations are startup metadata, never an unbounded data channel.
const MAX_CAPABILITY_METADATA_ARRAY_LENGTH = 128;
const MAX_CAPABILITY_NAME_LENGTH = 256;
const MAX_CAPABILITY_TITLE_LENGTH = 256;
const MAX_CAPABILITY_DESCRIPTION_LENGTH = 4096;
const MAX_RESOURCE_DETAIL_NAME_LENGTH = 128;
const MAX_RESOURCE_DETAIL_ARRAY_LENGTH = 16;
const MAX_RESOURCE_SUGGESTIONS = 3;

const CAPABILITY_DEFINITION_KEYS = Object.freeze([
  'id',
  'mcpName',
  'title',
  'description',
  'inputSchema',
  'outputSchema',
  'annotations',
  'transports',
  'policy',
  'handler'
]);
const RESOURCE_CAPABILITY_DEFINITION_KEYS = Object.freeze([
  'id',
  'mcpName',
  'title',
  'description',
  'inputSchema',
  'outputSchema',
  'annotations',
  'transports',
  'policy',
  'selectableResourceScopes',
  'refusalDetailVocabulary',
  'resolver',
  'handler'
]);
const WRITE_CAPABILITY_DEFINITION_KEYS = Object.freeze([
  'id',
  'mcpName',
  'title',
  'description',
  'inputSchema',
  'outputSchema',
  'annotations',
  'transports',
  'policy',
  'preflight',
  'handler',
  'verifyOutcome'
]);
const WRITE_RESOURCE_CAPABILITY_DEFINITION_KEYS = Object.freeze([
  'id',
  'mcpName',
  'title',
  'description',
  'inputSchema',
  'outputSchema',
  'annotations',
  'transports',
  'policy',
  'selectableResourceScopes',
  'refusalDetailVocabulary',
  'resolver',
  'preflight',
  'handler',
  'verifyOutcome',
  'summarizeChange'
]);
const CAPABILITY_POLICY_KEYS = Object.freeze([
  'effect',
  'resourceScopes',
  'requiredFeatureFlags',
  'backup',
  'audit',
  'confirmation',
  'timeoutMs',
  'redactFields'
]);
const RESOURCE_CAPABILITY_POLICY_KEYS = Object.freeze(
  CAPABILITY_POLICY_KEYS.filter((key) => key !== 'resourceScopes')
);
const TOOL_ANNOTATION_KEYS = Object.freeze([
  'title',
  'readOnlyHint',
  'destructiveHint',
  'idempotentHint',
  'openWorldHint'
]);
const RESOURCE_REFUSAL_DETAIL_VOCABULARY_KEYS = Object.freeze(['operations', 'fields']);

const REFUSAL_MESSAGES: Readonly<Record<RefusalCode, string>> = Object.freeze({
  BACKUP_FAILED: 'Capability refused: a strict verified backup could not be created.',
  CANCELLED: 'Capability execution was cancelled.',
  CONFIRMATION_DECLINED: 'Capability confirmation was declined.',
  CONFIRMATION_INVALID: 'Capability confirmation is invalid.',
  CONFIRMATION_UNAVAILABLE: 'Capability confirmation is unavailable.',
  EXECUTION_FAILED: 'Capability execution failed.',
  FEATURE_DISABLED: 'A required capability feature is disabled.',
  INVALID_INPUT: 'Capability input is invalid.',
  INVALID_OUTPUT: 'Capability output is invalid.',
  INVALID_POLICY: 'Capability policy is invalid.',
  INVALID_RESOURCE_INPUT: 'Resource input is invalid.',
  LOCK_UNAVAILABLE: 'Capability refused: the target mutation lock is unavailable.',
  OPERATION_NOT_AVAILABLE: 'Resource operation is not available.',
  OUTCOME_INDETERMINATE:
    'Capability outcome is indeterminate. Do not retry blindly: verify the current target state before any further change.',
  OUTCOME_UNVERIFIED:
    'Capability outcome could not be verified. Do not retry blindly: verify the current target state before any further change.',
  PREFLIGHT_FAILED: 'Capability refused: the read-only preflight failed.',
  READ_ONLY: 'Capability is disabled in read-only mode.',
  RESOURCE_NOT_ALLOWED: 'Capability resource scope is not allowed.',
  STATE_REVALIDATION_FAILED: 'Capability refused: the target state changed after preflight.',
  TIMEOUT: 'Capability execution timed out.',
  TARGET_UNAVAILABLE: 'OPNsense target is unavailable.',
  UNKNOWN_CAPABILITY: 'Capability is not available.',
  UNKNOWN_RESOURCE: 'Resource is not available.',
  UNSUPPORTED_TRANSPORT: 'Capability is not available on this transport.'
});

/** The MCP layer mirrors this table byte-for-byte; a test pins the two together. */
export { REFUSAL_MESSAGES as KERNEL_REFUSAL_MESSAGES };

type CapabilityHandler = (
  input: Record<string, unknown>,
  context: CapabilityExecutionContext
) => Promise<Record<string, unknown>>;

const capabilityHandlers = new WeakMap<CapabilityDefinition, CapabilityHandler>();
const kernelDefinedCapabilities = new WeakSet<CapabilityDefinition>();
type ResourceResolver = (
  input: Record<string, unknown>,
  context: ResourceResolutionContext
) => ResourceResolution<Record<string, unknown>>;
const resourceResolvers = new WeakMap<CapabilityDefinition, ResourceResolver>();
const resourceSelectableScopes = new WeakMap<CapabilityDefinition, readonly string[]>();
interface SealedResourceRefusalDetailVocabulary {
  readonly operations: ReadonlySet<string>;
  readonly fields: ReadonlySet<string>;
}
const resourceRefusalDetailVocabularies = new WeakMap<
  CapabilityDefinition,
  SealedResourceRefusalDetailVocabulary
>();
const sealedResourceRefusalDetails = new WeakMap<object, ResourceRefusalCode>();

type PreflightCallback = (
  input: Record<string, unknown>,
  context: CapabilityExecutionContext
) => Promise<PreflightResult>;
type VerifyOutcomeCallback = (
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  context: CapabilityExecutionContext
) => Promise<boolean>;
// Write capabilities created by defineWriteCapability run the fixed mutation envelope. Membership in these
// kernel-private maps — not the effect string — is what routes a capability through the envelope, so the
// foundation's plain defineCapability write fixtures keep their existing execution path unchanged.
const writeEnvelopePreflights = new WeakMap<CapabilityDefinition, PreflightCallback>();
type ChangeSummaryProjection = Omit<ChangeSummary, 'resource'>;
const changeSummarizers = new WeakMap<
  CapabilityDefinition,
  (input: Record<string, unknown>) => ChangeSummaryProjection
>();
const SUMMARY_SUBJECT_LIMIT = 72;
const SUMMARY_FIELD_LIMIT = 32;

/**
 * The capability chooses the words; the kernel decides what may cross the boundary. Control
 * characters are removed and every field is length-bounded, so an alias name read back from the
 * firewall cannot inject line breaks or overflow the prompt a human is about to approve.
 */
function sealedSummaryText(value: unknown, limit: number): string {
  const text = typeof value === 'string' ? value : '';
  // Array.from iterates code points, which is what the bound below counts.
  const printable = Array.from(text).filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f);
  });
  if (printable.length <= limit) return printable.join('');
  return `${printable.slice(0, limit - 1).join('')}\u2026`;
}

function sealedChangeSummary(projection: ChangeSummaryProjection, resource: string): ChangeSummary {
  return Object.freeze({
    operation: sealedSummaryText(projection.operation, SUMMARY_FIELD_LIMIT),
    resource: sealedSummaryText(resource, SUMMARY_FIELD_LIMIT),
    subject: sealedSummaryText(projection.subject, SUMMARY_SUBJECT_LIMIT),
    detail: sealedSummaryText(projection.detail, SUMMARY_FIELD_LIMIT)
  });
}
const writeEnvelopeVerifiers = new WeakMap<CapabilityDefinition, VerifyOutcomeCallback>();

export interface TypedCapabilityDefinition<
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

export interface TypedResourceCapabilityDefinition<
  TParsedInput extends Record<string, unknown>,
  TResolvedInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>
> {
  readonly id: string;
  readonly mcpName: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TParsedInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly annotations: ToolAnnotations;
  readonly transports: readonly TransportKind[];
  readonly selectableResourceScopes: readonly string[];
  readonly refusalDetailVocabulary: {
    readonly operations: readonly string[];
    readonly fields: readonly string[];
  };
  readonly policy: Omit<CapabilityPolicy, 'resourceScopes'>;
  readonly resolver: (
    input: TParsedInput,
    context: ResourceResolutionContext
  ) => ResourceResolution<TResolvedInput>;
  readonly handler: (
    input: TResolvedInput,
    context: ResourceCapabilityExecutionContext
  ) => Promise<TOutput>;
}

// Definitions and executable schema/callback graphs are trusted static startup code. This factory seals
// their declaration metadata and captures entry points; it cannot isolate malicious code already running
// in this JavaScript process. Never use this as an admission boundary for third-party plugins.

export interface CapabilityCatalogView {
  getByMcpName(name: string): CapabilityDefinition | undefined;
  listExposed(context: ExposureContext): readonly CapabilityDefinition[];
  /**
   * Every capability the catalogue holds, exposed or not. Used ONLY by the construction-time
   * envelope-services guard, which must not depend on the policy that can hide a write.
   */
  listAll?(): readonly CapabilityDefinition[];
}

export interface CapabilityPolicyOptions {
  readonly readOnly: boolean;
  readonly allowedResourceScopes: ReadonlySet<string> | null;
  readonly enabledFeatureFlags: ReadonlySet<FeatureFlag>;
}

export interface CapabilityKernelRuntime {
  readonly now?: () => number;
  readonly randomBytes?: (size: number) => Uint8Array;
  readonly confirmationTtlMs?: number;
  readonly ledgerCapacity?: number;
}

interface CapabilityKernelInternalHooks {
  readonly retain?: (settlement: Promise<unknown>) => void;
}

export type ConfirmationDecision = 'accept' | 'decline';

export interface ConfirmationClaims {
  readonly confirmationId: string;
  readonly capabilityId: string;
  readonly argumentsSha256: string;
}

export type ConfirmationCompletion = (
  decision: ConfirmationDecision,
  claims: ConfirmationClaims,
  repeatedRequest: CapabilityRequest,
  context: CapabilityInvocationContext
) => Promise<CapabilityResult>;

interface SealedPolicyOptions {
  readonly readOnly: boolean;
  readonly allowedResourceScopes: ReadonlySet<string> | null;
  readonly enabledFeatureFlags: ReadonlySet<FeatureFlag>;
}

interface AuthorizedRequest {
  readonly capability: CapabilityDefinition;
  readonly input: Record<string, unknown>;
  readonly argumentsSha256: string;
  readonly effectiveResourceScopes: readonly string[];
}

type AuthorizationResult =
  | { readonly kind: 'authorized'; readonly authorization: AuthorizedRequest }
  | { readonly kind: 'refused'; readonly result: CapabilityResult };

interface PendingConfirmation {
  readonly confirmationId: string;
  readonly capabilityId: string;
  readonly mcpName: string;
  readonly argumentsSha256: string;
  readonly effectiveResourceScopes: readonly string[];
  readonly transport: TransportKind;
  readonly principalId?: string;
  readonly expiresAtMs: number;
}

type AbortCause = 'caller' | 'timeout';

type HandlerSettlement =
  | { readonly kind: 'fulfilled'; readonly value: Record<string, unknown> }
  | { readonly kind: 'rejected' };

type OperationResult =
  | { readonly kind: 'settled'; readonly settlement: HandlerSettlement }
  | { readonly kind: 'aborted-read'; readonly cause: AbortCause }
  | { readonly kind: 'aborted-write' };

function isValidTimeout(timeoutMs: number): boolean {
  return Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= MAX_TIMEOUT_MS;
}

function refusal(code: RefusalCode, details?: ResourceRefusalDetails): CapabilityResult {
  return Object.freeze({
    kind: 'refused',
    code,
    message: REFUSAL_MESSAGES[code],
    ...(details === undefined ? {} : { details })
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPublicDetailName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_RESOURCE_DETAIL_NAME_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
  );
}

function readSafeDetailNames(
  value: unknown,
  maximumLength: number,
  allowed: ReadonlySet<string>
): readonly string[] {
  const names = copyDenseArray(value, isPublicDetailName);
  if (names.length > maximumLength) throw new Error('Invalid resource refusal details');
  const unique = [...new Set(names)].sort();
  if (unique.some((name) => !allowed.has(name))) {
    throw new Error('Invalid resource refusal details');
  }
  return Object.freeze(unique);
}

function readReviewedDetailName(value: unknown, allowed: ReadonlySet<string>): string {
  if (!isPublicDetailName(value) || !allowed.has(value)) {
    throw new Error('Invalid resource refusal details');
  }
  return value;
}

function sealResourceRefusalDetails<TCode extends ResourceRefusalCode>(
  code: TCode,
  details: ResourceRefusalDetailByCode[TCode]
): ResourceRefusalDetailByCode[TCode] {
  sealedResourceRefusalDetails.set(details, code);
  return details;
}

export function projectSealedResourceRefusalDetails(
  code: RefusalCode,
  details: ResourceRefusalDetails | undefined
): ResourceRefusalDetails | undefined {
  return details !== undefined && sealedResourceRefusalDetails.get(details) === code
    ? details
    : undefined;
}

function readSafeSuggestions(value: unknown, visible: ReadonlySet<string>): readonly string[] {
  const names = copyDenseArray(value, isPublicDetailName);
  if (names.length > MAX_RESOURCE_DETAIL_ARRAY_LENGTH) {
    throw new Error('Invalid resource refusal details');
  }
  return Object.freeze(
    [...new Set(names)]
      .filter((name) => visible.has(name))
      .sort()
      .slice(0, MAX_RESOURCE_SUGGESTIONS)
  );
}

function readVisibleResourceName(value: unknown, visible: ReadonlySet<string>): string {
  if (!isPublicDetailName(value) || !visible.has(value)) {
    throw new Error('Invalid resource refusal details');
  }
  return value;
}

function readResourceRefusal(
  value: unknown,
  visibleResourceScopes: readonly string[],
  vocabulary: SealedResourceRefusalDetailVocabulary
): ResourceRefusal {
  const refusalValue = readPlainOwnDataProperties(value, ['kind', 'code', 'details'], true);
  if (readRequiredProperty(refusalValue, 'kind') !== 'refused') {
    throw new Error('Invalid resource refusal');
  }
  const code = readRequiredProperty(refusalValue, 'code');
  const detailsValue = readRequiredProperty(refusalValue, 'details');
  const visible = new Set(visibleResourceScopes);

  if (code === 'UNKNOWN_RESOURCE') {
    const details = readPlainOwnDataProperties(detailsValue, ['suggestions'], true);
    return Object.freeze({
      code,
      details: sealResourceRefusalDetails(
        code,
        Object.freeze({
          suggestions: readSafeSuggestions(readRequiredProperty(details, 'suggestions'), visible)
        })
      )
    });
  }
  if (code === 'OPERATION_NOT_AVAILABLE') {
    const details = readPlainOwnDataProperties(
      detailsValue,
      ['resource', 'availableOperations'],
      true
    );
    return Object.freeze({
      code,
      details: sealResourceRefusalDetails(
        code,
        Object.freeze({
          resource: readVisibleResourceName(readRequiredProperty(details, 'resource'), visible),
          availableOperations: readSafeDetailNames(
            readRequiredProperty(details, 'availableOperations'),
            MAX_RESOURCE_DETAIL_ARRAY_LENGTH,
            vocabulary.operations
          )
        })
      )
    });
  }
  if (code === 'INVALID_RESOURCE_INPUT') {
    const details = readPlainOwnDataProperties(
      detailsValue,
      ['resource', 'operation', 'fields'],
      true
    );
    return Object.freeze({
      code,
      details: sealResourceRefusalDetails(
        code,
        Object.freeze({
          resource: readVisibleResourceName(readRequiredProperty(details, 'resource'), visible),
          operation: readReviewedDetailName(
            readRequiredProperty(details, 'operation'),
            vocabulary.operations
          ),
          fields: readSafeDetailNames(
            readRequiredProperty(details, 'fields'),
            MAX_RESOURCE_DETAIL_ARRAY_LENGTH,
            vocabulary.fields
          )
        })
      )
    });
  }
  if (code === 'TARGET_UNAVAILABLE') {
    const details = readPlainOwnDataProperties(detailsValue, ['resource', 'operation'], true);
    return Object.freeze({
      code,
      details: sealResourceRefusalDetails(
        code,
        Object.freeze({
          resource: readVisibleResourceName(readRequiredProperty(details, 'resource'), visible),
          operation: readReviewedDetailName(
            readRequiredProperty(details, 'operation'),
            vocabulary.operations
          )
        })
      )
    });
  }
  throw new Error('Invalid resource refusal');
}

function invalidCapabilityDefinition(): never {
  throw new Error(INVALID_CAPABILITY_DEFINITION_MESSAGE);
}

function readPlainOwnDataProperties(
  source: unknown,
  allowedKeys: readonly string[],
  requireAll: boolean
): ReadonlyMap<string, unknown> {
  if (isProxy(source) || !isRecord(source)) return invalidCapabilityDefinition();
  const prototype: unknown = Object.getPrototypeOf(source);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidCapabilityDefinition();
  }

  const allowed = new Set(allowedKeys);
  const descriptors = Object.getOwnPropertyDescriptors(source);
  const values = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      return invalidCapabilityDefinition();
    }
    const descriptor = descriptors[key];
    if (descriptor === undefined || !('value' in descriptor)) {
      return invalidCapabilityDefinition();
    }
    values.set(key, descriptor.value);
  }
  if (requireAll && values.size !== allowedKeys.length) {
    return invalidCapabilityDefinition();
  }
  return values;
}

function readRequiredProperty(values: ReadonlyMap<string, unknown>, key: string): unknown {
  if (!values.has(key)) return invalidCapabilityDefinition();
  return values.get(key);
}

function readBoundedString(value: unknown, maximumLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim().length === 0
  ) {
    return invalidCapabilityDefinition();
  }
  return value;
}

function readSchemaParser(schema: unknown): (value: unknown) => unknown {
  if (isProxy(schema) || !isRecord(schema)) return invalidCapabilityDefinition();
  const descriptor = Object.getOwnPropertyDescriptor(schema, 'parse');
  const parseValue: unknown =
    descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof parseValue !== 'function' ||
    isProxy(parseValue)
  ) {
    return invalidCapabilityDefinition();
  }
  const boundParser: unknown = Function.prototype.bind.call(parseValue, schema);
  if (typeof boundParser !== 'function' || isProxy(boundParser)) {
    return invalidCapabilityDefinition();
  }
  return boundParser as (value: unknown) => unknown;
}

function copyToolAnnotations(value: unknown): ToolAnnotations {
  const source = readPlainOwnDataProperties(value, TOOL_ANNOTATION_KEYS, false);
  const annotations: ToolAnnotations = {};

  if (source.has('title')) {
    annotations.title = readBoundedString(source.get('title'), MAX_CAPABILITY_TITLE_LENGTH);
  }
  for (const key of [
    'readOnlyHint',
    'destructiveHint',
    'idempotentHint',
    'openWorldHint'
  ] as const) {
    if (!source.has(key)) continue;
    const hint = source.get(key);
    if (typeof hint !== 'boolean') return invalidCapabilityDefinition();
    annotations[key] = hint;
  }
  return Object.freeze(annotations);
}

function copyDenseArray<T>(
  value: unknown,
  isValidElement: (element: unknown) => element is T
): readonly T[] {
  if (isProxy(value) || !Array.isArray(value)) return invalidCapabilityDefinition();

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number' ||
    !Number.isInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > MAX_CAPABILITY_METADATA_ARRAY_LENGTH
  ) {
    return invalidCapabilityDefinition();
  }
  const length = lengthDescriptor.value;

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== length + 1) return invalidCapabilityDefinition();

  const copy: T[] = [];
  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor) || !isValidElement(descriptor.value)) {
      return invalidCapabilityDefinition();
    }
    copy.push(descriptor.value);
  }

  for (const key of ownKeys) {
    if (key === 'length') continue;
    if (typeof key !== 'string') return invalidCapabilityDefinition();
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== key) {
      return invalidCapabilityDefinition();
    }
  }
  return Object.freeze(copy);
}

function isTransportKind(value: unknown): value is TransportKind {
  return value === 'stdio' || value === 'http';
}

function isCapabilityEffect(value: unknown): value is CapabilityEffect {
  return value === 'read' || value === 'local-write' || value === 'firewall-write';
}

function isMetadataString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CAPABILITY_NAME_LENGTH &&
    value.trim().length > 0
  );
}

function isFeatureFlag(value: unknown): value is FeatureFlag {
  return FeatureFlagSchema.safeParse(value).success;
}

export function defineCapability<
  TInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>
>(definition: TypedCapabilityDefinition<TInput, TOutput>): CapabilityDefinition {
  try {
    const source = readPlainOwnDataProperties(definition, CAPABILITY_DEFINITION_KEYS, true);
    const id = readBoundedString(readRequiredProperty(source, 'id'), MAX_CAPABILITY_NAME_LENGTH);
    const mcpName = readBoundedString(
      readRequiredProperty(source, 'mcpName'),
      MAX_CAPABILITY_NAME_LENGTH
    );
    const title = readBoundedString(
      readRequiredProperty(source, 'title'),
      MAX_CAPABILITY_TITLE_LENGTH
    );
    const description = readBoundedString(
      readRequiredProperty(source, 'description'),
      MAX_CAPABILITY_DESCRIPTION_LENGTH
    );
    const inputSchema = readRequiredProperty(source, 'inputSchema') as z.ZodType<TInput>;
    const outputSchema = readRequiredProperty(source, 'outputSchema') as z.ZodType<TOutput>;
    const parseInput = readSchemaParser(inputSchema) as (value: unknown) => TInput;
    const parseOutput = readSchemaParser(outputSchema) as (value: unknown) => TOutput;
    const handlerValue = readRequiredProperty(source, 'handler');
    if (typeof handlerValue !== 'function' || isProxy(handlerValue)) {
      return invalidCapabilityDefinition();
    }
    const handler = handlerValue as TypedCapabilityDefinition<TInput, TOutput>['handler'];
    const annotations = copyToolAnnotations(readRequiredProperty(source, 'annotations'));
    const transports = copyDenseArray(readRequiredProperty(source, 'transports'), isTransportKind);
    const sourcePolicy = readPlainOwnDataProperties(
      readRequiredProperty(source, 'policy'),
      CAPABILITY_POLICY_KEYS,
      true
    );
    const effect = readRequiredProperty(sourcePolicy, 'effect');
    const resourceScopes = copyDenseArray(
      readRequiredProperty(sourcePolicy, 'resourceScopes'),
      isMetadataString
    );
    const requiredFeatureFlags = copyDenseArray(
      readRequiredProperty(sourcePolicy, 'requiredFeatureFlags'),
      isFeatureFlag
    );
    const backup = readRequiredProperty(sourcePolicy, 'backup');
    const audit = readRequiredProperty(sourcePolicy, 'audit');
    const confirmation = readRequiredProperty(sourcePolicy, 'confirmation');
    const timeoutMs = readRequiredProperty(sourcePolicy, 'timeoutMs');
    const redactFields = copyDenseArray(
      readRequiredProperty(sourcePolicy, 'redactFields'),
      isMetadataString
    );
    if (
      !isCapabilityEffect(effect) ||
      (backup !== 'none' && backup !== 'strict') ||
      (audit !== 'none' && audit !== 'required') ||
      (confirmation !== 'none' && confirmation !== 'elicitation') ||
      typeof timeoutMs !== 'number' ||
      !isValidTimeout(timeoutMs)
    ) {
      return invalidCapabilityDefinition();
    }
    const policy: CapabilityPolicy = Object.freeze({
      effect,
      resourceScopes,
      requiredFeatureFlags,
      backup,
      audit,
      confirmation,
      timeoutMs,
      redactFields
    });

    const capability: CapabilityDefinition = Object.freeze({
      id,
      mcpName,
      title,
      description,
      inputSchema,
      outputSchema,
      annotations,
      transports,
      policy,
      parseInput: (value: unknown) => parseInput(value),
      parseOutput: (value: unknown) => parseOutput(value)
    });
    capabilityHandlers.set(capability, (input, context) => handler(input as TInput, context));
    kernelDefinedCapabilities.add(capability);
    return capability;
  } catch {
    return invalidCapabilityDefinition();
  }
}

export function defineResourceCapability<
  TParsedInput extends Record<string, unknown>,
  TResolvedInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>
>(
  definition: TypedResourceCapabilityDefinition<TParsedInput, TResolvedInput, TOutput>
): CapabilityDefinition {
  try {
    const source = readPlainOwnDataProperties(
      definition,
      RESOURCE_CAPABILITY_DEFINITION_KEYS,
      true
    );
    const selectableResourceScopes = copyDenseArray(
      readRequiredProperty(source, 'selectableResourceScopes'),
      isPublicDetailName
    );
    if (
      selectableResourceScopes.length === 0 ||
      new Set(selectableResourceScopes).size !== selectableResourceScopes.length
    ) {
      return invalidCapabilityDefinition();
    }
    const vocabularySource = readPlainOwnDataProperties(
      readRequiredProperty(source, 'refusalDetailVocabulary'),
      RESOURCE_REFUSAL_DETAIL_VOCABULARY_KEYS,
      true
    );
    const operations = copyDenseArray(
      readRequiredProperty(vocabularySource, 'operations'),
      isPublicDetailName
    );
    const fields = copyDenseArray(
      readRequiredProperty(vocabularySource, 'fields'),
      isPublicDetailName
    );
    if (new Set(operations).size !== operations.length || new Set(fields).size !== fields.length) {
      return invalidCapabilityDefinition();
    }
    const refusalDetailVocabulary: SealedResourceRefusalDetailVocabulary = Object.freeze({
      operations: new Set(operations),
      fields: new Set(fields)
    });
    const resolverValue = readRequiredProperty(source, 'resolver');
    const handlerValue = readRequiredProperty(source, 'handler');
    if (
      typeof resolverValue !== 'function' ||
      isProxy(resolverValue) ||
      typeof handlerValue !== 'function' ||
      isProxy(handlerValue)
    ) {
      return invalidCapabilityDefinition();
    }
    const sourcePolicy = readPlainOwnDataProperties(
      readRequiredProperty(source, 'policy'),
      RESOURCE_CAPABILITY_POLICY_KEYS,
      true
    );
    const resolver = resolverValue as TypedResourceCapabilityDefinition<
      TParsedInput,
      TResolvedInput,
      TOutput
    >['resolver'];
    const handler = handlerValue as TypedResourceCapabilityDefinition<
      TParsedInput,
      TResolvedInput,
      TOutput
    >['handler'];
    const capability = defineCapability<Record<string, unknown>, TOutput>({
      id: readRequiredProperty(source, 'id') as string,
      mcpName: readRequiredProperty(source, 'mcpName') as string,
      title: readRequiredProperty(source, 'title') as string,
      description: readRequiredProperty(source, 'description') as string,
      inputSchema: readRequiredProperty(source, 'inputSchema') as z.ZodType<
        Record<string, unknown>
      >,
      outputSchema: readRequiredProperty(source, 'outputSchema') as z.ZodType<TOutput>,
      annotations: readRequiredProperty(source, 'annotations') as ToolAnnotations,
      transports: readRequiredProperty(source, 'transports') as readonly TransportKind[],
      policy: {
        effect: readRequiredProperty(sourcePolicy, 'effect') as CapabilityEffect,
        resourceScopes: selectableResourceScopes,
        requiredFeatureFlags: readRequiredProperty(
          sourcePolicy,
          'requiredFeatureFlags'
        ) as readonly FeatureFlag[],
        backup: readRequiredProperty(sourcePolicy, 'backup') as CapabilityPolicy['backup'],
        audit: readRequiredProperty(sourcePolicy, 'audit') as CapabilityPolicy['audit'],
        confirmation: readRequiredProperty(
          sourcePolicy,
          'confirmation'
        ) as CapabilityPolicy['confirmation'],
        timeoutMs: readRequiredProperty(sourcePolicy, 'timeoutMs') as number,
        redactFields: readRequiredProperty(sourcePolicy, 'redactFields') as readonly string[]
      },
      handler: (input, context) =>
        handler(input as TResolvedInput, context as ResourceCapabilityExecutionContext)
    });
    resourceResolvers.set(capability, (input, context) => resolver(input as TParsedInput, context));
    resourceSelectableScopes.set(capability, selectableResourceScopes);
    resourceRefusalDetailVocabularies.set(capability, refusalDetailVocabulary);
    return capability;
  } catch {
    return invalidCapabilityDefinition();
  }
}

export interface TypedWriteCapabilityDefinition<
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
  readonly preflight: (
    input: TInput,
    context: CapabilityExecutionContext
  ) => Promise<PreflightResult>;
  readonly handler: (input: TInput, context: CapabilityExecutionContext) => Promise<TOutput>;
  readonly verifyOutcome: (
    input: TInput,
    output: TOutput,
    context: CapabilityExecutionContext
  ) => Promise<boolean>;
}

// A write capability runs the fixed mutation envelope. It reuses defineCapability for its sealed data-only
// metadata and handler, then captures the read-only preflight and outcome verifier in kernel-private maps.
// It enforces the write policy matrix that the generic factory does not: a real write must be audited, and a
// firewall write must carry a strict backup.
export function defineWriteCapability<
  TInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>
>(definition: TypedWriteCapabilityDefinition<TInput, TOutput>): CapabilityDefinition {
  try {
    const source = readPlainOwnDataProperties(definition, WRITE_CAPABILITY_DEFINITION_KEYS, true);
    const sourcePolicy = readPlainOwnDataProperties(
      readRequiredProperty(source, 'policy'),
      CAPABILITY_POLICY_KEYS,
      true
    );
    const effect = readRequiredProperty(sourcePolicy, 'effect');
    const backup = readRequiredProperty(sourcePolicy, 'backup');
    const audit = readRequiredProperty(sourcePolicy, 'audit');
    if (
      !isCapabilityEffect(effect) ||
      effect === 'read' ||
      audit !== 'required' ||
      (effect === 'firewall-write' && backup !== 'strict')
    ) {
      return invalidCapabilityDefinition();
    }
    const preflightValue = readRequiredProperty(source, 'preflight');
    const verifyOutcomeValue = readRequiredProperty(source, 'verifyOutcome');
    if (
      typeof preflightValue !== 'function' ||
      isProxy(preflightValue) ||
      typeof verifyOutcomeValue !== 'function' ||
      isProxy(verifyOutcomeValue)
    ) {
      return invalidCapabilityDefinition();
    }
    const preflight = preflightValue as TypedWriteCapabilityDefinition<
      TInput,
      TOutput
    >['preflight'];
    const verifyOutcome = verifyOutcomeValue as TypedWriteCapabilityDefinition<
      TInput,
      TOutput
    >['verifyOutcome'];
    const capability = defineCapability<TInput, TOutput>({
      id: readRequiredProperty(source, 'id') as string,
      mcpName: readRequiredProperty(source, 'mcpName') as string,
      title: readRequiredProperty(source, 'title') as string,
      description: readRequiredProperty(source, 'description') as string,
      inputSchema: readRequiredProperty(source, 'inputSchema') as z.ZodType<TInput>,
      outputSchema: readRequiredProperty(source, 'outputSchema') as z.ZodType<TOutput>,
      annotations: readRequiredProperty(source, 'annotations') as ToolAnnotations,
      transports: readRequiredProperty(source, 'transports') as readonly TransportKind[],
      policy: readRequiredProperty(source, 'policy') as CapabilityPolicy,
      handler: readRequiredProperty(source, 'handler') as TypedCapabilityDefinition<
        TInput,
        TOutput
      >['handler']
    });
    writeEnvelopePreflights.set(capability, (input, context) =>
      preflight(input as TInput, context)
    );
    writeEnvelopeVerifiers.set(capability, (input, output, context) =>
      verifyOutcome(input as TInput, output as TOutput, context)
    );
    return capability;
  } catch {
    return invalidCapabilityDefinition();
  }
}

export interface TypedWriteResourceCapabilityDefinition<
  TParsedInput extends Record<string, unknown>,
  TResolvedInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>
> {
  readonly id: string;
  readonly mcpName: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TParsedInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly annotations: ToolAnnotations;
  readonly transports: readonly TransportKind[];
  readonly selectableResourceScopes: readonly string[];
  readonly refusalDetailVocabulary: {
    readonly operations: readonly string[];
    readonly fields: readonly string[];
  };
  readonly policy: Omit<CapabilityPolicy, 'resourceScopes'>;
  readonly resolver: (
    input: TParsedInput,
    context: ResourceResolutionContext
  ) => ResourceResolution<TResolvedInput>;
  readonly preflight: (
    input: TResolvedInput,
    context: ResourceCapabilityExecutionContext
  ) => Promise<PreflightResult>;
  readonly handler: (
    input: TResolvedInput,
    context: ResourceCapabilityExecutionContext
  ) => Promise<TOutput>;
  readonly verifyOutcome: (
    input: TResolvedInput,
    output: TOutput,
    context: ResourceCapabilityExecutionContext
  ) => Promise<boolean>;
  /**
   * Trusted static projection from the RESOLVED input to the words a human sees before approving.
   * The kernel seals and bounds whatever it returns. It must never carry a credential, a raw
   * response, or a path.
   */
  readonly summarizeChange: (input: TResolvedInput) => ChangeSummaryProjection;
}

// A write-resource capability resolves a visible resource exactly like a read resource capability and then
// runs the fixed mutation envelope. It captures the resolver, refusal vocabulary, and selectable scopes in the
// resource maps and the preflight/verifyOutcome in the envelope maps, so authorizeRequest resolves the resource
// and executeAuthorized routes it through executeMutationEnvelope. It enforces the write policy matrix.
export function defineWriteResourceCapability<
  TParsedInput extends Record<string, unknown>,
  TResolvedInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>
>(
  definition: TypedWriteResourceCapabilityDefinition<TParsedInput, TResolvedInput, TOutput>
): CapabilityDefinition {
  try {
    const source = readPlainOwnDataProperties(
      definition,
      WRITE_RESOURCE_CAPABILITY_DEFINITION_KEYS,
      true
    );
    const selectableResourceScopes = copyDenseArray(
      readRequiredProperty(source, 'selectableResourceScopes'),
      isPublicDetailName
    );
    if (
      selectableResourceScopes.length === 0 ||
      new Set(selectableResourceScopes).size !== selectableResourceScopes.length
    ) {
      return invalidCapabilityDefinition();
    }
    const vocabularySource = readPlainOwnDataProperties(
      readRequiredProperty(source, 'refusalDetailVocabulary'),
      RESOURCE_REFUSAL_DETAIL_VOCABULARY_KEYS,
      true
    );
    const operations = copyDenseArray(
      readRequiredProperty(vocabularySource, 'operations'),
      isPublicDetailName
    );
    const fields = copyDenseArray(
      readRequiredProperty(vocabularySource, 'fields'),
      isPublicDetailName
    );
    if (new Set(operations).size !== operations.length || new Set(fields).size !== fields.length) {
      return invalidCapabilityDefinition();
    }
    const refusalDetailVocabulary: SealedResourceRefusalDetailVocabulary = Object.freeze({
      operations: new Set(operations),
      fields: new Set(fields)
    });
    const resolverValue = readRequiredProperty(source, 'resolver');
    const handlerValue = readRequiredProperty(source, 'handler');
    const preflightValue = readRequiredProperty(source, 'preflight');
    const verifyOutcomeValue = readRequiredProperty(source, 'verifyOutcome');
    const summarizeChangeValue = readRequiredProperty(source, 'summarizeChange');
    if (
      typeof resolverValue !== 'function' ||
      isProxy(resolverValue) ||
      typeof handlerValue !== 'function' ||
      isProxy(handlerValue) ||
      typeof preflightValue !== 'function' ||
      isProxy(preflightValue) ||
      typeof verifyOutcomeValue !== 'function' ||
      isProxy(verifyOutcomeValue) ||
      typeof summarizeChangeValue !== 'function' ||
      isProxy(summarizeChangeValue)
    ) {
      return invalidCapabilityDefinition();
    }
    const sourcePolicy = readPlainOwnDataProperties(
      readRequiredProperty(source, 'policy'),
      RESOURCE_CAPABILITY_POLICY_KEYS,
      true
    );
    const effect = readRequiredProperty(sourcePolicy, 'effect');
    const backup = readRequiredProperty(sourcePolicy, 'backup');
    const audit = readRequiredProperty(sourcePolicy, 'audit');
    if (
      !isCapabilityEffect(effect) ||
      effect === 'read' ||
      audit !== 'required' ||
      (effect === 'firewall-write' && backup !== 'strict')
    ) {
      return invalidCapabilityDefinition();
    }
    const resolver = resolverValue as TypedWriteResourceCapabilityDefinition<
      TParsedInput,
      TResolvedInput,
      TOutput
    >['resolver'];
    const handler = handlerValue as TypedWriteResourceCapabilityDefinition<
      TParsedInput,
      TResolvedInput,
      TOutput
    >['handler'];
    const preflight = preflightValue as TypedWriteResourceCapabilityDefinition<
      TParsedInput,
      TResolvedInput,
      TOutput
    >['preflight'];
    const verifyOutcome = verifyOutcomeValue as TypedWriteResourceCapabilityDefinition<
      TParsedInput,
      TResolvedInput,
      TOutput
    >['verifyOutcome'];
    const summarizeChange = summarizeChangeValue as TypedWriteResourceCapabilityDefinition<
      TParsedInput,
      TResolvedInput,
      TOutput
    >['summarizeChange'];
    const capability = defineCapability<Record<string, unknown>, TOutput>({
      id: readRequiredProperty(source, 'id') as string,
      mcpName: readRequiredProperty(source, 'mcpName') as string,
      title: readRequiredProperty(source, 'title') as string,
      description: readRequiredProperty(source, 'description') as string,
      inputSchema: readRequiredProperty(source, 'inputSchema') as z.ZodType<
        Record<string, unknown>
      >,
      outputSchema: readRequiredProperty(source, 'outputSchema') as z.ZodType<TOutput>,
      annotations: readRequiredProperty(source, 'annotations') as ToolAnnotations,
      transports: readRequiredProperty(source, 'transports') as readonly TransportKind[],
      policy: {
        effect,
        resourceScopes: selectableResourceScopes,
        requiredFeatureFlags: readRequiredProperty(
          sourcePolicy,
          'requiredFeatureFlags'
        ) as readonly FeatureFlag[],
        backup: backup as CapabilityPolicy['backup'],
        audit: audit as CapabilityPolicy['audit'],
        confirmation: readRequiredProperty(
          sourcePolicy,
          'confirmation'
        ) as CapabilityPolicy['confirmation'],
        timeoutMs: readRequiredProperty(sourcePolicy, 'timeoutMs') as number,
        redactFields: readRequiredProperty(sourcePolicy, 'redactFields') as readonly string[]
      },
      handler: (input, context) =>
        handler(input as TResolvedInput, context as ResourceCapabilityExecutionContext)
    });
    resourceResolvers.set(capability, (input, context) => resolver(input as TParsedInput, context));
    resourceSelectableScopes.set(capability, selectableResourceScopes);
    resourceRefusalDetailVocabularies.set(capability, refusalDetailVocabulary);
    changeSummarizers.set(capability, (input) => summarizeChange(input as TResolvedInput));
    writeEnvelopePreflights.set(capability, (input, context) =>
      preflight(input as TResolvedInput, context as ResourceCapabilityExecutionContext)
    );
    writeEnvelopeVerifiers.set(capability, (input, output, context) =>
      verifyOutcome(
        input as TResolvedInput,
        output as TOutput,
        context as ResourceCapabilityExecutionContext
      )
    );
    return capability;
  } catch {
    return invalidCapabilityDefinition();
  }
}

function isMutationEnvelopeCapability(capability: CapabilityDefinition): boolean {
  return writeEnvelopePreflights.has(capability);
}

export function isKernelDefinedCapability(capability: CapabilityDefinition): boolean {
  return kernelDefinedCapabilities.has(capability);
}

export function hasVisibleResourceScopes(
  capability: CapabilityDefinition,
  allowedResourceScopes: ReadonlySet<string> | null
): boolean {
  const effect = capability.policy.effect;
  const selectable = resourceSelectableScopes.get(capability);
  if (selectable === undefined) {
    return areResourceScopesAllowedForEffect(
      capability.policy.resourceScopes,
      allowedResourceScopes,
      effect
    );
  }
  // A non-read effect is never authorized by an absent allow-list, so a selectable write scope must
  // be named explicitly before it can be listed or dispatched.
  if (effect !== 'read' && allowedResourceScopes === null) return false;
  return (
    selectable.length > 0 &&
    (allowedResourceScopes === null || selectable.some((scope) => allowedResourceScopes.has(scope)))
  );
}

/**
 * A catalogued product tool that is not registered has no configured target; a name outside the
 * product vocabulary is genuinely unknown. Answering both with UNKNOWN_CAPABILITY left a client
 * unable to tell "you are not configured" from "you invented a tool".
 */
function absentCapabilityRefusal(name: string): CapabilityResult {
  return refusal(PRODUCT_MCP_NAMES.has(name) ? 'TARGET_UNAVAILABLE' : 'UNKNOWN_CAPABILITY');
}

function authorizeRequest(
  catalog: CapabilityCatalogView,
  options: SealedPolicyOptions,
  request: CapabilityRequest,
  context: CapabilityInvocationContext
): AuthorizationResult {
  let capability: CapabilityDefinition | undefined;
  try {
    capability = catalog.getByMcpName(request.name);
  } catch {
    return { kind: 'refused', result: absentCapabilityRefusal(request.name) };
  }
  if (capability === undefined) {
    return { kind: 'refused', result: absentCapabilityRefusal(request.name) };
  }

  let visibleResourceScopes: readonly string[] | undefined;
  try {
    if (!capability.transports.includes(context.transport)) {
      return { kind: 'refused', result: refusal('UNSUPPORTED_TRANSPORT') };
    }
    if (options.readOnly && capability.policy.effect !== 'read') {
      return { kind: 'refused', result: refusal('READ_ONLY') };
    }
    if (
      capability.policy.requiredFeatureFlags.some((flag) => !options.enabledFeatureFlags.has(flag))
    ) {
      return { kind: 'refused', result: refusal('FEATURE_DISABLED') };
    }
    const selectable = resourceSelectableScopes.get(capability);
    const resolver = resourceResolvers.get(capability);
    const detailVocabulary = resourceRefusalDetailVocabularies.get(capability);
    if (
      (selectable === undefined) !== (resolver === undefined) ||
      (selectable === undefined) !== (detailVocabulary === undefined)
    ) {
      return { kind: 'refused', result: refusal('INVALID_POLICY') };
    }
    if (selectable === undefined) {
      if (
        !areResourceScopesAllowedForEffect(
          capability.policy.resourceScopes,
          options.allowedResourceScopes,
          capability.policy.effect
        )
      ) {
        return { kind: 'refused', result: refusal('RESOURCE_NOT_ALLOWED') };
      }
    } else {
      if (capability.policy.effect !== 'read' && options.allowedResourceScopes === null) {
        return { kind: 'refused', result: refusal('RESOURCE_NOT_ALLOWED') };
      }
      visibleResourceScopes = Object.freeze(
        options.allowedResourceScopes === null
          ? [...selectable]
          : selectable.filter((scope) => options.allowedResourceScopes?.has(scope) === true)
      );
      if (visibleResourceScopes.length === 0) {
        return { kind: 'refused', result: refusal('RESOURCE_NOT_ALLOWED') };
      }
    }
  } catch {
    return { kind: 'refused', result: refusal('INVALID_POLICY') };
  }

  if (context.signal?.aborted === true) {
    return { kind: 'refused', result: refusal('CANCELLED') };
  }

  let normalized: unknown;
  try {
    normalized = capability.parseInput(request.arguments);
  } catch {
    return { kind: 'refused', result: refusal('INVALID_INPUT') };
  }

  let snapshot: ReturnType<typeof createCanonicalJsonSnapshot>;
  try {
    snapshot = createCanonicalJsonSnapshot(normalized);
  } catch {
    return { kind: 'refused', result: refusal('INVALID_INPUT') };
  }
  if (!isRecord(snapshot.value)) {
    return { kind: 'refused', result: refusal('INVALID_INPUT') };
  }

  let effectiveResourceScopes: readonly string[] = Object.freeze([
    ...capability.policy.resourceScopes
  ]);
  if (visibleResourceScopes !== undefined) {
    const resolver = resourceResolvers.get(capability);
    const detailVocabulary = resourceRefusalDetailVocabularies.get(capability);
    if (resolver === undefined || detailVocabulary === undefined) {
      return { kind: 'refused', result: refusal('INVALID_POLICY') };
    }
    let resolution: ResourceResolution<Record<string, unknown>>;
    try {
      resolution = resolver(snapshot.value, Object.freeze({ visibleResourceScopes }));
    } catch {
      return { kind: 'refused', result: refusal('INVALID_RESOURCE_INPUT') };
    }

    let resolutionValue: ReadonlyMap<string, unknown>;
    try {
      resolutionValue = readPlainOwnDataProperties(
        resolution,
        ['kind', 'input', 'effectiveResourceScopes', 'code', 'details'],
        false
      );
    } catch {
      return { kind: 'refused', result: refusal('INVALID_RESOURCE_INPUT') };
    }
    const resolutionKind = resolutionValue.get('kind');
    if (resolutionKind === 'refused') {
      if (
        resolutionValue.size !== 3 ||
        !resolutionValue.has('code') ||
        !resolutionValue.has('details')
      ) {
        return { kind: 'refused', result: refusal('INVALID_RESOURCE_INPUT') };
      }
      try {
        const safe = readResourceRefusal(resolution, visibleResourceScopes, detailVocabulary);
        return { kind: 'refused', result: refusal(safe.code, safe.details) };
      } catch {
        return { kind: 'refused', result: refusal('INVALID_RESOURCE_INPUT') };
      }
    }
    if (
      resolutionKind !== 'resolved' ||
      resolutionValue.size !== 3 ||
      !resolutionValue.has('input') ||
      !resolutionValue.has('effectiveResourceScopes')
    ) {
      return { kind: 'refused', result: refusal('INVALID_RESOURCE_INPUT') };
    }

    try {
      const resolvedScopes = copyDenseArray(
        readRequiredProperty(resolutionValue, 'effectiveResourceScopes'),
        isMetadataString
      );
      const visible = new Set(visibleResourceScopes);
      if (
        resolvedScopes.length === 0 ||
        new Set(resolvedScopes).size !== resolvedScopes.length ||
        resolvedScopes.some((scope) => !visible.has(scope))
      ) {
        return { kind: 'refused', result: refusal('RESOURCE_NOT_ALLOWED') };
      }
      effectiveResourceScopes = Object.freeze([...resolvedScopes].sort());
      if (
        !areResourceScopesAllowedForEffect(
          effectiveResourceScopes,
          options.allowedResourceScopes,
          capability.policy.effect
        )
      ) {
        return { kind: 'refused', result: refusal('RESOURCE_NOT_ALLOWED') };
      }
      snapshot = createCanonicalJsonSnapshot(readRequiredProperty(resolutionValue, 'input'));
      if (!isRecord(snapshot.value)) {
        return { kind: 'refused', result: refusal('INVALID_RESOURCE_INPUT') };
      }
    } catch {
      return { kind: 'refused', result: refusal('INVALID_RESOURCE_INPUT') };
    }
  }

  if (!isValidTimeout(capability.policy.timeoutMs)) {
    return { kind: 'refused', result: refusal('INVALID_POLICY') };
  }

  return {
    kind: 'authorized',
    authorization: Object.freeze({
      capability,
      input: snapshot.value,
      argumentsSha256: snapshot.sha256,
      effectiveResourceScopes
    })
  };
}

function invokeHandler(
  capability: CapabilityDefinition,
  input: Record<string, unknown>,
  context: CapabilityExecutionContext
): Promise<Record<string, unknown>> {
  const handler = capabilityHandlers.get(capability);
  if (handler === undefined) throw new Error('Capability handler is unavailable');
  return handler(input, context);
}

async function runOperation(
  effect: CapabilityEffect,
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
  retain: CapabilityKernelInternalHooks['retain'],
  thunk: (signal: AbortSignal) => Promise<Record<string, unknown>>
): Promise<OperationResult> {
  const isCallerAborted = () => callerSignal?.aborted === true;
  if (isCallerAborted()) {
    return { kind: 'aborted-read', cause: 'caller' };
  }

  const operationController = new AbortController();
  let abortCause: AbortCause | undefined;
  let resolveAbort: ((cause: AbortCause) => void) | undefined;
  const aborted = new Promise<AbortCause>((resolve) => {
    resolveAbort = resolve;
  });
  const observeAbort = (cause: AbortCause) => {
    if (abortCause !== undefined) return;
    abortCause = cause;
    resolveAbort?.(cause);
    operationController.abort();
  };
  const observedAbortCause = (): AbortCause | undefined => abortCause;
  const onCallerAbort = () => {
    observeAbort('caller');
  };
  callerSignal?.addEventListener('abort', onCallerAbort);
  const timeout = setTimeout(() => {
    observeAbort('timeout');
  }, timeoutMs);
  const cleanup = () => {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  };

  if (isCallerAborted()) {
    observeAbort('caller');
    cleanup();
    return { kind: 'aborted-read', cause: 'caller' };
  }

  let handlerPromise: Promise<Record<string, unknown>>;
  try {
    handlerPromise = Promise.resolve(thunk(operationController.signal));
  } catch {
    cleanup();
    const cause = observedAbortCause();
    if (cause !== undefined) {
      return effect === 'read' ? { kind: 'aborted-read', cause } : { kind: 'aborted-write' };
    }
    return { kind: 'settled', settlement: { kind: 'rejected' } };
  }

  const settlement: Promise<HandlerSettlement> = handlerPromise.then(
    (value) => ({ kind: 'fulfilled', value }),
    () => ({ kind: 'rejected' })
  );
  const first = await Promise.race([
    settlement.then((value) => ({ kind: 'settled' as const, value })),
    aborted.then((cause) => ({ kind: 'aborted' as const, cause }))
  ]);

  if (first.kind === 'settled') {
    cleanup();
    return { kind: 'settled', settlement: first.value };
  }

  if (effect === 'read') {
    cleanup();
    if (retain !== undefined) {
      try {
        retain(settlement);
      } catch {
        await settlement;
      }
    }
    return { kind: 'aborted-read', cause: first.cause };
  }

  await settlement;
  cleanup();
  return { kind: 'aborted-write' };
}

const MUTATION_TARGET_KEY = 'opnsense-config';

type BoundedOutcome<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'aborted'; readonly cause: AbortCause };

// Generic bounded runner for the envelope's read-only preflight/verify callbacks and its sealed apply phase.
// Like runOperation it always awaits the in-flight settlement before reporting an abort, so a cancelled or
// timed-out mutation never leaves an unobserved write in flight.
async function runBounded<T>(
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
  thunk: (signal: AbortSignal) => Promise<T>
): Promise<BoundedOutcome<T>> {
  if (callerSignal?.aborted === true) return { kind: 'aborted', cause: 'caller' };
  const controller = new AbortController();
  let observedCause: AbortCause | undefined;
  let resolveAbort: ((cause: AbortCause) => void) | undefined;
  const aborted = new Promise<AbortCause>((resolve) => {
    resolveAbort = resolve;
  });
  const observeAbort = (cause: AbortCause) => {
    if (observedCause !== undefined) return;
    observedCause = cause;
    resolveAbort?.(cause);
    controller.abort();
  };
  const onCallerAbort = () => {
    observeAbort('caller');
  };
  callerSignal?.addEventListener('abort', onCallerAbort);
  const timeout = setTimeout(() => {
    observeAbort('timeout');
  }, timeoutMs);
  const cleanup = () => {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  };
  let settled: Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false }>;
  try {
    settled = Promise.resolve(thunk(controller.signal)).then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const })
    );
  } catch {
    cleanup();
    return observedCause === undefined
      ? { kind: 'rejected' }
      : { kind: 'aborted', cause: observedCause };
  }
  const first = await Promise.race([
    settled.then((value) => ({ kind: 'settled' as const, value })),
    aborted.then((cause) => ({ kind: 'aborted' as const, cause }))
  ]);
  if (first.kind === 'settled') {
    cleanup();
    return first.value.ok ? { kind: 'value', value: first.value.value } : { kind: 'rejected' };
  }
  await settled;
  cleanup();
  return { kind: 'aborted', cause: first.cause };
}

function isPreflightResult(value: unknown): value is PreflightResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as PreflightResult).effectPlanDigest === 'string' &&
    typeof (value as PreflightResult).observedStateDigest === 'string'
  );
}

// The fixed write-path safety envelope. The order — target lock, sealed preflight, redacted audit intent,
// strict verified backup, state revalidation, bounded execution, outcome verification, final audit, lock
// release — is normative and every post-backup failure preserves the backup and never blind-restores.
async function executeMutationEnvelope(
  authorization: AuthorizedRequest,
  options: SealedPolicyOptions,
  context: CapabilityInvocationContext,
  services: MutationEnvelopeServices
): Promise<CapabilityResult> {
  const { capability } = authorization;
  const preflightCallback = writeEnvelopePreflights.get(capability);
  const verifyCallback = writeEnvelopeVerifiers.get(capability);
  if (preflightCallback === undefined || verifyCallback === undefined) {
    return refusal('EXECUTION_FAILED');
  }
  const { timeoutMs, effect } = capability.policy;

  const makeContext = (signal: AbortSignal): CapabilityExecutionContext =>
    Object.freeze({
      signal,
      readOnly: options.readOnly,
      transport: context.transport,
      ...(context.principalId === undefined ? {} : { principalId: context.principalId }),
      ...(resourceResolvers.has(capability)
        ? { effectiveResourceScopes: authorization.effectiveResourceScopes }
        : {})
    });

  const recordAudit = (phase: AuditPhase, outcome: string, backupId?: string): boolean => {
    try {
      const record: AuditRecord = Object.freeze({
        capabilityId: capability.id,
        mcpName: capability.mcpName,
        effect,
        argumentsSha256: authorization.argumentsSha256,
        effectiveResourceScopes: authorization.effectiveResourceScopes,
        phase,
        outcome,
        ...(backupId === undefined ? {} : { backupId })
      });
      services.audit.record(record);
      return true;
    } catch {
      return false;
    }
  };

  if (context.signal?.aborted === true) return refusal('CANCELLED');

  // Step 1: acquire the target's exclusive mutation lock.
  let lock: Awaited<ReturnType<typeof services.lock.acquire>>;
  try {
    lock = await services.lock.acquire(
      MUTATION_TARGET_KEY,
      context.signal ?? new AbortController().signal
    );
  } catch {
    return refusal('LOCK_UNAVAILABLE');
  }
  if (lock === null) return refusal('LOCK_UNAVAILABLE');

  try {
    // Step 2: sealed, side-effect-free, bounded preflight.
    const preflight = await runBounded(timeoutMs, context.signal, (signal) =>
      preflightCallback(authorization.input, makeContext(signal))
    );
    if (preflight.kind !== 'value' || !isPreflightResult(preflight.value)) {
      return refusal(
        preflight.kind === 'aborted'
          ? preflight.cause === 'caller'
            ? 'CANCELLED'
            : 'TIMEOUT'
          : 'PREFLIGHT_FAILED'
      );
    }
    const sealed = preflight.value;

    // Step 3: redacted audit intent (a failure here is itself fail-closed).
    if (!recordAudit('intent', 'intent')) return refusal('EXECUTION_FAILED');

    // Step 4: strict verified backup precedes the first write.
    let backupId: string | undefined;
    if (capability.policy.backup === 'strict') {
      try {
        const created = await services.backup.create(
          MUTATION_TARGET_KEY,
          context.signal ?? new AbortController().signal
        );
        backupId = created.backupId;
        if (backupId.length === 0 || !(await services.backup.exists(backupId))) {
          recordAudit('result', 'BACKUP_FAILED', backupId);
          return refusal('BACKUP_FAILED');
        }
      } catch {
        recordAudit('result', 'BACKUP_FAILED');
        return refusal('BACKUP_FAILED');
      }
    }

    // Step 5: revalidate the sealed state before the first write.
    const revalidation = await runBounded(timeoutMs, context.signal, (signal) =>
      preflightCallback(authorization.input, makeContext(signal))
    );
    if (
      revalidation.kind !== 'value' ||
      !isPreflightResult(revalidation.value) ||
      revalidation.value.observedStateDigest !== sealed.observedStateDigest ||
      revalidation.value.effectPlanDigest !== sealed.effectPlanDigest
    ) {
      recordAudit('result', 'STATE_REVALIDATION_FAILED', backupId);
      return refusal('STATE_REVALIDATION_FAILED');
    }

    // Step 6: bounded execution of the sealed apply phase.
    const applied = await runBounded(timeoutMs, context.signal, (signal) =>
      invokeHandler(capability, authorization.input, makeContext(signal))
    );
    if (applied.kind === 'aborted') {
      recordAudit('result', 'OUTCOME_INDETERMINATE', backupId);
      return refusal('OUTCOME_INDETERMINATE');
    }
    if (applied.kind === 'rejected') {
      recordAudit('result', 'EXECUTION_FAILED', backupId);
      return refusal('EXECUTION_FAILED');
    }

    // Step 7: verify the declared outcome; an unverifiable result is never a success.
    const verified = await runBounded(timeoutMs, context.signal, (signal) =>
      verifyCallback(authorization.input, applied.value, makeContext(signal))
    );
    if (verified.kind !== 'value' || !verified.value) {
      recordAudit('result', 'OUTCOME_UNVERIFIED', backupId);
      return refusal('OUTCOME_UNVERIFIED');
    }

    let parsedOutput: unknown;
    try {
      parsedOutput = capability.parseOutput(applied.value);
      const snapshot = createCanonicalJsonSnapshot(parsedOutput).value;
      if (!isRecord(snapshot)) {
        recordAudit('result', 'INVALID_OUTPUT', backupId);
        return refusal('INVALID_OUTPUT');
      }
      // Step 8: final audit, then step 9 (lock release) runs in finally.
      recordAudit('result', 'success', backupId);
      return Object.freeze({ kind: 'success', output: snapshot });
    } catch {
      recordAudit('result', 'INVALID_OUTPUT', backupId);
      return refusal('INVALID_OUTPUT');
    }
  } finally {
    // Step 9: release the lock on every path.
    try {
      await lock.release();
    } catch {
      // A synthetic release cannot fail; a real release failure is a later reconciliation concern.
    }
  }
}

async function executeAuthorized(
  authorization: AuthorizedRequest,
  options: SealedPolicyOptions,
  context: CapabilityInvocationContext,
  internalHooks: CapabilityKernelInternalHooks,
  services: MutationEnvelopeServices | undefined
): Promise<CapabilityResult> {
  if (isMutationEnvelopeCapability(authorization.capability)) {
    if (services === undefined) return refusal('EXECUTION_FAILED');
    return executeMutationEnvelope(authorization, options, context, services);
  }
  const executionContext: CapabilityExecutionContext = Object.freeze({
    signal: new AbortController().signal,
    readOnly: options.readOnly,
    transport: context.transport,
    ...(context.principalId === undefined ? {} : { principalId: context.principalId })
  });
  const operation = await runOperation(
    authorization.capability.policy.effect,
    authorization.capability.policy.timeoutMs,
    context.signal,
    internalHooks.retain,
    (signal) => {
      const contextWithSignal: CapabilityExecutionContext = Object.freeze({
        ...executionContext,
        signal,
        ...(resourceResolvers.has(authorization.capability)
          ? { effectiveResourceScopes: authorization.effectiveResourceScopes }
          : {})
      });
      return invokeHandler(authorization.capability, authorization.input, contextWithSignal);
    }
  );

  if (operation.kind === 'aborted-read') {
    return refusal(operation.cause === 'caller' ? 'CANCELLED' : 'TIMEOUT');
  }
  if (operation.kind === 'aborted-write') {
    return refusal('OUTCOME_INDETERMINATE');
  }
  if (operation.settlement.kind === 'rejected') {
    return refusal('EXECUTION_FAILED');
  }

  let parsedOutput: unknown;
  try {
    parsedOutput = authorization.capability.parseOutput(operation.settlement.value);
  } catch {
    return refusal('INVALID_OUTPUT');
  }
  try {
    const outputSnapshot = createCanonicalJsonSnapshot(parsedOutput).value;
    if (!isRecord(outputSnapshot)) return refusal('INVALID_OUTPUT');
    return Object.freeze({ kind: 'success', output: outputSnapshot });
  } catch {
    return refusal('INVALID_OUTPUT');
  }
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateRuntime(runtime: CapabilityKernelRuntime): {
  readonly now: () => number;
  readonly randomBytes: (size: number) => Uint8Array;
  readonly confirmationTtlMs: number;
  readonly ledgerCapacity: number;
} {
  const confirmationTtlMs = runtime.confirmationTtlMs ?? DEFAULT_CONFIRMATION_TTL_MS;
  const ledgerCapacity = runtime.ledgerCapacity ?? DEFAULT_LEDGER_CAPACITY;
  if (
    (runtime.now !== undefined && typeof runtime.now !== 'function') ||
    (runtime.randomBytes !== undefined && typeof runtime.randomBytes !== 'function') ||
    !Number.isInteger(confirmationTtlMs) ||
    confirmationTtlMs < 1 ||
    confirmationTtlMs > DEFAULT_CONFIRMATION_TTL_MS ||
    !Number.isInteger(ledgerCapacity) ||
    ledgerCapacity < 1 ||
    ledgerCapacity > DEFAULT_LEDGER_CAPACITY
  ) {
    throw new Error('Invalid capability kernel runtime');
  }
  return Object.freeze({
    now: runtime.now ?? Date.now,
    randomBytes: runtime.randomBytes ?? secureRandomBytes,
    confirmationTtlMs,
    ledgerCapacity
  });
}

export function createCapabilityDispatcher(
  catalog: CapabilityCatalogView,
  sourceOptions: CapabilityPolicyOptions,
  installCompletion?: (completion: ConfirmationCompletion) => void,
  testRuntime: CapabilityKernelRuntime = {},
  internalHooks: CapabilityKernelInternalHooks = {},
  mutationServices?: MutationEnvelopeServices
): CapabilityDispatcher {
  const options: SealedPolicyOptions = Object.freeze({
    readOnly: sourceOptions.readOnly,
    allowedResourceScopes:
      sourceOptions.allowedResourceScopes === null
        ? null
        : new Set(sourceOptions.allowedResourceScopes),
    enabledFeatureFlags: new Set(sourceOptions.enabledFeatureFlags)
  });
  const runtime = validateRuntime(testRuntime);
  if (mutationServices === undefined) {
    // A capability that runs the mutation envelope cannot be exposed without its services. The
    // question is not whether THESE options expose it, but whether any options could: a dispatcher
    // built without services must never hold such a capability, so that widening the allow-list
    // later cannot turn a silent absence into an unprotected write.
    const exposedEnvelopeCapability = (['stdio', 'http'] as const).some((transport) =>
      catalog
        .listExposed({
          readOnly: options.readOnly,
          transport,
          enabledFeatureFlags: options.enabledFeatureFlags,
          allowedResourceScopes: options.allowedResourceScopes
        })
        .some((capability) => isMutationEnvelopeCapability(capability))
    );
    // Exposure alone is no longer sufficient evidence: a write is now hidden by an absent
    // allow-list, so a dispatcher could hold one while listing none. Ask the catalogue for
    // everything it holds, so widening the allow-list later cannot reveal an unprotected
    // capability on an already-built dispatcher.
    const holdsEnvelopeCapability = (catalog.listAll?.() ?? []).some((capability) =>
      isMutationEnvelopeCapability(capability)
    );
    const exposesEnvelopeCapability = exposedEnvelopeCapability || holdsEnvelopeCapability;
    if (exposesEnvelopeCapability) {
      throw new Error('Mutation envelope services are required to expose a write capability');
    }
  }
  const retain = internalHooks.retain;
  const sealedInternalHooks: CapabilityKernelInternalHooks = Object.freeze(
    retain === undefined ? {} : { retain }
  );
  const pendingConfirmations = new Map<string, PendingConfirmation>();

  const currentTime = (): number | undefined => {
    try {
      const now = runtime.now();
      return Number.isFinite(now) ? now : undefined;
    } catch {
      return undefined;
    }
  };

  const pruneExpired = (now: number) => {
    for (const [confirmationId, pending] of pendingConfirmations) {
      if (pending.expiresAtMs <= now) pendingConfirmations.delete(confirmationId);
    }
  };

  const completeConfirmation: ConfirmationCompletion = (
    decision,
    claims,
    repeatedRequest,
    context
  ) => {
    let pending: PendingConfirmation | undefined;
    try {
      pending = pendingConfirmations.get(claims.confirmationId);
    } catch {
      return Promise.resolve(refusal('CONFIRMATION_INVALID'));
    }
    if (pending === undefined) return Promise.resolve(refusal('CONFIRMATION_INVALID'));
    pendingConfirmations.delete(pending.confirmationId);

    const now = currentTime();
    let bindingIsInvalid: boolean;
    try {
      bindingIsInvalid =
        now === undefined ||
        now >= pending.expiresAtMs ||
        ((decision as unknown) !== 'accept' && (decision as unknown) !== 'decline') ||
        claims.capabilityId !== pending.capabilityId ||
        claims.argumentsSha256 !== pending.argumentsSha256 ||
        repeatedRequest.name !== pending.mcpName ||
        context.transport !== pending.transport ||
        context.principalId !== pending.principalId;
    } catch {
      bindingIsInvalid = true;
    }
    if (bindingIsInvalid) {
      return Promise.resolve(refusal('CONFIRMATION_INVALID'));
    }

    const authorization = authorizeRequest(catalog, options, repeatedRequest, context);
    if (authorization.kind === 'refused') {
      return Promise.resolve(
        authorization.result.kind === 'refused' && authorization.result.code === 'CANCELLED'
          ? authorization.result
          : refusal('CONFIRMATION_INVALID')
      );
    }
    if (
      authorization.authorization.capability.id !== pending.capabilityId ||
      authorization.authorization.argumentsSha256 !== pending.argumentsSha256 ||
      !arraysEqual(
        authorization.authorization.effectiveResourceScopes,
        pending.effectiveResourceScopes
      )
    ) {
      return Promise.resolve(refusal('CONFIRMATION_INVALID'));
    }
    if (decision === 'decline') {
      return Promise.resolve(refusal('CONFIRMATION_DECLINED'));
    }
    return executeAuthorized(
      authorization.authorization,
      options,
      context,
      sealedInternalHooks,
      mutationServices
    );
  };

  const completionInstalled = installCompletion !== undefined;
  if (installCompletion !== undefined) installCompletion(Object.freeze(completeConfirmation));

  const dispatcher: CapabilityDispatcher = {
    listExposed(transport) {
      return Object.freeze([
        ...catalog.listExposed({
          readOnly: options.readOnly,
          transport,
          enabledFeatureFlags: options.enabledFeatureFlags,
          allowedResourceScopes: options.allowedResourceScopes
        })
      ]);
    },
    dispatch(requestValue, context) {
      const authorization = authorizeRequest(catalog, options, requestValue, context);
      if (authorization.kind === 'refused') return Promise.resolve(authorization.result);
      if (authorization.authorization.capability.policy.confirmation !== 'elicitation') {
        return executeAuthorized(
          authorization.authorization,
          options,
          context,
          sealedInternalHooks,
          mutationServices
        );
      }
      if (!completionInstalled) {
        return Promise.resolve(refusal('CONFIRMATION_UNAVAILABLE'));
      }

      const now = currentTime();
      if (now === undefined) return Promise.resolve(refusal('CONFIRMATION_UNAVAILABLE'));
      pruneExpired(now);
      if (pendingConfirmations.size >= runtime.ledgerCapacity) {
        return Promise.resolve(refusal('CONFIRMATION_UNAVAILABLE'));
      }

      let confirmationId: string | undefined;
      for (let attempt = 0; attempt < CONFIRMATION_ID_ATTEMPTS; attempt += 1) {
        try {
          const bytes = runtime.randomBytes(CONFIRMATION_ID_BYTES);
          if (!(bytes instanceof Uint8Array) || bytes.byteLength !== CONFIRMATION_ID_BYTES) {
            continue;
          }
          const candidate = Buffer.from(bytes).toString('base64url');
          if (!pendingConfirmations.has(candidate)) {
            confirmationId = candidate;
            break;
          }
        } catch {
          // A bounded retry is safe; no downstream error crosses the boundary.
        }
      }
      if (confirmationId === undefined) {
        return Promise.resolve(refusal('CONFIRMATION_UNAVAILABLE'));
      }

      const expiresAtMs = now + runtime.confirmationTtlMs;
      let expiresAt: string;
      try {
        expiresAt = new Date(expiresAtMs).toISOString();
      } catch {
        return Promise.resolve(refusal('CONFIRMATION_UNAVAILABLE'));
      }
      const pending: PendingConfirmation = Object.freeze({
        confirmationId,
        capabilityId: authorization.authorization.capability.id,
        mcpName: authorization.authorization.capability.mcpName,
        argumentsSha256: authorization.authorization.argumentsSha256,
        effectiveResourceScopes: authorization.authorization.effectiveResourceScopes,
        transport: context.transport,
        ...(context.principalId === undefined ? {} : { principalId: context.principalId }),
        expiresAtMs
      });
      pendingConfirmations.set(confirmationId, pending);
      const summarizer = changeSummarizers.get(authorization.authorization.capability);
      let summary: ChangeSummary | undefined;
      if (summarizer !== undefined) {
        try {
          summary = sealedChangeSummary(
            summarizer(authorization.authorization.input),
            authorization.authorization.effectiveResourceScopes[0] ?? ''
          );
        } catch {
          // A capability that cannot describe its own change must not be approved blindly.
          return Promise.resolve(refusal('CONFIRMATION_UNAVAILABLE'));
        }
      }
      const challenge = Object.freeze({
        confirmationId,
        capabilityId: pending.capabilityId,
        argumentsSha256: pending.argumentsSha256,
        expiresAt,
        ...(summary === undefined ? {} : { summary })
      });
      return Promise.resolve(Object.freeze({ kind: 'confirmation-required', challenge }));
    }
  };
  return Object.freeze(dispatcher);
}

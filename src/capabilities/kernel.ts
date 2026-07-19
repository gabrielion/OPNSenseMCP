// SPDX-License-Identifier: AGPL-3.0-or-later
import { Buffer } from 'node:buffer';
import { randomBytes as secureRandomBytes } from 'node:crypto';
import { isProxy } from 'node:util/types';
import type { ToolAnnotations } from '@modelcontextprotocol/server';
import type * as z from 'zod/v4';
import { FeatureFlagSchema } from '../config/feature-flags.js';
import type { FeatureFlag } from '../config/feature-flags.js';
import { createCanonicalJsonSnapshot } from '../security/canonical-json.js';
import { areDeclaredResourceScopesAllowed } from './exposure.js';
import type {
  CapabilityDefinition,
  CapabilityDispatcher,
  CapabilityEffect,
  CapabilityExecutionContext,
  CapabilityInvocationContext,
  CapabilityPolicy,
  CapabilityRequest,
  CapabilityResult,
  ExposureContext,
  RefusalCode,
  ResourceCapabilityExecutionContext,
  ResourceRefusal,
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
  'resolver',
  'handler'
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

const REFUSAL_MESSAGES: Readonly<Record<RefusalCode, string>> = Object.freeze({
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
  OPERATION_NOT_AVAILABLE: 'Resource operation is not available.',
  OUTCOME_INDETERMINATE: 'Capability outcome is indeterminate.',
  READ_ONLY: 'Capability is disabled in read-only mode.',
  RESOURCE_NOT_ALLOWED: 'Capability resource scope is not allowed.',
  TIMEOUT: 'Capability execution timed out.',
  TARGET_UNAVAILABLE: 'OPNsense target is unavailable.',
  UNKNOWN_CAPABILITY: 'Capability is not available.',
  UNKNOWN_RESOURCE: 'Resource is not available.',
  UNSUPPORTED_TRANSPORT: 'Capability is not available on this transport.'
});

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
  allowed?: ReadonlySet<string>
): readonly string[] {
  const names = copyDenseArray(value, isPublicDetailName);
  if (names.length > maximumLength) throw new Error('Invalid resource refusal details');
  const unique = [...new Set(names)].sort();
  if (allowed !== undefined && unique.some((name) => !allowed.has(name))) {
    throw new Error('Invalid resource refusal details');
  }
  return Object.freeze(unique);
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
  visibleResourceScopes: readonly string[]
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
      details: Object.freeze({
        suggestions: readSafeSuggestions(readRequiredProperty(details, 'suggestions'), visible)
      })
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
      details: Object.freeze({
        resource: readVisibleResourceName(readRequiredProperty(details, 'resource'), visible),
        availableOperations: readSafeDetailNames(
          readRequiredProperty(details, 'availableOperations'),
          MAX_RESOURCE_DETAIL_ARRAY_LENGTH
        )
      })
    });
  }
  if (code === 'INVALID_RESOURCE_INPUT') {
    const details = readPlainOwnDataProperties(
      detailsValue,
      ['resource', 'operation', 'fields'],
      true
    );
    const operation = readRequiredProperty(details, 'operation');
    if (!isPublicDetailName(operation)) throw new Error('Invalid resource refusal details');
    return Object.freeze({
      code,
      details: Object.freeze({
        resource: readVisibleResourceName(readRequiredProperty(details, 'resource'), visible),
        operation,
        fields: readSafeDetailNames(
          readRequiredProperty(details, 'fields'),
          MAX_RESOURCE_DETAIL_ARRAY_LENGTH
        )
      })
    });
  }
  if (code === 'TARGET_UNAVAILABLE') {
    const details = readPlainOwnDataProperties(detailsValue, ['resource', 'operation'], true);
    const operation = readRequiredProperty(details, 'operation');
    if (!isPublicDetailName(operation)) throw new Error('Invalid resource refusal details');
    return Object.freeze({
      code,
      details: Object.freeze({
        resource: readVisibleResourceName(readRequiredProperty(details, 'resource'), visible),
        operation
      })
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
    return capability;
  } catch {
    return invalidCapabilityDefinition();
  }
}

export function isKernelDefinedCapability(capability: CapabilityDefinition): boolean {
  return kernelDefinedCapabilities.has(capability);
}

export function hasVisibleResourceScopes(
  capability: CapabilityDefinition,
  allowedResourceScopes: ReadonlySet<string> | null
): boolean {
  const selectable = resourceSelectableScopes.get(capability);
  if (selectable === undefined) {
    return areDeclaredResourceScopesAllowed(
      capability.policy.resourceScopes,
      allowedResourceScopes
    );
  }
  return (
    selectable.length > 0 &&
    (allowedResourceScopes === null || selectable.some((scope) => allowedResourceScopes.has(scope)))
  );
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
    return { kind: 'refused', result: refusal('UNKNOWN_CAPABILITY') };
  }
  if (capability === undefined) {
    return { kind: 'refused', result: refusal('UNKNOWN_CAPABILITY') };
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
    if ((selectable === undefined) !== (resolver === undefined)) {
      return { kind: 'refused', result: refusal('INVALID_POLICY') };
    }
    if (selectable === undefined) {
      if (
        !areDeclaredResourceScopesAllowed(
          capability.policy.resourceScopes,
          options.allowedResourceScopes
        )
      ) {
        return { kind: 'refused', result: refusal('RESOURCE_NOT_ALLOWED') };
      }
    } else {
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
    if (resolver === undefined) {
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
        const safe = readResourceRefusal(resolution, visibleResourceScopes);
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
        !areDeclaredResourceScopesAllowed(effectiveResourceScopes, options.allowedResourceScopes)
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

async function executeAuthorized(
  authorization: AuthorizedRequest,
  options: SealedPolicyOptions,
  context: CapabilityInvocationContext,
  internalHooks: CapabilityKernelInternalHooks
): Promise<CapabilityResult> {
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
  internalHooks: CapabilityKernelInternalHooks = {}
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
    return executeAuthorized(authorization.authorization, options, context, sealedInternalHooks);
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
          sealedInternalHooks
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
      const challenge = Object.freeze({
        confirmationId,
        capabilityId: pending.capabilityId,
        argumentsSha256: pending.argumentsSha256,
        expiresAt
      });
      return Promise.resolve(Object.freeze({ kind: 'confirmation-required', challenge }));
    }
  };
  return Object.freeze(dispatcher);
}

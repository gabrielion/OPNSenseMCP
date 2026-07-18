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
  OUTCOME_INDETERMINATE: 'Capability outcome is indeterminate.',
  READ_ONLY: 'Capability is disabled in read-only mode.',
  RESOURCE_NOT_ALLOWED: 'Capability resource scope is not allowed.',
  TIMEOUT: 'Capability execution timed out.',
  UNKNOWN_CAPABILITY: 'Capability is not available.',
  UNSUPPORTED_TRANSPORT: 'Capability is not available on this transport.'
});

type CapabilityHandler = (
  input: Record<string, unknown>,
  context: CapabilityExecutionContext
) => Promise<Record<string, unknown>>;

const capabilityHandlers = new WeakMap<CapabilityDefinition, CapabilityHandler>();
const kernelDefinedCapabilities = new WeakSet<CapabilityDefinition>();

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

function refusal(code: RefusalCode): CapabilityResult {
  return Object.freeze({ kind: 'refused', code, message: REFUSAL_MESSAGES[code] });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

export function isKernelDefinedCapability(capability: CapabilityDefinition): boolean {
  return kernelDefinedCapabilities.has(capability);
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
    if (
      !areDeclaredResourceScopesAllowed(
        capability.policy.resourceScopes,
        options.allowedResourceScopes
      )
    ) {
      return { kind: 'refused', result: refusal('RESOURCE_NOT_ALLOWED') };
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

  if (!isValidTimeout(capability.policy.timeoutMs)) {
    return { kind: 'refused', result: refusal('INVALID_POLICY') };
  }

  return {
    kind: 'authorized',
    authorization: Object.freeze({
      capability,
      input: snapshot.value,
      argumentsSha256: snapshot.sha256,
      effectiveResourceScopes: Object.freeze([...capability.policy.resourceScopes])
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
    void settlement.then(() => undefined);
    return { kind: 'aborted-read', cause: first.cause };
  }

  await settlement;
  cleanup();
  return { kind: 'aborted-write' };
}

async function executeAuthorized(
  authorization: AuthorizedRequest,
  options: SealedPolicyOptions,
  context: CapabilityInvocationContext
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
    (signal) =>
      invokeHandler(
        authorization.capability,
        authorization.input,
        Object.freeze({ ...executionContext, signal })
      )
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
  testRuntime: CapabilityKernelRuntime = {}
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
    return executeAuthorized(authorization.authorization, options, context);
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
        return executeAuthorized(authorization.authorization, options, context);
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

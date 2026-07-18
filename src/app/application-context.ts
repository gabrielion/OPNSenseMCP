// SPDX-License-Identifier: AGPL-3.0-or-later
import { Buffer } from 'node:buffer';
import {
  createRequestStateCodec,
  type RequestStateCodec,
  type ServerContext as McpServerContext
} from '@modelcontextprotocol/server';
import { CAPABILITY_CATALOG, type CapabilityCatalog } from '../capabilities/catalog.js';
import {
  createCapabilityDispatcher,
  type ConfirmationClaims,
  type ConfirmationCompletion,
  type ConfirmationDecision
} from '../capabilities/kernel.js';
import type {
  CapabilityDefinition,
  CapabilityInvocationContext,
  CapabilityRequest,
  CapabilityResult,
  TransportKind
} from '../capabilities/types.js';
import type { FeatureFlag } from '../config/feature-flags.js';
import type { RuntimeConfig } from '../config/runtime-config.js';
import { createLocalBearerAuthentication } from '../http/auth.js';
import type { RequestHandler } from 'express';

const INVALID_APPLICATION_MESSAGE = 'Application context is not initialized';
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/u;

export interface ApplicationContext {
  readonly catalog: CapabilityCatalog;
}

interface RuntimeSnapshot {
  readonly readOnly: boolean;
  readonly allowedResourceScopes: readonly string[] | null;
  readonly enabledFeatureFlags: readonly FeatureFlag[];
  readonly requestStateKeyBase64url: string;
  readonly http: {
    readonly enabled: boolean;
    readonly host: '127.0.0.1' | 'localhost';
    readonly port: number;
    readonly allowedHosts: readonly string[];
    readonly allowedOrigins: readonly string[];
    readonly legacySseEnabled: boolean;
    readonly token?: string;
  };
}

interface ApplicationInternals {
  readonly snapshot: RuntimeSnapshot;
  readonly dispatcher: ReturnType<typeof createCapabilityDispatcher>;
  readonly completion: ConfirmationCompletion;
}

const applicationInternals = new WeakMap<ApplicationContext, ApplicationInternals>();

export interface ApplicationHttpSecurity {
  readonly enabled: boolean;
  readonly host: '127.0.0.1' | 'localhost';
  readonly port: number;
  readonly allowedHosts: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly legacySseEnabled: boolean;
  readonly authenticate: RequestHandler;
}

function snapshotConfig(config: RuntimeConfig): RuntimeSnapshot {
  const allowedResourceScopes =
    config.allowedResourceScopes === null ? null : Object.freeze([...config.allowedResourceScopes]);
  const enabledFeatureFlags = Object.freeze([...config.enabledFeatureFlags]);
  const allowedHosts = Object.freeze([...config.http.allowedHosts]);
  const allowedOrigins = Object.freeze([...config.http.allowedOrigins]);
  const http = Object.freeze({
    enabled: config.http.enabled,
    host: config.http.host,
    port: config.http.port,
    allowedHosts,
    allowedOrigins,
    legacySseEnabled: config.http.legacySseEnabled,
    ...(config.http.token === undefined ? {} : { token: config.http.token })
  });
  return Object.freeze({
    readOnly: config.readOnly,
    allowedResourceScopes,
    enabledFeatureFlags,
    requestStateKeyBase64url: Buffer.from(config.requestStateKey).toString('base64url'),
    http
  });
}

function internalsFor(application: ApplicationContext): ApplicationInternals {
  const internals = applicationInternals.get(application);
  if (internals === undefined) throw new Error(INVALID_APPLICATION_MESSAGE);
  return internals;
}

function isCanonicalBase64Url(value: string | undefined): value is string {
  if (value === undefined || !BASE64URL_SEGMENT.test(value)) return false;
  try {
    return Buffer.from(value, 'base64url').toString('base64url') === value;
  } catch {
    return false;
  }
}

function requireCanonicalRequestState(state: string): void {
  const segments = state.split('.');
  if (
    segments.length !== 3 ||
    segments[0] !== 'v1' ||
    !isCanonicalBase64Url(segments[1]) ||
    !isCanonicalBase64Url(segments[2])
  ) {
    throw new Error('malformed');
  }
}

export function createApplicationContext(
  config: RuntimeConfig,
  catalog: CapabilityCatalog = CAPABILITY_CATALOG
): ApplicationContext {
  const snapshot = snapshotConfig(config);
  let completion: ConfirmationCompletion | undefined;
  const dispatcher = createCapabilityDispatcher(
    catalog,
    {
      readOnly: snapshot.readOnly,
      allowedResourceScopes:
        snapshot.allowedResourceScopes === null ? null : new Set(snapshot.allowedResourceScopes),
      enabledFeatureFlags: new Set(snapshot.enabledFeatureFlags)
    },
    (installed) => {
      completion = installed;
    }
  );
  if (completion === undefined) throw new Error(INVALID_APPLICATION_MESSAGE);

  const application: ApplicationContext = Object.freeze({ catalog });
  applicationInternals.set(application, Object.freeze({ snapshot, dispatcher, completion }));
  return application;
}

export function listApplicationCapabilities(
  application: ApplicationContext,
  transport: TransportKind
): readonly CapabilityDefinition[] {
  return internalsFor(application).dispatcher.listExposed(transport);
}

export function dispatchApplicationCapability(
  application: ApplicationContext,
  request: CapabilityRequest,
  invocation: CapabilityInvocationContext
): Promise<CapabilityResult> {
  return internalsFor(application).dispatcher.dispatch(request, invocation);
}

export function settleApplicationConfirmation(
  application: ApplicationContext,
  decision: ConfirmationDecision,
  claims: ConfirmationClaims,
  request: CapabilityRequest,
  invocation: CapabilityInvocationContext
): Promise<CapabilityResult> {
  return internalsFor(application).completion(decision, claims, request, invocation);
}

export function createApplicationRequestStateCodec<T>(
  application: ApplicationContext,
  bind: (context: McpServerContext) => string
): RequestStateCodec<T> {
  const key = Uint8Array.from(
    Buffer.from(internalsFor(application).snapshot.requestStateKeyBase64url, 'base64url')
  );
  const codec = createRequestStateCodec<T>({ key, ttlSeconds: 300, bind });
  return Object.freeze({
    mint: (payload: T, context?: McpServerContext) => codec.mint(payload, context),
    verify: (state: string, context: McpServerContext) => {
      requireCanonicalRequestState(state);
      return codec.verify(state, context);
    }
  });
}

export function buildApplicationHttpSecurity(
  application: ApplicationContext
): ApplicationHttpSecurity {
  const { http } = internalsFor(application).snapshot;
  if (http.enabled && http.token === undefined) {
    throw new Error('Invalid HTTP security configuration');
  }
  const authenticate = createLocalBearerAuthentication(http.token ?? 'disabled-http-token');
  return Object.freeze({
    enabled: http.enabled,
    host: http.host,
    port: http.port,
    allowedHosts: Object.freeze([...http.allowedHosts]),
    allowedOrigins: Object.freeze([...http.allowedOrigins]),
    legacySseEnabled: http.legacySseEnabled,
    authenticate
  });
}

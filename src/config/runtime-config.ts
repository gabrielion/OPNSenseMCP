// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomBytes } from 'node:crypto';
import * as z from 'zod/v4';
import { FeatureFlagSchema, type FeatureFlag } from './feature-flags.js';

const BooleanTextSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

const CsvSchema = z.string().transform((value) => {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ];
});

function isSerializedHttpOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === value;
  } catch {
    return false;
  }
}

const SerializedOriginSchema = z
  .string()
  .refine(isSerializedHttpOrigin, 'must be an exact serialized HTTP Origin');
const OriginCsvSchema = CsvSchema.pipe(z.array(SerializedOriginSchema));

const EnvironmentSchema = z
  .object({
    READ_ONLY: BooleanTextSchema.prefault('true'),
    ALLOWED_RESOURCES: CsvSchema.prefault(''),
    ENABLED_FEATURE_FLAGS: CsvSchema.prefault(''),
    MCP_HTTP_ENABLED: BooleanTextSchema.prefault('false'),
    MCP_LEGACY_SSE_ENABLED: BooleanTextSchema.prefault('false'),
    MCP_HTTP_HOST: z.enum(['127.0.0.1', 'localhost']).default('127.0.0.1'),
    MCP_HTTP_PORT: z.coerce.number().int().min(1024).max(65_535).default(3000),
    MCP_HTTP_TOKEN: z.string().min(32).optional(),
    MCP_ALLOWED_HOSTS: CsvSchema.prefault('127.0.0.1,localhost,[::1]'),
    MCP_ALLOWED_ORIGINS: OriginCsvSchema.prefault(''),
    MCP_REQUEST_STATE_SECRET: z.string().min(32).optional()
  })
  .superRefine((value, context) => {
    if (value.MCP_HTTP_ENABLED && value.MCP_HTTP_TOKEN === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'required when MCP_HTTP_ENABLED=true',
        path: ['MCP_HTTP_TOKEN']
      });
    }

    if (value.MCP_LEGACY_SSE_ENABLED && !value.MCP_HTTP_ENABLED) {
      context.addIssue({
        code: 'custom',
        message: 'requires MCP_HTTP_ENABLED=true',
        path: ['MCP_LEGACY_SSE_ENABLED']
      });
    }

    for (const flag of value.ENABLED_FEATURE_FLAGS) {
      if (!FeatureFlagSchema.safeParse(flag).success) {
        context.addIssue({
          code: 'custom',
          message: 'unknown feature flag',
          path: ['ENABLED_FEATURE_FLAGS']
        });
      }
    }
  });

export interface RuntimeConfig {
  readonly readOnly: boolean;
  readonly allowedResourceScopes: ReadonlySet<string> | null;
  readonly enabledFeatureFlags: ReadonlySet<FeatureFlag>;
  readonly requestStateKey: Uint8Array;
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

function configurationError(error: z.ZodError): Error {
  const paths = [...new Set(error.issues.map((issue) => issue.path.join('.') || 'environment'))];
  return new Error(`Invalid runtime configuration: ${paths.join(', ')}`);
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = EnvironmentSchema.safeParse(env);
  if (!parsed.success) {
    throw configurationError(parsed.error);
  }

  const featureFlags = parsed.data.ENABLED_FEATURE_FLAGS.map((flag) =>
    FeatureFlagSchema.parse(flag)
  );
  const requestStateKey = parsed.data.MCP_REQUEST_STATE_SECRET
    ? new TextEncoder().encode(parsed.data.MCP_REQUEST_STATE_SECRET)
    : Uint8Array.from(randomBytes(32));

  return {
    readOnly: parsed.data.READ_ONLY,
    allowedResourceScopes:
      parsed.data.ALLOWED_RESOURCES.length === 0 ? null : new Set(parsed.data.ALLOWED_RESOURCES),
    enabledFeatureFlags: new Set<FeatureFlag>(featureFlags),
    requestStateKey,
    http: {
      enabled: parsed.data.MCP_HTTP_ENABLED,
      host: parsed.data.MCP_HTTP_HOST,
      port: parsed.data.MCP_HTTP_PORT,
      allowedHosts: parsed.data.MCP_ALLOWED_HOSTS,
      allowedOrigins: parsed.data.MCP_ALLOWED_ORIGINS,
      legacySseEnabled: parsed.data.MCP_LEGACY_SSE_ENABLED,
      ...(parsed.data.MCP_HTTP_TOKEN === undefined ? {} : { token: parsed.data.MCP_HTTP_TOKEN })
    }
  };
}

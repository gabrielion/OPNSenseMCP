// SPDX-License-Identifier: AGPL-3.0-or-later

export interface HttpLimits {
  readonly bodyBytes: number;
  readonly maxConcurrentRequests: number;
  readonly maxSubscriptions: number;
  readonly maxLegacySseSessions: number;
  readonly legacySessionIdleTimeoutMs: number;
  readonly bodyReceiptTimeoutMs: number;
  readonly executionTimeoutMs: number;
  readonly streamLifetimeMs: number;
  readonly headersTimeoutMs: number;
  readonly keepAliveTimeoutMs: number;
  readonly maxRequestsPerSocket: number;
}

export const DEFAULT_HTTP_LIMITS: HttpLimits = Object.freeze({
  bodyBytes: 256 * 1024,
  maxConcurrentRequests: 32,
  maxSubscriptions: 16,
  maxLegacySseSessions: 8,
  legacySessionIdleTimeoutMs: 120_000,
  bodyReceiptTimeoutMs: 10_000,
  executionTimeoutMs: 30_000,
  streamLifetimeMs: 5 * 60_000,
  headersTimeoutMs: 5_000,
  keepAliveTimeoutMs: 5_000,
  maxRequestsPerSocket: 100
});

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const TIMER_LIMIT_NAMES = new Set<keyof HttpLimits>([
  'legacySessionIdleTimeoutMs',
  'bodyReceiptTimeoutMs',
  'executionTimeoutMs',
  'streamLifetimeMs',
  'headersTimeoutMs',
  'keepAliveTimeoutMs'
]);

export function resolveHttpLimits(overrides: Partial<HttpLimits> = {}): HttpLimits {
  const limits: HttpLimits = { ...DEFAULT_HTTP_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`Invalid HTTP limit: ${name}`);
    }
    if (TIMER_LIMIT_NAMES.has(name as keyof HttpLimits) && value > MAX_TIMER_DELAY_MS) {
      throw new TypeError(`Invalid HTTP limit: ${name}`);
    }
  }
  return Object.freeze(limits);
}

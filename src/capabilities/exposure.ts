// SPDX-License-Identifier: AGPL-3.0-or-later
export function areDeclaredResourceScopesAllowed(
  scopes: readonly string[],
  allowed: ReadonlySet<string> | null
): boolean {
  return allowed === null || (scopes.length > 0 && scopes.every((scope) => allowed.has(scope)));
}

/**
 * An absent allow-list means "every catalogued scope" for reads, and "no scope at all" for every
 * non-read effect: a write must always be authorized by an explicitly named scope, so that the
 * default configuration can never expose one.
 */
export function areResourceScopesAllowedForEffect(
  scopes: readonly string[],
  allowed: ReadonlySet<string> | null,
  effect: string
): boolean {
  if (effect !== 'read' && allowed === null) return false;
  return areDeclaredResourceScopesAllowed(scopes, allowed);
}

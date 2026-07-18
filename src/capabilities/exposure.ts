// SPDX-License-Identifier: AGPL-3.0-or-later
export function areDeclaredResourceScopesAllowed(
  scopes: readonly string[],
  allowed: ReadonlySet<string> | null
): boolean {
  return allowed === null || (scopes.length > 0 && scopes.every((scope) => allowed.has(scope)));
}

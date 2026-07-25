// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The outer vitest budget for any test that prepares an installed package. It must own every child
 * budget the preparation helper and its registry fixture can spend, so a slow runner fails on the
 * child that actually stalled instead of on an opaque outer timeout that skips fixture cleanup.
 */
export const PACKAGE_TEST_TIMEOUT_MS = 600_000;

// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';

export const FeatureFlagSchema = z.enum([
  'advanced-api',
  'experimental-alias-write',
  'restore',
  'shell',
  'ssh'
]);

export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;

// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vitest/config';

const sharedTestOptions = {
  environment: 'node' as const,
  testTimeout: 15_000,
  hookTimeout: 15_000,
  restoreMocks: true,
  clearMocks: true
};

export default defineConfig({
  test: {
    ...sharedTestOptions,
    include: ['tests/**/*.test.{ts,mjs}'],
    projects: [
      {
        test: {
          ...sharedTestOptions,
          name: 'parallel',
          maxWorkers: '50%',
          include: ['tests/**/*.test.{ts,mjs}'],
          exclude: [
            'tests/integration/installed-package.test.ts',
            'tests/integration/opencode-smoke-runner.test.mjs'
          ],
          sequence: { groupOrder: 0 }
        }
      },
      {
        test: {
          ...sharedTestOptions,
          name: 'installed-package',
          include: ['tests/integration/installed-package.test.ts'],
          sequence: { groupOrder: 1 }
        }
      },
      {
        test: {
          ...sharedTestOptions,
          name: 'opencode-runner',
          include: ['tests/integration/opencode-smoke-runner.test.mjs'],
          sequence: { groupOrder: 2 }
        }
      }
    ]
  }
});

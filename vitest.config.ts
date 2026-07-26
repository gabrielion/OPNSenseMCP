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
            'tests/integration/local-npm-registry.test.mjs',
            'tests/integration/opencode-smoke-runner.test.mjs',
            'tests/integration/sealed-evidence.test.ts'
          ],
          sequence: { groupOrder: 0 }
        }
      },
      {
        test: {
          // The package fixtures spawn one archiver per locked dependency and bind loopback
          // servers. Running them beside the parallel group starves timing-sensitive socket
          // tests, so they own their own sequential groups.
          ...sharedTestOptions,
          name: 'installed-package',
          include: [
            'tests/integration/local-npm-registry.test.mjs',
            'tests/integration/installed-package.test.ts'
          ],
          sequence: { groupOrder: 1 }
        }
      },
      {
        test: {
          // Release gate only. The sealed OpenCode evidence can only be re-sealed by its real
          // producer (an external client and model), so its digest equality must not block an
          // ordinary commit. `npm run evidence:check` runs this project.
          ...sharedTestOptions,
          name: 'evidence',
          include: ['tests/integration/sealed-evidence.test.ts'],
          sequence: { groupOrder: 3 }
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

// SPDX-License-Identifier: AGPL-3.0-or-later
import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['coverage/**', 'dist/**', 'node_modules/**', 'results/**'] },
  { languageOptions: { globals: globals.node } },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/only-throw-error': 'error'
    }
  },
  {
    // Hand-written declaration files for the `.mjs` test fixtures are not part of a TypeScript
    // project, so the type-aware rule set cannot apply to them.
    files: ['**/*.{js,mjs}', '**/*.d.mts'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: globals.node }
  }
);

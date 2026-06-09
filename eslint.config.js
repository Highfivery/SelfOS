import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Flat ESLint config for the SelfOS monorepo.
 *
 * Type-aware rules (typescript-eslint's `recommendedTypeChecked`) are intentionally
 * deferred until packages have their own tsconfig projects — they'll be layered on
 * per-package during the build phase. Keeping this base lint fast and project-less
 * means it stays green on an empty repo and never blocks tooling setup.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/build/**',
      '**/coverage/**',
      '**/.husky/_/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.tsbuildinfo',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
  prettier,
);

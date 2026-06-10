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
      '**/dist-web/**',
      '**/out/**',
      '**/ios/**',
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
  {
    // @selfos/core is platform-agnostic: it runs on both Electron (Node) and the iOS WKWebView, so it
    // must not reach for node:*, electron, or the node-only `Buffer` (07-mobile-platform §5). The tsconfig
    // uses @types/node only as a compile-time global environment; this rule enforces the real boundary.
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'Buffer',
          message:
            '@selfos/core must be portable (Electron + iOS WKWebView): use Uint8Array + the base64 helpers in encoding.ts, not Buffer.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message:
                '@selfos/core is platform-agnostic — depend on injected host interfaces, not electron.',
            },
          ],
          patterns: [
            {
              group: ['node:*'],
              message:
                '@selfos/core must not use node:* — it also runs in the iOS WKWebView (07-mobile-platform §5).',
            },
          ],
        },
      ],
    },
  },
  prettier,
);

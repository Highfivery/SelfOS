import { defineConfig } from 'vitest/config';

/**
 * Root Vitest config for the monorepo.
 *
 * Packages may add their own config (e.g. the renderer needs a jsdom environment for
 * component tests). This root config runs Node-environment unit tests and stays green
 * on an empty repo via `passWithNoTests`.
 */
export default defineConfig({
  test: {
    passWithNoTests: true,
    environment: 'node',
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/build/**', '**/e2e/**'],
  },
});

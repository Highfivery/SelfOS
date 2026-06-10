import { defineConfig } from 'vitest/config';

// Core is platform-agnostic; its tests run in a plain node environment (WebCrypto + scrypt-js, no DOM).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});

import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
      '@shared': resolve(import.meta.dirname, 'src/shared'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'out/**', 'dist/**'],
    css: false,
  },
});

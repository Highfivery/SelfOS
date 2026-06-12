import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The Worker handler tests run in node (Request/Response globals); the answering-page RTL tests opt into
// jsdom per-file via `// @vitest-environment jsdom`. The React plugin transforms the page TSX.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    setupFiles: ['./test-setup.ts'],
    css: false,
  },
});

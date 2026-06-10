import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as {
  version: string;
};

// @selfos/core is a source-only workspace package (.ts, no build step); bundle it into the output
// instead of externalizing, so its TypeScript is compiled rather than `require`d at runtime.
const bundleCore = { exclude: ['@selfos/core'] };

export default defineConfig({
  main: {
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    plugins: [externalizeDepsPlugin(bundleCore)],
  },
  preload: {
    plugins: [externalizeDepsPlugin(bundleCore)],
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
        '@shared': resolve(import.meta.dirname, 'src/shared'),
      },
    },
    plugins: [react()],
  },
});

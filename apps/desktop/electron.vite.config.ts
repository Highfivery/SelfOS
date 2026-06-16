import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { buildDefines } from './buildInfo';

// @selfos/core is a source-only workspace package (.ts, no build step); bundle it into the output
// instead of externalizing, so its TypeScript is compiled rather than `require`d at runtime.
const bundleCore = { exclude: ['@selfos/core'] };

// Version + build SHA/date, injected as compile-time globals (19-distribution §3.3/§5).
const define = buildDefines();

export default defineConfig({
  main: {
    define,
    plugins: [externalizeDepsPlugin(bundleCore)],
  },
  preload: {
    plugins: [externalizeDepsPlugin(bundleCore)],
  },
  renderer: {
    define,
    resolve: {
      alias: {
        '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
        '@shared': resolve(import.meta.dirname, 'src/shared'),
      },
    },
    plugins: [react()],
  },
});

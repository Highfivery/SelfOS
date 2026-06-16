import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { buildDefines } from './buildInfo';

/**
 * Standalone **web build** of the renderer for the Capacitor/iOS shell (07-mobile-platform §5.3/§5.4).
 * Same React UI as the Electron build (which uses electron-vite); the only difference is the entry
 * (`index.html` → `main.web.tsx`), which installs `window.selfos` in the webview instead of via a preload.
 * Output goes to `dist-web/`, which Capacitor copies into the iOS app as its `webDir`.
 */
export default defineConfig({
  root: resolve(import.meta.dirname),
  // Version + build SHA/date globals, matching the Electron build (19-distribution §3.3/§5).
  define: buildDefines(),
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
      '@shared': resolve(import.meta.dirname, 'src/shared'),
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist-web'),
    emptyOutDir: true,
  },
});

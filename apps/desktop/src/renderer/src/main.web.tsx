import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Register built-in settings before any store reads defaults.
import './settings/builtins';
import '@fontsource-variable/mulish';
import '@fontsource/lora/400.css';
import '@fontsource/lora/400-italic.css';
import './design-system/tokens.css';
import './app/app.css';
import { App } from './app/App';
import { installRealBridge } from './host/webHost';

/**
 * Web/iOS entry (07-mobile-platform §5.3). Same React UI as Electron — the only difference is who
 * provides `window.selfos`: on Electron the preload, here the in-webview host. iii-b2 wires the real
 * in-webview host (the `createCoreBridge` factory over an IndexedDB vault + `localStorage` secrets +
 * a fake Claude), so the actual `@selfos/core` logic runs in the browser. The native iCloud FS /
 * Keychain / real Claude hosts replace those browser stubs in iii-b3/c.
 */
installRealBridge();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

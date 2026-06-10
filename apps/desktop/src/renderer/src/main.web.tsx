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
import { installStubBridge } from './host/stubBridge';

/**
 * Web/iOS entry (07-mobile-platform §5.3). Same React UI as Electron — the only difference is who
 * provides `window.selfos`: on Electron the preload, here the in-webview host. iii-a installs a temporary
 * stub so the UI renders inside the iOS WKWebView; iii-b/c/d replace it with the real `@selfos/core` host.
 */
installStubBridge();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

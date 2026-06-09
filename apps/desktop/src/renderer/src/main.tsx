import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/mulish';
import '@fontsource/lora/400.css';
import '@fontsource/lora/400-italic.css';
import './design-system/tokens.css';
import './app/app.css';
import { App } from './app/App';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

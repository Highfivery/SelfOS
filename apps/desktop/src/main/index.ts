import { app, BrowserWindow, session } from 'electron';
import { createMainWindow } from './window';
import { registerIpcHandlers } from './ipc';

function focusExistingWindow(): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
}

function applyProductionCsp(): void {
  // Enforce a strict CSP on the packaged app. In dev, electron-vite serves over a local dev server
  // with HMR, so we leave that untouched.
  if (process.env['ELECTRON_RENDERER_URL']) return;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'",
        ],
      },
    });
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusExistingWindow);

  void app.whenReady().then(() => {
    applyProductionCsp();
    registerIpcHandlers();
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

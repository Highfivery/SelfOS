import { app, BrowserWindow, Menu, screen, session } from 'electron';
import { createMainWindow } from './window';
import { registerIpcHandlers } from './ipc';
import { computeBootState } from './boot';
import { readDeviceState, writeDeviceState } from './state/deviceStore';
import { clampBoundsToDisplays } from './window/windowState';
import { startVaultWatcher, stopVaultWatcher } from './vaultWatcherManager';
import { buildAppMenu } from './menu';

let saveTimer: NodeJS.Timeout | undefined;

function userDataDir(): string {
  return app.getPath('userData');
}

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

async function restoreBounds(): Promise<ReturnType<typeof clampBoundsToDisplays> | undefined> {
  const state = await readDeviceState(userDataDir());
  if (!state.window) return undefined;
  const displays = screen.getAllDisplays().map((d) => d.workArea);
  return clampBoundsToDisplays(state.window, displays);
}

async function saveBounds(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return;
  const { width, height, x, y } = win.getBounds();
  const state = await readDeviceState(userDataDir());
  await writeDeviceState(userDataDir(), { ...state, window: { width, height, x, y } });
}

function trackWindowState(win: BrowserWindow): void {
  const schedule = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveBounds(win), 400);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    void saveBounds(win);
  });
}

async function startWatcherIfReady(win: BrowserWindow): Promise<void> {
  const boot = await computeBootState(userDataDir());
  if (boot.phase !== 'ready' || !boot.vaultPath) return;
  startVaultWatcher(boot.vaultPath, win.webContents);
}

// Set an explicit app name BEFORE the single-instance lock / any userData access. In dev, Electron
// would otherwise derive userData from the package name (`@selfos/desktop`), which can collide with
// other scaffolded apps and cause a silent single-instance quit.
app.setName('SelfOS');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusExistingWindow);

  void app.whenReady().then(async () => {
    applyProductionCsp();
    registerIpcHandlers();
    Menu.setApplicationMenu(buildAppMenu());

    const win = createMainWindow(await restoreBounds());
    trackWindowState(win);
    await startWatcherIfReady(win);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('before-quit', () => {
    void stopVaultWatcher();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

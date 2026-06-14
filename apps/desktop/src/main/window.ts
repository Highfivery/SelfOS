import { join } from 'node:path';
import { BrowserWindow, nativeTheme, shell, type BrowserWindowConstructorOptions } from 'electron';
import { BACKGROUND_COLORS } from '../shared/appearance';
import { IpcChannels } from '../shared/channels';
import type { WindowBounds } from '../shared/schemas';

/**
 * Titlebar geometry shared with the renderer (`--titlebar-height` / `--titlebar-traffic-width` in
 * tokens.css). Keep these in lockstep so the macOS traffic-light cluster centers within the custom
 * titlebar and never overlaps the brand (02-app-shell §13.2/§13.5).
 */
const TITLEBAR_HEIGHT = 44;
const TRAFFIC_LIGHT_CLUSTER_HEIGHT = 14;

/**
 * Per-platform window-chrome options for the integrated titlebar (02-app-shell §13.2):
 * - **macOS** keeps `hiddenInset` and centers the traffic lights in the taller custom titlebar.
 * - **Windows** hides the native frame and draws min/max/close into the bar via `titleBarOverlay`
 *   (best-effort colors — verified on-device later, like the iOS work).
 * - **Linux / other** keep the default native frame; the `AppHeader` still renders below it.
 */
function chromeOptions(): BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: {
        x: 18,
        y: Math.round((TITLEBAR_HEIGHT - TRAFFIC_LIGHT_CLUSTER_HEIGHT) / 2),
      },
    };
  }
  if (process.platform === 'win32') {
    const dark = nativeTheme.shouldUseDarkColors;
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: dark ? BACKGROUND_COLORS.dark : BACKGROUND_COLORS.light,
        symbolColor: dark ? '#e6e6e6' : '#333333',
        height: TITLEBAR_HEIGHT,
      },
    };
  }
  return { titleBarStyle: 'default' };
}

/**
 * Creates the single main window with the security baseline from 00-architecture §3:
 * contextIsolation + sandbox on, nodeIntegration off, external links to the OS browser. Restores
 * saved geometry when provided (already clamped to a visible display by the caller).
 */
export function createMainWindow(bounds?: WindowBounds): BrowserWindow {
  const backgroundColor = nativeTheme.shouldUseDarkColors
    ? BACKGROUND_COLORS.dark
    : BACKGROUND_COLORS.light;

  const position =
    bounds?.x !== undefined && bounds.y !== undefined ? { x: bounds.x, y: bounds.y } : {};

  const win = new BrowserWindow({
    width: bounds?.width ?? 1100,
    height: bounds?.height ?? 760,
    ...position,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor,
    ...chromeOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // On macOS the traffic lights hide in fullscreen, so the titlebar reclaims their reserved inset.
  // Tell the renderer about the transition (no-op layout effect on other platforms).
  const sendFullscreen = (fullscreen: boolean): void => {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.fullscreenChanged, fullscreen);
  };
  win.on('enter-full-screen', () => sendFullscreen(true));
  win.on('leave-full-screen', () => sendFullscreen(false));
  // Push the initial state once the renderer is up, in case the OS restored the window directly into
  // fullscreen (otherwise the traffic-light inset would be reserved against hidden lights).
  win.webContents.once('did-finish-load', () => sendFullscreen(win.isFullScreen()));

  // Open external links in the OS browser; never navigate the app frame away from itself.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

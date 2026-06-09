import { join } from 'node:path';
import { BrowserWindow, nativeTheme, shell } from 'electron';
import { BACKGROUND_COLORS } from '../shared/appearance';
import type { WindowBounds } from '../shared/schemas';

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
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());

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

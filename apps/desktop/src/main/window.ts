import { join } from 'node:path';
import { BrowserWindow, nativeTheme, shell } from 'electron';
import { BACKGROUND_COLORS } from '../shared/appearance';

/**
 * Creates the single main window with the security baseline from 00-architecture §3:
 * contextIsolation + sandbox on, nodeIntegration off, external links to the OS browser.
 */
export function createMainWindow(): BrowserWindow {
  const backgroundColor = nativeTheme.shouldUseDarkColors
    ? BACKGROUND_COLORS.dark
    : BACKGROUND_COLORS.light;

  const win = new BrowserWindow({
    width: 1100,
    height: 760,
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

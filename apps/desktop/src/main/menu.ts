import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { readDeviceState } from './state/deviceStore';

async function openVaultFolder(): Promise<void> {
  const { vaultPath } = await readDeviceState(app.getPath('userData'));
  if (vaultPath) await shell.openPath(vaultPath);
}

/** A minimal native application menu (standard roles + Open Vault Folder). */
export function buildAppMenu(): Menu {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Vault Folder', click: () => void openVaultFolder() },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];

  return Menu.buildFromTemplate(template);
}

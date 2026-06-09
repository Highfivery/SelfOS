import { app, dialog, ipcMain } from 'electron';
import { z } from 'zod';
import { IpcChannels } from '../shared/channels';
import { BootStateSchema, type BootState } from '../shared/schemas';
import { computeBootState } from './boot';
import { initializeVault } from './vault/vault';
import { readDeviceState, writeDeviceState } from './state/deviceStore';

function userDataDir(): string {
  return app.getPath('userData');
}

async function currentBootState(): Promise<BootState> {
  return BootStateSchema.parse(await computeBootState(userDataDir()));
}

/** Registers main-process IPC handlers for the boot/vault flow (02-app-shell §6). */
export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.getBootState, currentBootState);
  ipcMain.handle(IpcChannels.refreshBootState, currentBootState);

  ipcMain.handle(IpcChannels.selectVaultFolder, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Choose your SelfOS vault folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(IpcChannels.useVault, async (_event, rawPath: unknown): Promise<BootState> => {
    const vaultPath = z.string().min(1).parse(rawPath);
    await initializeVault(vaultPath);
    const state = await readDeviceState(userDataDir());
    await writeDeviceState(userDataDir(), { ...state, vaultPath });
    return currentBootState();
  });
}

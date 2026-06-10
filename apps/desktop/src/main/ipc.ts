import { app, dialog, ipcMain, shell } from 'electron';
import { z } from 'zod';
import { IpcChannels, type SettingsValues } from '../shared/channels';
import { BootStateSchema, type BootState } from '../shared/schemas';
import { computeBootState } from './boot';
import { initializeVault } from './vault/vault';
import { findConflicts } from './vault/conflicts';
import { readDeviceState, writeDeviceState } from './state/deviceStore';
import { readAllSettings, resetSettingValue, writeSettingValue } from './settings/settingsStore';
import { startVaultWatcher } from './vaultWatcherManager';

const ScopeSchema = z.enum(['vault', 'device']);
const SetSettingSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  scope: ScopeSchema,
});
const ResetSettingSchema = z.object({ key: z.string().min(1), scope: ScopeSchema });

async function activeVaultPath(): Promise<string | null> {
  return (await readDeviceState(userDataDir())).vaultPath;
}

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

  ipcMain.handle(IpcChannels.useVault, async (event, rawPath: unknown): Promise<BootState> => {
    const vaultPath = z.string().min(1).parse(rawPath);
    await initializeVault(vaultPath);
    const state = await readDeviceState(userDataDir());
    await writeDeviceState(userDataDir(), { ...state, vaultPath });
    // Begin watching the freshly-activated vault for this session (not just on next launch).
    startVaultWatcher(vaultPath, event.sender);
    return currentBootState();
  });

  ipcMain.handle(IpcChannels.getConflicts, async (): Promise<string[]> => {
    const vaultPath = await activeVaultPath();
    return vaultPath ? findConflicts(vaultPath) : [];
  });

  ipcMain.handle(IpcChannels.revealVault, async (): Promise<void> => {
    const vaultPath = await activeVaultPath();
    if (vaultPath) await shell.openPath(vaultPath);
  });

  ipcMain.handle(IpcChannels.getAppVersion, (): string => __APP_VERSION__);

  ipcMain.handle(IpcChannels.getSettings, async (): Promise<SettingsValues> => {
    const vaultPath = await activeVaultPath();
    if (!vaultPath) return { vault: {}, device: {} };
    return readAllSettings(vaultPath, userDataDir());
  });

  ipcMain.handle(IpcChannels.setSetting, async (_event, raw: unknown): Promise<void> => {
    const { key, value, scope } = SetSettingSchema.parse(raw);
    const vaultPath = await activeVaultPath();
    if (vaultPath) await writeSettingValue(scope, key, value, vaultPath, userDataDir());
  });

  ipcMain.handle(IpcChannels.resetSetting, async (_event, raw: unknown): Promise<void> => {
    const { key, scope } = ResetSettingSchema.parse(raw);
    const vaultPath = await activeVaultPath();
    if (vaultPath) await resetSettingValue(scope, key, vaultPath, userDataDir());
  });
}

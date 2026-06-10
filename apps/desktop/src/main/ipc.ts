import { app, dialog, ipcMain, shell } from 'electron';
import { z } from 'zod';
import {
  ANTHROPIC_API_KEY_ID,
  IpcChannels,
  type ClaudeTestResult,
  type HouseholdStatus,
  type SettingsValues,
} from '../shared/channels';
import { BootStateSchema, type BootState, type Person } from '../shared/schemas';
import { computeBootState } from './boot';
import { initializeVault } from './vault/vault';
import { findConflicts } from './vault/conflicts';
import { readDeviceState, writeDeviceState } from './state/deviceStore';
import { readAllSettings, resetSettingValue, writeSettingValue } from './settings/settingsStore';
import { clearSecret, getSecret, hasSecret, setSecret } from './secrets/secretStore';
import { defaultEncryptor } from './secrets/encryptor';
import { runConnectionTest } from './claude/claudeService';
import { defaultClaudeClient } from './claude/anthropicClient';
import { householdStatus, setupHousehold } from './people/household';
import { getActivePersonId } from './people/session';
import { getPerson } from './people/peopleService';
import { loadMasterKey } from './crypto/masterKey';
import { startVaultWatcher } from './vaultWatcherManager';

const ScopeSchema = z.enum(['vault', 'device']);
const SetSettingSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  scope: ScopeSchema,
});
const ResetSettingSchema = z.object({ key: z.string().min(1), scope: ScopeSchema });
const SecretSetSchema = z.object({ id: z.string().min(1), value: z.string() });
const SecretIdSchema = z.object({ id: z.string().min(1) });
const HouseholdSetupSchema = z.object({
  ownerName: z.string().min(1),
  passphrase: z.string().min(6),
});

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const encryptor = defaultEncryptor();
const claudeClient = defaultClaudeClient();

async function activeModel(): Promise<string> {
  const vaultPath = await activeVaultPath();
  if (!vaultPath) return DEFAULT_MODEL;
  const model = (await readAllSettings(vaultPath, userDataDir())).vault['ai.model'];
  return typeof model === 'string' ? model : DEFAULT_MODEL;
}

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

  ipcMain.handle(IpcChannels.secretSet, async (_event, raw: unknown): Promise<void> => {
    const { id, value } = SecretSetSchema.parse(raw);
    await setSecret(userDataDir(), encryptor, id, value);
  });

  ipcMain.handle(IpcChannels.secretHas, async (_event, raw: unknown): Promise<boolean> => {
    const { id } = SecretIdSchema.parse(raw);
    return hasSecret(userDataDir(), id);
  });

  ipcMain.handle(IpcChannels.secretClear, async (_event, raw: unknown): Promise<void> => {
    const { id } = SecretIdSchema.parse(raw);
    await clearSecret(userDataDir(), id);
  });

  ipcMain.handle(IpcChannels.claudeTest, async (): Promise<ClaudeTestResult> => {
    const apiKey = await getSecret(userDataDir(), encryptor, ANTHROPIC_API_KEY_ID);
    return runConnectionTest(claudeClient, apiKey, await activeModel());
  });

  ipcMain.handle(IpcChannels.householdStatus, async (): Promise<HouseholdStatus> => {
    return householdStatus(userDataDir(), encryptor, await activeVaultPath());
  });

  ipcMain.handle(
    IpcChannels.householdSetup,
    async (_event, raw: unknown): Promise<{ recoveryPhrase: string; ownerId: string }> => {
      const input = HouseholdSetupSchema.parse(raw);
      const vaultPath = await activeVaultPath();
      if (!vaultPath) throw new Error('No vault selected');
      return setupHousehold(userDataDir(), encryptor, vaultPath, input);
    },
  );

  ipcMain.handle(IpcChannels.getActivePerson, async (): Promise<Person | null> => {
    const vaultPath = await activeVaultPath();
    const key = vaultPath ? await loadMasterKey(userDataDir(), encryptor) : null;
    if (!vaultPath || !key) return null;
    const id = await getActivePersonId(userDataDir());
    return id ? getPerson(vaultPath, key, id) : null;
  });
}

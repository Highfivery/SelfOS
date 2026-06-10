import { app, dialog, ipcMain, shell } from 'electron';
import { z } from 'zod';
import {
  ANTHROPIC_API_KEY_ID,
  IpcChannels,
  type AccessView,
  type ClaudeTestResult,
  type HouseholdStatus,
  type SetActiveResult,
  type SettingsValues,
} from '../shared/channels';
import {
  BootStateSchema,
  PersonInputSchema,
  RelationshipInputSchema,
  type BootState,
  type Person,
  type Relationship,
} from '../shared/schemas';
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
import { getActivePersonId, setActivePersonId } from './people/session';
import { getAccessView, removeAccount, setAccount, verifyAccountPin } from './people/accessService';
import { deletePerson, getPerson, listPeople, upsertPerson } from './people/peopleService';
import {
  deleteRelationship,
  listRelationships,
  upsertRelationship,
} from './people/relationshipService';
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
const SetAccountSchema = z.object({
  personId: z.string().min(1),
  roleId: z.string().min(1),
  pin: z.string().nullable().optional(),
});
const SetActiveSchema = z.object({
  personId: z.string().min(1),
  pin: z.string().optional(),
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

/** The active vault + decrypted master key, or null when the household isn't set up. */
async function vaultAndKey(): Promise<{ vaultDir: string; key: Buffer } | null> {
  const vaultDir = await activeVaultPath();
  if (!vaultDir) return null;
  const key = await loadMasterKey(userDataDir(), encryptor);
  return key ? { vaultDir, key } : null;
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
    const ctx = await vaultAndKey();
    if (!ctx) return null;
    const id = await getActivePersonId(userDataDir());
    return id ? getPerson(ctx.vaultDir, ctx.key, id) : null;
  });

  ipcMain.handle(IpcChannels.peopleList, async (): Promise<Person[]> => {
    const ctx = await vaultAndKey();
    return ctx ? listPeople(ctx.vaultDir, ctx.key) : [];
  });

  ipcMain.handle(IpcChannels.peopleSave, async (_event, raw: unknown): Promise<Person> => {
    const ctx = await vaultAndKey();
    if (!ctx) throw new Error('Household is not set up');
    return upsertPerson(ctx.vaultDir, ctx.key, PersonInputSchema.parse(raw));
  });

  ipcMain.handle(IpcChannels.peopleDelete, async (_event, raw: unknown): Promise<void> => {
    const ctx = await vaultAndKey();
    if (!ctx) return;
    await deletePerson(ctx.vaultDir, z.string().min(1).parse(raw));
  });

  ipcMain.handle(IpcChannels.relationshipsList, async (): Promise<Relationship[]> => {
    const ctx = await vaultAndKey();
    return ctx ? listRelationships(ctx.vaultDir, ctx.key) : [];
  });

  ipcMain.handle(
    IpcChannels.relationshipsSave,
    async (_event, raw: unknown): Promise<Relationship> => {
      const ctx = await vaultAndKey();
      if (!ctx) throw new Error('Household is not set up');
      return upsertRelationship(ctx.vaultDir, ctx.key, RelationshipInputSchema.parse(raw));
    },
  );

  ipcMain.handle(IpcChannels.relationshipsDelete, async (_event, raw: unknown): Promise<void> => {
    const ctx = await vaultAndKey();
    if (!ctx) return;
    await deleteRelationship(ctx.vaultDir, z.string().min(1).parse(raw));
  });

  ipcMain.handle(IpcChannels.accessGet, async (): Promise<AccessView> => {
    const ctx = await vaultAndKey();
    return ctx ? getAccessView(ctx.vaultDir, ctx.key) : { roles: [], accounts: [] };
  });

  ipcMain.handle(
    IpcChannels.accessSetAccount,
    async (_event, raw: unknown): Promise<AccessView> => {
      const ctx = await vaultAndKey();
      if (!ctx) throw new Error('Household is not set up');
      await setAccount(ctx.vaultDir, ctx.key, SetAccountSchema.parse(raw));
      return getAccessView(ctx.vaultDir, ctx.key);
    },
  );

  ipcMain.handle(
    IpcChannels.accessRemoveAccount,
    async (_event, raw: unknown): Promise<AccessView> => {
      const ctx = await vaultAndKey();
      if (!ctx) throw new Error('Household is not set up');
      await removeAccount(ctx.vaultDir, ctx.key, z.string().min(1).parse(raw));
      return getAccessView(ctx.vaultDir, ctx.key);
    },
  );

  ipcMain.handle(
    IpcChannels.sessionSetActive,
    async (_event, raw: unknown): Promise<SetActiveResult> => {
      const ctx = await vaultAndKey();
      if (!ctx) return { ok: false, reason: 'NO_ACCOUNT' };
      const { personId, pin } = SetActiveSchema.parse(raw);
      const person = await getPerson(ctx.vaultDir, ctx.key, personId);
      if (!person) return { ok: false, reason: 'NO_ACCOUNT' };
      if (!(await verifyAccountPin(ctx.vaultDir, ctx.key, personId, pin ?? ''))) {
        return { ok: false, reason: 'WRONG_PIN' };
      }
      await setActivePersonId(userDataDir(), personId);
      return { ok: true, person };
    },
  );
}

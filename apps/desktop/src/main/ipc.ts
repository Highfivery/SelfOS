import { app, dialog, ipcMain, shell } from 'electron';
import { z } from 'zod';
import {
  ANTHROPIC_API_KEY_ID,
  IpcChannels,
  type AccessView,
  type BudgetState,
  type ChatTurnResult,
  type ClaudeTestResult,
  type ConversationMeta,
  type HouseholdStatus,
  type SetActiveResult,
  type SettingsValues,
  type UsageSummary,
} from '../shared/channels';
import {
  BootStateSchema,
  BudgetSchema,
  PersonInputSchema,
  RelationshipInputSchema,
  RoleSchema,
  type BootState,
  type Budget,
  type Conversation,
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
import { verifySuperAdminPassphrase } from './people/superAdmin';
import {
  getAccessConfig,
  getAccessView,
  removeAccount,
  saveRole,
  setAccount,
  verifyAccountPin,
} from './people/accessService';
import { deletePerson, getPerson, listPeople, upsertPerson } from './people/peopleService';
import {
  deleteRelationship,
  listRelationships,
  upsertRelationship,
} from './people/relationshipService';
import { loadMasterKey } from './crypto/masterKey';
import { queryUsage, summarize } from './usage/usageStore';
import {
  checkBudget,
  effectivePersonBudget,
  getBudgets,
  setAppBudget,
  setPersonBudget,
  periodStart,
} from './usage/budgetService';
import { roleAllows, type CapabilityKey } from '../shared/capabilities';
import { runChatTurn } from './conversations/chatService';
import {
  deleteConversation,
  getConversation,
  listConversations,
  saveConversation,
} from './conversations/conversationService';
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
const UsageSummarySchema = z.object({
  scope: z.enum(['person', 'app']),
  period: z.enum(['week', 'month']),
});
const ChatStreamSchema = z.object({
  conversationId: z.string().min(1),
  userText: z.string().min(1),
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

/** Whether the active person's role grants a capability (enforces admin-only actions in main). */
async function activePersonCan(
  vaultDir: string,
  key: Buffer,
  capability: CapabilityKey,
): Promise<boolean> {
  const personId = await getActivePersonId(userDataDir());
  if (!personId) return false;
  const access = await getAccessConfig(vaultDir, key);
  const account = access.accounts.find((candidate) => candidate.personId === personId);
  const role = access.roles.find((candidate) => candidate.id === account?.roleId);
  return roleAllows(role, capability);
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

  ipcMain.handle(IpcChannels.accessSaveRole, async (_event, raw: unknown): Promise<AccessView> => {
    const ctx = await vaultAndKey();
    if (!ctx) throw new Error('Household is not set up');
    await saveRole(ctx.vaultDir, ctx.key, RoleSchema.parse(raw));
    return getAccessView(ctx.vaultDir, ctx.key);
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

  ipcMain.handle(IpcChannels.superadminUnlock, async (_event, raw: unknown): Promise<boolean> => {
    const { passphrase } = z.object({ passphrase: z.string() }).parse(raw);
    return verifySuperAdminPassphrase(userDataDir(), passphrase);
  });

  ipcMain.handle(IpcChannels.usageSummary, async (_event, raw: unknown): Promise<UsageSummary> => {
    const { scope, period } = UsageSummarySchema.parse(raw);
    const ctx = await vaultAndKey();
    if (!ctx) return summarize([]);
    const now = new Date();
    const from = periodStart(now, period);
    const to = now.toISOString();
    // Only an admin may see the whole household ("Everyone"); everyone else sees only their own.
    const canManage = await activePersonCan(ctx.vaultDir, ctx.key, 'budgets.manage');
    if (scope === 'app' && canManage) {
      return summarize(await queryUsage(ctx.vaultDir, ctx.key, { from, to }));
    }
    const personId = await getActivePersonId(userDataDir());
    if (!personId) return summarize([]);
    return summarize(await queryUsage(ctx.vaultDir, ctx.key, { from, to, personId }));
  });

  ipcMain.handle(
    IpcChannels.budgetGet,
    async (): Promise<{ app: Budget | null; person: Budget | null }> => {
      const ctx = await vaultAndKey();
      if (!ctx) return { app: null, person: null };
      const budgets = await getBudgets(ctx.vaultDir, ctx.key);
      const personId = await getActivePersonId(userDataDir());
      return {
        app: budgets.app ?? null,
        person: personId ? await effectivePersonBudget(ctx.vaultDir, ctx.key, personId) : null,
      };
    },
  );

  ipcMain.handle(IpcChannels.budgetSetApp, async (_event, raw: unknown): Promise<void> => {
    const ctx = await vaultAndKey();
    if (!ctx || !(await activePersonCan(ctx.vaultDir, ctx.key, 'budgets.manage'))) return;
    await setAppBudget(ctx.vaultDir, ctx.key, raw === null ? null : BudgetSchema.parse(raw));
  });

  ipcMain.handle(IpcChannels.budgetSetPerson, async (_event, raw: unknown): Promise<void> => {
    const ctx = await vaultAndKey();
    if (!ctx || !(await activePersonCan(ctx.vaultDir, ctx.key, 'budgets.manage'))) return;
    const personId = await getActivePersonId(userDataDir());
    if (!personId) return;
    await setPersonBudget(
      ctx.vaultDir,
      ctx.key,
      personId,
      raw === null ? null : BudgetSchema.parse(raw),
    );
  });

  ipcMain.handle(
    IpcChannels.budgetStatus,
    async (): Promise<{ person: BudgetState; app: BudgetState }> => {
      const none: BudgetState = { state: 'none', spentUsd: 0, limitUsd: null, period: null };
      const ctx = await vaultAndKey();
      if (!ctx) return { person: none, app: none };
      const now = new Date();
      const personId = await getActivePersonId(userDataDir());
      const person = personId
        ? await checkBudget(ctx.vaultDir, ctx.key, { scope: 'person', personId, now })
        : none;
      const app = await checkBudget(ctx.vaultDir, ctx.key, { scope: 'app', now });
      return { person, app };
    },
  );

  ipcMain.handle(IpcChannels.conversationsList, async (): Promise<ConversationMeta[]> => {
    const ctx = await vaultAndKey();
    const personId = ctx ? await getActivePersonId(userDataDir()) : null;
    if (!ctx || !personId) return [];
    return (await listConversations(ctx.vaultDir, ctx.key, personId)).map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
    }));
  });

  ipcMain.handle(
    IpcChannels.conversationsGet,
    async (_event, raw): Promise<Conversation | null> => {
      const ctx = await vaultAndKey();
      const personId = ctx ? await getActivePersonId(userDataDir()) : null;
      if (!ctx || !personId) return null;
      return getConversation(ctx.vaultDir, ctx.key, personId, z.string().min(1).parse(raw));
    },
  );

  ipcMain.handle(IpcChannels.conversationsRename, async (_event, raw): Promise<void> => {
    const ctx = await vaultAndKey();
    const personId = ctx ? await getActivePersonId(userDataDir()) : null;
    if (!ctx || !personId) return;
    const { id, title } = z.object({ id: z.string().min(1), title: z.string().min(1) }).parse(raw);
    const conversation = await getConversation(ctx.vaultDir, ctx.key, personId, id);
    if (!conversation) return;
    await saveConversation(ctx.vaultDir, ctx.key, {
      ...conversation,
      title,
      updatedAt: new Date().toISOString(),
    });
  });

  ipcMain.handle(IpcChannels.conversationsDelete, async (_event, raw): Promise<void> => {
    const ctx = await vaultAndKey();
    const personId = ctx ? await getActivePersonId(userDataDir()) : null;
    if (!ctx || !personId) return;
    await deleteConversation(ctx.vaultDir, personId, z.string().min(1).parse(raw));
  });

  ipcMain.handle(IpcChannels.chatStream, async (event, raw): Promise<ChatTurnResult> => {
    const { conversationId, userText } = ChatStreamSchema.parse(raw);
    const ctx = await vaultAndKey();
    const personId = ctx ? await getActivePersonId(userDataDir()) : null;
    if (!ctx || !personId) {
      return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
    }
    const apiKey = await getSecret(userDataDir(), encryptor, ANTHROPIC_API_KEY_ID);
    return runChatTurn({
      vaultDir: ctx.vaultDir,
      key: ctx.key,
      client: claudeClient,
      apiKey,
      model: await activeModel(),
      personId,
      conversationId,
      userText,
      onDelta: (text) => event.sender.send(IpcChannels.chatChunk, text),
      now: new Date(),
    });
  });
}

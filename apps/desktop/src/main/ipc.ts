import { app, dialog, ipcMain, shell } from 'electron';
import { z } from 'zod';
import {
  ANTHROPIC_API_KEY_ID,
  IpcChannels,
  MIN_OWNER_PIN_LENGTH,
  type AccessView,
  type BudgetState,
  type ChatTurnResult,
  type ClaudeTestResult,
  type ConversationMeta,
  type HouseholdStatus,
  type InviteSummary,
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
import { readDeviceState, updateDeviceState, writeDeviceState } from './state/deviceStore';
import { readAllSettings, resetSettingValue, writeSettingValue } from './settings/settingsStore';
import { createNodeSecretStore } from './host/nodeSecretStore';
import { defaultEncryptor } from './secrets/encryptor';
import { runConnectionTest } from './claude/claudeService';
import { defaultClaudeClient } from './claude/anthropicClient';
import { householdStatus, setupHousehold } from './people/household';
import { getActivePersonId, setActivePersonId } from './people/session';
import {
  isSuperAdminActive,
  setSuperAdminActive,
  verifySuperAdminPassphrase,
} from './people/superAdmin';
import {
  cancelInvite,
  createInvite,
  deletePerson,
  deleteRelationship,
  getAccessConfig,
  getAccessView,
  getPerson,
  listInvitesForPerson,
  listPeople,
  listRelationships,
  redeemInvite,
  removeAccount,
  saveRole,
  setAccount,
  upsertPerson,
  upsertRelationship,
  verifyAccountPin,
} from '@selfos/core/people';
import { loadMasterKey, restoreFromRecoveryPhrase, storeMasterKey } from '@selfos/core/crypto';
import type { FileSystem, SecretStore } from '@selfos/core/host';
import { createNodeFileSystem } from './host/nodeFileSystem';
import {
  checkBudget,
  DEFAULT_BUDGET,
  effectivePersonBudget,
  getBudgets,
  periodStart,
  queryUsage,
  setAppBudget,
  setPersonBudget,
  summarize,
} from '@selfos/core/usage';
import { OWNER_ROLE_ID, roleAllows, type CapabilityKey } from '../shared/capabilities';
import {
  deleteConversation,
  getConversation,
  listConversations,
  runChatTurn,
  saveConversation,
} from '@selfos/core/conversations';
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
  pin: z.string().min(MIN_OWNER_PIN_LENGTH),
});
const UnlockWithRecoveryPhraseSchema = z.object({ phrase: z.string().min(1) });
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
  personId: z.string().min(1).optional(),
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

/** The device-local secret store (API key, master key) backed by `safeStorage` + `userData`. */
function secretStore(): SecretStore {
  return createNodeSecretStore(userDataDir(), encryptor);
}

/** The active vault's FileSystem host + decrypted master key, or null when the household isn't set up. */
async function vaultAndKey(): Promise<{ fs: FileSystem; key: Uint8Array } | null> {
  const vaultDir = await activeVaultPath();
  if (!vaultDir) return null;
  const key = await loadMasterKey(secretStore());
  return key ? { fs: createNodeFileSystem(vaultDir), key } : null;
}

/** Whether the active person's role grants a capability (enforces admin-only actions in main). */
async function activePersonCan(
  fs: FileSystem,
  key: Uint8Array,
  capability: CapabilityKey,
): Promise<boolean> {
  // Concealed super-admin inspect mode grants everything (04-people-roles §8) — and main, not the
  // renderer, is the source of truth so the bypass actually reaches the data, not just the UI.
  if (isSuperAdminActive()) return true;
  const personId = await getActivePersonId(userDataDir());
  if (!personId) return false;
  const access = await getAccessConfig(fs, key);
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
    await secretStore().set(id, value);
  });

  ipcMain.handle(IpcChannels.secretHas, async (_event, raw: unknown): Promise<boolean> => {
    const { id } = SecretIdSchema.parse(raw);
    return secretStore().has(id);
  });

  ipcMain.handle(IpcChannels.secretClear, async (_event, raw: unknown): Promise<void> => {
    const { id } = SecretIdSchema.parse(raw);
    await secretStore().clear(id);
  });

  ipcMain.handle(IpcChannels.claudeTest, async (): Promise<ClaudeTestResult> => {
    const apiKey = await secretStore().get(ANTHROPIC_API_KEY_ID);
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

  ipcMain.handle(
    IpcChannels.unlockWithRecoveryPhrase,
    async (_event, raw: unknown): Promise<{ ok: boolean }> => {
      // Join/recover this device: restore the master key from the recovery phrase (10-multi-device
      // §6.2). No owner is created. The phrase is never logged. Bad/garbled phrase → { ok: false }.
      const { phrase } = UnlockWithRecoveryPhraseSchema.parse(raw);
      const vaultPath = await activeVaultPath();
      if (!vaultPath) return { ok: false };
      const ok = await restoreFromRecoveryPhrase(
        secretStore(),
        createNodeFileSystem(vaultPath),
        phrase,
      );
      return { ok };
    },
  );

  ipcMain.handle(IpcChannels.getActivePerson, async (): Promise<Person | null> => {
    const ctx = await vaultAndKey();
    if (!ctx) return null;
    const id = await getActivePersonId(userDataDir());
    return id ? getPerson(ctx.fs, ctx.key, id) : null;
  });

  ipcMain.handle(IpcChannels.peopleList, async (): Promise<Person[]> => {
    const ctx = await vaultAndKey();
    return ctx ? listPeople(ctx.fs, ctx.key) : [];
  });

  ipcMain.handle(IpcChannels.peopleSave, async (_event, raw: unknown): Promise<Person> => {
    const ctx = await vaultAndKey();
    if (!ctx) throw new Error('Household is not set up');
    return upsertPerson(ctx.fs, ctx.key, PersonInputSchema.parse(raw));
  });

  ipcMain.handle(IpcChannels.peopleDelete, async (_event, raw: unknown): Promise<void> => {
    const ctx = await vaultAndKey();
    if (!ctx) return;
    await deletePerson(ctx.fs, z.string().min(1).parse(raw));
  });

  ipcMain.handle(IpcChannels.relationshipsList, async (): Promise<Relationship[]> => {
    const ctx = await vaultAndKey();
    return ctx ? listRelationships(ctx.fs, ctx.key) : [];
  });

  ipcMain.handle(
    IpcChannels.relationshipsSave,
    async (_event, raw: unknown): Promise<Relationship> => {
      const ctx = await vaultAndKey();
      if (!ctx) throw new Error('Household is not set up');
      return upsertRelationship(ctx.fs, ctx.key, RelationshipInputSchema.parse(raw));
    },
  );

  ipcMain.handle(IpcChannels.relationshipsDelete, async (_event, raw: unknown): Promise<void> => {
    const ctx = await vaultAndKey();
    if (!ctx) return;
    await deleteRelationship(ctx.fs, z.string().min(1).parse(raw));
  });

  ipcMain.handle(IpcChannels.accessGet, async (): Promise<AccessView> => {
    const ctx = await vaultAndKey();
    return ctx ? getAccessView(ctx.fs, ctx.key) : { roles: [], accounts: [] };
  });

  ipcMain.handle(IpcChannels.accessSaveRole, async (_event, raw: unknown): Promise<AccessView> => {
    const ctx = await vaultAndKey();
    if (!ctx) throw new Error('Household is not set up');
    await saveRole(ctx.fs, ctx.key, RoleSchema.parse(raw));
    return getAccessView(ctx.fs, ctx.key);
  });

  ipcMain.handle(
    IpcChannels.accessSetAccount,
    async (_event, raw: unknown): Promise<AccessView> => {
      const ctx = await vaultAndKey();
      if (!ctx) throw new Error('Household is not set up');
      await setAccount(ctx.fs, ctx.key, SetAccountSchema.parse(raw));
      return getAccessView(ctx.fs, ctx.key);
    },
  );

  ipcMain.handle(
    IpcChannels.accessRemoveAccount,
    async (_event, raw: unknown): Promise<AccessView> => {
      const ctx = await vaultAndKey();
      if (!ctx) throw new Error('Household is not set up');
      await removeAccount(ctx.fs, ctx.key, z.string().min(1).parse(raw));
      return getAccessView(ctx.fs, ctx.key);
    },
  );

  // Device invites (10-multi-device-vault §5.4) — owner-only (people.manage), enforced in main.
  ipcMain.handle(
    IpcChannels.invitesCreate,
    async (_event, raw: unknown): Promise<{ code: string; expiresAt: string }> => {
      const ctx = await vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))) {
        throw new Error('Not permitted');
      }
      const { personId } = z.object({ personId: z.string().min(1) }).parse(raw);
      // Member-scoped, enforced in main (not just the UI): the target must be a real, NON-owner
      // account — never wrap the master key in an invite bound to the owner (10-multi-device §5.4).
      const access = await getAccessConfig(ctx.fs, ctx.key);
      const account = access.accounts.find((candidate) => candidate.personId === personId);
      if (!account || account.roleId === OWNER_ROLE_ID) throw new Error('Not a member');
      // One valid code per person — supersede any existing pending invite at the boundary.
      const now = Date.now();
      for (const pending of await listInvitesForPerson(ctx.fs, personId, now)) {
        await cancelInvite(ctx.fs, pending.id);
      }
      const { code, invite } = await createInvite(ctx.fs, ctx.key, personId, now);
      return { code, expiresAt: invite.expiresAt };
    },
  );

  ipcMain.handle(
    IpcChannels.invitesList,
    async (_event, raw: unknown): Promise<InviteSummary[]> => {
      const ctx = await vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))) return [];
      const { personId } = z.object({ personId: z.string().min(1) }).parse(raw);
      return listInvitesForPerson(ctx.fs, personId, Date.now());
    },
  );

  ipcMain.handle(IpcChannels.invitesCancel, async (_event, raw: unknown): Promise<void> => {
    const ctx = await vaultAndKey();
    if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))) return;
    const { id } = z.object({ id: z.string().min(1) }).parse(raw);
    await cancelInvite(ctx.fs, id);
  });

  // Member redeem (no device key required yet — that's the point): unwrap the master key from the
  // invite and store it device-local, remembering who the invite is for (10-multi-device §5.4).
  ipcMain.handle(
    IpcChannels.invitesRedeem,
    async (_event, raw: unknown): Promise<{ ok: boolean; displayName?: string }> => {
      const { code } = z.object({ code: z.string().min(1) }).parse(raw);
      const vaultPath = await activeVaultPath();
      if (!vaultPath) return { ok: false };
      const fs = createNodeFileSystem(vaultPath);
      const result = await redeemInvite(fs, code, Date.now());
      if (!result) return { ok: false };
      await storeMasterKey(secretStore(), result.masterKey);
      // Persist the pending join so a crash before completeJoin resumes the "Set your PIN" step on
      // next boot — never drop into an open picker with a PIN-less account (the master key is now
      // on this device).
      await updateDeviceState(userDataDir(), { pendingJoinPersonId: result.personId });
      const person = await getPerson(fs, result.masterKey, result.personId);
      return { ok: true, ...(person ? { displayName: person.displayName } : {}) };
    },
  );

  // Finish joining: set the freshly-redeemed member's OWN PIN and sign them in. Only the person the
  // redeem resolved (persisted device-local) can be completed — the renderer can't target another
  // account, and never the owner.
  ipcMain.handle(
    IpcChannels.invitesCompleteJoin,
    async (_event, raw: unknown): Promise<{ ok: boolean }> => {
      const { pin } = z.object({ pin: z.string().min(MIN_OWNER_PIN_LENGTH) }).parse(raw);
      const ctx = await vaultAndKey();
      const personId = (await readDeviceState(userDataDir())).pendingJoinPersonId ?? null;
      if (!ctx || !personId) return { ok: false };
      const account = (await getAccessConfig(ctx.fs, ctx.key)).accounts.find(
        (candidate) => candidate.personId === personId,
      );
      if (!account || account.roleId === OWNER_ROLE_ID) return { ok: false };
      await setAccount(ctx.fs, ctx.key, { personId, roleId: account.roleId, pin });
      await setActivePersonId(userDataDir(), personId);
      await updateDeviceState(userDataDir(), { pendingJoinPersonId: null });
      return { ok: true };
    },
  );

  ipcMain.handle(
    IpcChannels.sessionSetActive,
    async (_event, raw: unknown): Promise<SetActiveResult> => {
      const ctx = await vaultAndKey();
      if (!ctx) return { ok: false, reason: 'NO_ACCOUNT' };
      const { personId, pin } = SetActiveSchema.parse(raw);
      const person = await getPerson(ctx.fs, ctx.key, personId);
      if (!person) return { ok: false, reason: 'NO_ACCOUNT' };
      if (!(await verifyAccountPin(ctx.fs, ctx.key, personId, pin ?? ''))) {
        return { ok: false, reason: 'WRONG_PIN' };
      }
      await setActivePersonId(userDataDir(), personId);
      return { ok: true, person };
    },
  );

  ipcMain.handle(IpcChannels.superadminUnlock, async (_event, raw: unknown): Promise<boolean> => {
    const { passphrase } = z.object({ passphrase: z.string() }).parse(raw);
    // The super-admin secret lives in the vault now (10-multi-device-vault §6.4) — verify against it
    // (migrating a legacy device-local hash on first use). Requires the vault to be unlocked.
    const ctx = await vaultAndKey();
    if (!ctx) return false;
    const ok = await verifySuperAdminPassphrase(ctx.fs, ctx.key, userDataDir(), passphrase);
    if (ok) setSuperAdminActive(true);
    return ok;
  });

  ipcMain.handle(IpcChannels.superadminLock, (): void => {
    setSuperAdminActive(false);
  });

  ipcMain.handle(IpcChannels.getSidebarCollapsed, async (): Promise<boolean> => {
    return (await readDeviceState(userDataDir())).sidebarCollapsed ?? false;
  });

  ipcMain.handle(IpcChannels.setSidebarCollapsed, async (_event, raw: unknown): Promise<void> => {
    const collapsed = z.boolean().parse(raw);
    const state = await readDeviceState(userDataDir());
    await writeDeviceState(userDataDir(), { ...state, sidebarCollapsed: collapsed });
  });

  ipcMain.handle(IpcChannels.usageSummary, async (_event, raw: unknown): Promise<UsageSummary> => {
    const { scope, period, personId } = UsageSummarySchema.parse(raw);
    const ctx = await vaultAndKey();
    if (!ctx) return summarize([]);
    const now = new Date();
    const from = periodStart(now, period);
    const to = now.toISOString();
    // Only an admin may see the whole household or another person; everyone else sees only their own.
    const canManage = await activePersonCan(ctx.fs, ctx.key, 'budgets.manage');
    if (canManage) {
      if (personId) return summarize(await queryUsage(ctx.fs, ctx.key, { from, to, personId }));
      if (scope === 'app') return summarize(await queryUsage(ctx.fs, ctx.key, { from, to }));
    }
    const self = await getActivePersonId(userDataDir());
    if (!self) return summarize([]);
    return summarize(await queryUsage(ctx.fs, ctx.key, { from, to, personId: self }));
  });

  ipcMain.handle(
    IpcChannels.budgetGet,
    async (): Promise<{ app: Budget | null; person: Budget | null }> => {
      const ctx = await vaultAndKey();
      if (!ctx) return { app: null, person: null };
      const budgets = await getBudgets(ctx.fs, ctx.key);
      const personId = await getActivePersonId(userDataDir());
      return {
        app: budgets.app ?? null,
        person: personId ? await effectivePersonBudget(ctx.fs, ctx.key, personId) : null,
      };
    },
  );

  ipcMain.handle(IpcChannels.budgetGetPerson, async (_event, raw: unknown): Promise<Budget> => {
    const personId = z.string().min(1).parse(raw);
    const ctx = await vaultAndKey();
    if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'budgets.manage'))) {
      return DEFAULT_BUDGET;
    }
    return effectivePersonBudget(ctx.fs, ctx.key, personId);
  });

  ipcMain.handle(IpcChannels.budgetSetApp, async (_event, raw: unknown): Promise<void> => {
    const ctx = await vaultAndKey();
    if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'budgets.manage'))) return;
    await setAppBudget(ctx.fs, ctx.key, raw === null ? null : BudgetSchema.parse(raw));
  });

  ipcMain.handle(IpcChannels.budgetSetPerson, async (_event, raw: unknown): Promise<void> => {
    const { personId, budget } = z
      .object({ personId: z.string().min(1), budget: BudgetSchema.nullable() })
      .parse(raw);
    const ctx = await vaultAndKey();
    if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'budgets.manage'))) return;
    await setPersonBudget(ctx.fs, ctx.key, personId, budget);
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
        ? await checkBudget(ctx.fs, ctx.key, { scope: 'person', personId, now })
        : none;
      const app = await checkBudget(ctx.fs, ctx.key, { scope: 'app', now });
      return { person, app };
    },
  );

  ipcMain.handle(IpcChannels.conversationsList, async (): Promise<ConversationMeta[]> => {
    const ctx = await vaultAndKey();
    const personId = ctx ? await getActivePersonId(userDataDir()) : null;
    if (!ctx || !personId) return [];
    return (await listConversations(ctx.fs, ctx.key, personId)).map((c) => ({
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
      return getConversation(ctx.fs, ctx.key, personId, z.string().min(1).parse(raw));
    },
  );

  ipcMain.handle(IpcChannels.conversationsRename, async (_event, raw): Promise<void> => {
    const ctx = await vaultAndKey();
    const personId = ctx ? await getActivePersonId(userDataDir()) : null;
    if (!ctx || !personId) return;
    const { id, title } = z.object({ id: z.string().min(1), title: z.string().min(1) }).parse(raw);
    const conversation = await getConversation(ctx.fs, ctx.key, personId, id);
    if (!conversation) return;
    await saveConversation(ctx.fs, ctx.key, {
      ...conversation,
      title,
      updatedAt: new Date().toISOString(),
    });
  });

  ipcMain.handle(IpcChannels.conversationsDelete, async (_event, raw): Promise<void> => {
    const ctx = await vaultAndKey();
    const personId = ctx ? await getActivePersonId(userDataDir()) : null;
    if (!ctx || !personId) return;
    await deleteConversation(ctx.fs, personId, z.string().min(1).parse(raw));
  });

  ipcMain.handle(IpcChannels.chatStream, async (event, raw): Promise<ChatTurnResult> => {
    const { conversationId, userText } = ChatStreamSchema.parse(raw);
    const ctx = await vaultAndKey();
    const personId = ctx ? await getActivePersonId(userDataDir()) : null;
    if (!ctx || !personId) {
      return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
    }
    const apiKey = await secretStore().get(ANTHROPIC_API_KEY_ID);
    return runChatTurn({
      fs: ctx.fs,
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

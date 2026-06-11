import { z } from 'zod';
import {
  ANTHROPIC_API_KEY_ID,
  MIN_OWNER_PIN_LENGTH,
  type AccessView,
  type BudgetState,
  type ChatTurnResult,
  type ClaudeTestResult,
  type ConversationMeta,
  type HouseholdStatus,
  type InviteSummary,
  type SelfosBridge,
  type SetActiveResult,
  type SettingsValues,
  type UsageSummary,
} from './channels';
import {
  AnswerTypeSchema,
  BudgetSchema,
  PersonInputSchema,
  QuestionnaireInputSchema,
  RelationshipInputSchema,
  RoleSchema,
  SensitivityTierSchema,
  SettingsFileSchema,
  type Assignment,
  type Insight,
  type QuestionnaireAnalyzeResult,
  type QuestionnaireGenerateResult,
  type QuestionnaireImproveResult,
  type QuestionnaireSuggestResult,
  type BootState,
  type Budget,
  type Conversation,
  type DeviceState,
  type Person,
  type Questionnaire,
  type Relationship,
} from './schemas';
import { OWNER_ROLE_ID, roleAllows, type CapabilityKey } from './capabilities';
import { runConnectionTest } from './claudeProxy';
import type { ClaudeClient, FileSystem, SecretStore } from '@selfos/core/host';
import { uuid } from '@selfos/core/id';
import {
  createMasterKey,
  isVaultInitialized,
  loadMasterKey,
  restoreFromRecoveryPhrase,
  storeMasterKey,
  VAULT_ALREADY_INITIALIZED,
} from '@selfos/core/crypto';
import {
  cancelInvite,
  createInvite,
  deletePerson,
  deleteRelationship,
  getAccessConfig,
  getAccessView,
  getPerson,
  hasSuperAdminPassphrase,
  listInvitesForPerson,
  listPeople,
  listRelationships,
  redeemInvite,
  removeAccount,
  savePerson,
  saveRole,
  setAccount,
  setSuperAdminPassphrase,
  storeSuperAdminHash,
  upsertPerson,
  upsertRelationship,
  verifyAccountPin,
  verifySuperAdminPassphrase,
} from '@selfos/core/people';
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
import {
  deleteConversation,
  getConversation,
  listConversations,
  runChatTurn,
  saveConversation,
} from '@selfos/core/conversations';
import { deleteInsight, listAllInsights, updateInsight } from '@selfos/core/insights';
import {
  addCustomType,
  analyzeAssignment,
  createAssignment,
  deleteQuestionnaire,
  deleteQuestionnaireImage,
  generateQuestions,
  getQuestionnaire,
  getQuestionnaireImage,
  improveQuestion,
  isAllowedImageMime,
  listCustomTypes,
  listQuestionnaires,
  MAX_IMAGE_BYTES,
  saveQuestionnaire,
  storeQuestionnaireImage,
  suggestQuestionnaires,
  validateQuestionnaire,
  type AiDeps,
} from '@selfos/core/questionnaires';
import { fromBase64, toBase64 } from '@selfos/core/encoding';

/**
 * The platform-agnostic SelfOS bridge factory (07-mobile-platform §5.3, slice iii-b1). The renderer
 * only ever talks to a `SelfosBridge` (`window.selfos`); this factory implements the ~30 vault-data
 * operations **once**, over an injected `BridgeHost` of platform primitives. Both hosts use it:
 *
 * - **Electron:** `ipc.ts` builds a node-backed `BridgeHost`, calls `createCoreBridge`, and wraps each
 *   data method in an `ipcMain.handle` delegate; the preload exposes the same `SelfosBridge` shape.
 * - **iOS (Capacitor):** an in-webview host wires the primitives to native plugins; the renderer calls
 *   this bridge directly (no IPC).
 *
 * This module must stay **node/electron-free** — the web build imports it. Inputs from the (untrusted)
 * renderer are Zod-validated here so the trust boundary holds on both platforms.
 */
export interface BridgeHost {
  // --- Vault access ---
  /** The active vault's `FileSystem` + decrypted master key, or null when not unlocked / not set up. */
  vaultAndKey(): Promise<{ fs: FileSystem; key: Uint8Array } | null>;
  /** The active vault path, or null when none is selected. */
  vaultPath(): Promise<string | null>;
  /** A `FileSystem` rooted at a vault path — for setup/unlock/settings flows that run without a key. */
  fileSystem(vaultPath: string): FileSystem;
  /** Device-local secret store (master key, API key). */
  secrets: SecretStore;
  /** Streaming Claude client. */
  claude: ClaudeClient;

  // --- Device-local state ---
  readDeviceState(): Promise<DeviceState>;
  updateDeviceState(patch: Partial<DeviceState>): Promise<DeviceState>;
  /** Device-scoped settings (`key → value`); device-local, separate from the synced vault settings. */
  readDeviceSettings(): Promise<Record<string, unknown>>;
  writeDeviceSettings(values: Record<string, unknown>): Promise<void>;

  // --- Misc ---
  /** The model to use for AI calls (the host reads its own model preference + default). */
  activeModel(): Promise<string>;
  /** Concealed super-admin inspect mode — an in-memory device-session flag, never persisted. */
  isSuperAdminActive(): boolean;
  setSuperAdminActive(active: boolean): void;
  /** The app version string (About section). */
  appVersion: string;

  // --- Streaming sink ---
  /** Deliver a chat reply chunk to the renderer (Electron → IPC event; iOS → in-webview listener). */
  emitChatChunk(chunk: string): void;

  // --- Platform-specific surface, forwarded verbatim to the renderer-facing bridge ---
  getBootState(): Promise<BootState>;
  refreshBootState(): Promise<BootState>;
  selectVaultFolder(): Promise<string | null>;
  useVault(path: string): Promise<BootState>;
  getConflicts(): Promise<string[]>;
  revealVault(): Promise<void>;
  /** Subscribe to external vault changes (the host's watcher); returns an unsubscribe. */
  onVaultChanged(listener: () => void): () => void;
  /** Subscribe to streamed chat chunks; the renderer-facing counterpart to `emitChatChunk`. */
  onChatChunk(listener: (delta: string) => void): () => void;
}

/** Vault-relative path of the plain-JSON, vault-scoped settings file (02-app-shell). */
const VAULT_SETTINGS_PATH = 'config/settings.json';

/**
 * Read the vault-scoped settings `key → value` map via the `FileSystem` host. Plain JSON (not
 * encrypted); falls back to an empty map on a missing or unparseable file. Exported so the Electron
 * host's `activeModel` can read the model preference without re-implementing the file handling.
 */
export async function readVaultSettingsValues(fs: FileSystem): Promise<Record<string, unknown>> {
  const bytes = await fs.read(VAULT_SETTINGS_PATH);
  if (!bytes) return {};
  try {
    return SettingsFileSchema.parse(JSON.parse(new TextDecoder().decode(bytes))).values;
  } catch {
    return {};
  }
}

async function writeVaultSettingsValues(
  fs: FileSystem,
  values: Record<string, unknown>,
): Promise<void> {
  const text = `${JSON.stringify({ schemaVersion: 1, values }, null, 2)}\n`;
  await fs.writeAtomic(VAULT_SETTINGS_PATH, new TextEncoder().encode(text));
}

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
const SetActiveSchema = z.object({ personId: z.string().min(1), pin: z.string().optional() });
const UsageSummarySchema = z.object({
  scope: z.enum(['person', 'app']),
  period: z.enum(['week', 'month']),
  personId: z.string().min(1).optional(),
});
const ChatStreamSchema = z.object({
  conversationId: z.string().min(1),
  userText: z.string().min(1),
});
const PersonIdSchema = z.string().min(1);
const InvitePersonSchema = z.object({ personId: z.string().min(1) });
const InviteIdSchema = z.object({ id: z.string().min(1) });
const InviteCodeSchema = z.object({ code: z.string().min(1) });
const CompleteJoinSchema = z.object({ pin: z.string().min(MIN_OWNER_PIN_LENGTH) });
const RenameSchema = z.object({ id: z.string().min(1), title: z.string().min(1) });
const BudgetSetPersonSchema = z.object({
  personId: z.string().min(1),
  budget: BudgetSchema.nullable(),
});
const PassphraseSchema = z.object({ passphrase: z.string() });
const AssignmentsCreateSchema = z.object({
  questionnaireId: z.string().min(1),
  recipientPersonId: z.string().min(1),
  privacy: z.enum(['standard', 'private']).optional(),
  senderVisibleToRecipient: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
});
const StoreImageSchema = z.object({ base64: z.string().min(1), mime: z.string().min(1) });
const GenerateSchema = z.object({
  type: z.string().min(1),
  sensitivity: SensitivityTierSchema,
  brief: z.string().optional(),
  targetPersonId: z.string().min(1).optional(),
  includeAuthor: z.boolean(),
  includeTarget: z.boolean(),
  includeRelationship: z.boolean(),
  existingPrompts: z.array(z.string()),
});
const ImproveSchema = z.object({
  prompt: z.string().min(1),
  type: AnswerTypeSchema,
  instruction: z.string().min(1),
});
const SuggestSchema = z.object({ targetPersonId: z.string().min(1).optional() });
const AnalyzeSchema = z.object({ assignmentId: z.string().min(1) });
const InsightFactInputSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  shareable: z.boolean(),
});
const InsightEditSchema = z.object({
  subjectPersonId: z.string().min(1),
  id: z.string().min(1),
  summary: z.string().optional(),
  facts: z.array(InsightFactInputSchema).optional(),
});
const InsightIdSchema = z.object({ subjectPersonId: z.string().min(1), id: z.string().min(1) });

/** Build the renderer-facing `SelfosBridge` from a platform `BridgeHost`. */
export function createCoreBridge(host: BridgeHost): SelfosBridge {
  const activePersonId = async (): Promise<string | null> =>
    (await host.readDeviceState()).activePersonId ?? null;

  /** Whether the active person's role grants a capability — enforces admin-only actions in the bridge. */
  const activePersonCan = async (
    fs: FileSystem,
    key: Uint8Array,
    capability: CapabilityKey,
  ): Promise<boolean> => {
    // Concealed super-admin inspect mode grants everything (04-people-roles §8); the bridge (not the
    // renderer) is the source of truth so the bypass reaches the data, not just the UI.
    if (host.isSuperAdminActive()) return true;
    const personId = await activePersonId();
    if (!personId) return false;
    const access = await getAccessConfig(fs, key);
    const account = access.accounts.find((candidate) => candidate.personId === personId);
    const role = access.roles.find((candidate) => candidate.id === account?.roleId);
    return roleAllows(role, capability);
  };

  /** Build the deps for an AI authoring call, gated by `capability`; null if not permitted. */
  const aiDeps = async (
    capability: CapabilityKey = 'questionnaires.create',
  ): Promise<AiDeps | null> => {
    const ctx = await host.vaultAndKey();
    if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, capability))) return null;
    const personId = await activePersonId();
    if (!personId) return null;
    return {
      fs: ctx.fs,
      key: ctx.key,
      client: host.claude,
      apiKey: await host.secrets.get(ANTHROPIC_API_KEY_ID),
      model: await host.activeModel(),
      personId,
      now: new Date(),
    };
  };

  return {
    // --- Platform-specific (forwarded to the host) ---
    getBootState: () => host.getBootState(),
    refreshBootState: () => host.refreshBootState(),
    selectVaultFolder: () => host.selectVaultFolder(),
    useVault: (path) => host.useVault(path),
    getConflicts: () => host.getConflicts(),
    revealVault: () => host.revealVault(),
    onVaultChanged: (listener) => host.onVaultChanged(listener),
    onChatChunk: (listener) => host.onChatChunk(listener),
    getAppVersion: () => Promise.resolve(host.appVersion),

    // --- Settings ---
    getSettings: async (): Promise<SettingsValues> => {
      const vaultDir = await host.vaultPath();
      const vault = vaultDir ? await readVaultSettingsValues(host.fileSystem(vaultDir)) : {};
      return { vault, device: await host.readDeviceSettings() };
    },
    setSetting: async (input): Promise<void> => {
      const { key, value, scope } = SetSettingSchema.parse(input);
      if (scope === 'device') {
        await host.writeDeviceSettings({ ...(await host.readDeviceSettings()), [key]: value });
        return;
      }
      const vaultDir = await host.vaultPath();
      if (!vaultDir) return;
      const fs = host.fileSystem(vaultDir);
      await writeVaultSettingsValues(fs, { ...(await readVaultSettingsValues(fs)), [key]: value });
    },
    resetSetting: async (input): Promise<void> => {
      const { key, scope } = ResetSettingSchema.parse(input);
      if (scope === 'device') {
        const values = { ...(await host.readDeviceSettings()) };
        delete values[key];
        await host.writeDeviceSettings(values);
        return;
      }
      const vaultDir = await host.vaultPath();
      if (!vaultDir) return;
      const fs = host.fileSystem(vaultDir);
      const values = { ...(await readVaultSettingsValues(fs)) };
      delete values[key];
      await writeVaultSettingsValues(fs, values);
    },

    // --- Secrets + Claude ---
    secretSet: async (input): Promise<void> => {
      const { id, value } = SecretSetSchema.parse(input);
      await host.secrets.set(id, value);
    },
    secretHas: async (input): Promise<boolean> => {
      return host.secrets.has(SecretIdSchema.parse(input).id);
    },
    secretClear: async (input): Promise<void> => {
      await host.secrets.clear(SecretIdSchema.parse(input).id);
    },
    claudeTest: async (): Promise<ClaudeTestResult> => {
      const apiKey = await host.secrets.get(ANTHROPIC_API_KEY_ID);
      return runConnectionTest(host.claude, apiKey, await host.activeModel());
    },

    // --- Household identity (10-multi-device-vault) ---
    householdStatus: async (): Promise<HouseholdStatus> => {
      const vaultDir = await host.vaultPath();
      const device = await host.readDeviceState();
      const pendingJoinPersonId = device.pendingJoinPersonId ?? null;
      const key = await loadMasterKey(host.secrets);
      if (!vaultDir) {
        return {
          vaultInitialized: false,
          hasMasterKey: key !== null,
          hasOwner: false,
          activePersonId: null,
          pendingJoinPersonId,
        };
      }
      const fs = host.fileSystem(vaultDir);
      const vaultInitialized = await isVaultInitialized(fs);
      if (!key) {
        return {
          vaultInitialized,
          hasMasterKey: false,
          hasOwner: false,
          activePersonId: null,
          pendingJoinPersonId,
        };
      }
      const access = await getAccessConfig(fs, key);
      const hasOwner = access.accounts.some((account) => account.roleId === OWNER_ROLE_ID);
      return {
        vaultInitialized,
        hasMasterKey: true,
        hasOwner,
        activePersonId: device.activePersonId ?? null,
        pendingJoinPersonId,
      };
    },
    householdSetup: async (input): Promise<{ recoveryPhrase: string; ownerId: string }> => {
      const { ownerName, passphrase, pin } = HouseholdSetupSchema.parse(input);
      const vaultDir = await host.vaultPath();
      if (!vaultDir) throw new Error('No vault selected');
      const fs = host.fileSystem(vaultDir);
      // Mint a key only for a genuinely fresh vault; createMasterKey is the hard backstop against
      // re-keying. The people-non-empty check guards a partially-synced vault whose recovery.enc went
      // missing (10-multi-device-vault §7 #9).
      let recoveryPhrase = '';
      if (!(await isVaultInitialized(fs))) {
        if ((await fs.list('people')).length > 0) throw new Error(VAULT_ALREADY_INITIALIZED);
        recoveryPhrase = (await createMasterKey(host.secrets, fs)).recoveryPhrase;
      }
      const key = await loadMasterKey(host.secrets);
      // Initialized vault but this device has no key → it must Unlock first, not run Setup.
      if (!key) throw new Error(VAULT_ALREADY_INITIALIZED);
      // Never add a second owner to an existing household.
      const access = await getAccessConfig(fs, key);
      if (access.accounts.some((account) => account.roleId === OWNER_ROLE_ID)) {
        throw new Error(VAULT_ALREADY_INITIALIZED);
      }
      const now = new Date().toISOString();
      const owner: Person = {
        id: uuid(),
        schemaVersion: 1,
        displayName: ownerName,
        isSubject: true,
        tags: [],
        createdAt: now,
        updatedAt: now,
      };
      await savePerson(fs, key, owner);
      await setAccount(fs, key, { personId: owner.id, roleId: OWNER_ROLE_ID, pin });
      await setSuperAdminPassphrase(fs, key, passphrase);
      await host.updateDeviceState({ activePersonId: owner.id });
      return { recoveryPhrase, ownerId: owner.id };
    },
    unlockWithRecoveryPhrase: async (input): Promise<{ ok: boolean }> => {
      // Join/recover this device: restore the master key from the recovery phrase (10-multi-device
      // §6.2). No owner is created. The phrase is never logged. Bad/garbled phrase → { ok: false }.
      const { phrase } = UnlockWithRecoveryPhraseSchema.parse(input);
      const vaultDir = await host.vaultPath();
      if (!vaultDir) return { ok: false };
      const ok = await restoreFromRecoveryPhrase(host.secrets, host.fileSystem(vaultDir), phrase);
      return { ok };
    },

    // --- People + relationships ---
    getActivePerson: async (): Promise<Person | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) return null;
      const id = await activePersonId();
      return id ? getPerson(ctx.fs, ctx.key, id) : null;
    },
    peopleList: async (): Promise<Person[]> => {
      const ctx = await host.vaultAndKey();
      return ctx ? listPeople(ctx.fs, ctx.key) : [];
    },
    peopleSave: async (input): Promise<Person> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) throw new Error('Household is not set up');
      return upsertPerson(ctx.fs, ctx.key, PersonInputSchema.parse(input));
    },
    peopleDelete: async (id): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) return;
      await deletePerson(ctx.fs, PersonIdSchema.parse(id));
    },
    relationshipsList: async (): Promise<Relationship[]> => {
      const ctx = await host.vaultAndKey();
      return ctx ? listRelationships(ctx.fs, ctx.key) : [];
    },
    relationshipsSave: async (input): Promise<Relationship> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) throw new Error('Household is not set up');
      return upsertRelationship(ctx.fs, ctx.key, RelationshipInputSchema.parse(input));
    },
    relationshipsDelete: async (id): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) return;
      await deleteRelationship(ctx.fs, PersonIdSchema.parse(id));
    },

    // --- Access (roles + accounts) ---
    accessGet: async (): Promise<AccessView> => {
      const ctx = await host.vaultAndKey();
      return ctx ? getAccessView(ctx.fs, ctx.key) : { roles: [], accounts: [] };
    },
    accessSaveRole: async (role): Promise<AccessView> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) throw new Error('Household is not set up');
      await saveRole(ctx.fs, ctx.key, RoleSchema.parse(role));
      return getAccessView(ctx.fs, ctx.key);
    },
    accessSetAccount: async (input): Promise<AccessView> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) throw new Error('Household is not set up');
      await setAccount(ctx.fs, ctx.key, SetAccountSchema.parse(input));
      return getAccessView(ctx.fs, ctx.key);
    },
    accessRemoveAccount: async (personId): Promise<AccessView> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) throw new Error('Household is not set up');
      await removeAccount(ctx.fs, ctx.key, PersonIdSchema.parse(personId));
      return getAccessView(ctx.fs, ctx.key);
    },

    // --- Device invites (10-multi-device-vault §5.4) — owner-only, member-scoped, enforced here ---
    invitesCreate: async (input): Promise<{ code: string; expiresAt: string }> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))) {
        throw new Error('Not permitted');
      }
      const { personId } = InvitePersonSchema.parse(input);
      // The target must be a real, NON-owner account — never wrap the master key in an invite bound to
      // the owner (10-multi-device-vault §5.4).
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
    invitesList: async (input): Promise<InviteSummary[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))) return [];
      const { personId } = InvitePersonSchema.parse(input);
      return listInvitesForPerson(ctx.fs, personId, Date.now());
    },
    invitesCancel: async (input): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))) return;
      await cancelInvite(ctx.fs, InviteIdSchema.parse(input).id);
    },
    invitesRedeem: async (input): Promise<{ ok: boolean; displayName?: string }> => {
      // Member redeem (no device key required yet — that's the point): unwrap the master key from the
      // invite and store it device-local, remembering who the invite is for (10-multi-device §5.4).
      const { code } = InviteCodeSchema.parse(input);
      const vaultDir = await host.vaultPath();
      if (!vaultDir) return { ok: false };
      const fs = host.fileSystem(vaultDir);
      const result = await redeemInvite(fs, code, Date.now());
      if (!result) return { ok: false };
      await storeMasterKey(host.secrets, result.masterKey);
      // Persist the pending join so a crash before completeJoin resumes the "Set your PIN" step on next
      // boot — never drop into an open picker with a PIN-less account (the key is now on this device).
      await host.updateDeviceState({ pendingJoinPersonId: result.personId });
      const person = await getPerson(fs, result.masterKey, result.personId);
      return { ok: true, ...(person ? { displayName: person.displayName } : {}) };
    },
    invitesCompleteJoin: async (input): Promise<{ ok: boolean }> => {
      // Finish joining: set the freshly-redeemed member's OWN PIN and sign them in. Only the person the
      // redeem resolved (persisted device-local) can be completed — never the owner.
      const { pin } = CompleteJoinSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = (await host.readDeviceState()).pendingJoinPersonId ?? null;
      if (!ctx || !personId) return { ok: false };
      const account = (await getAccessConfig(ctx.fs, ctx.key)).accounts.find(
        (candidate) => candidate.personId === personId,
      );
      if (!account || account.roleId === OWNER_ROLE_ID) return { ok: false };
      await setAccount(ctx.fs, ctx.key, { personId, roleId: account.roleId, pin });
      await host.updateDeviceState({ activePersonId: personId, pendingJoinPersonId: null });
      return { ok: true };
    },

    // --- Session + super-admin ---
    sessionSetActive: async (input): Promise<SetActiveResult> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) return { ok: false, reason: 'NO_ACCOUNT' };
      const { personId, pin } = SetActiveSchema.parse(input);
      const person = await getPerson(ctx.fs, ctx.key, personId);
      if (!person) return { ok: false, reason: 'NO_ACCOUNT' };
      if (!(await verifyAccountPin(ctx.fs, ctx.key, personId, pin ?? ''))) {
        return { ok: false, reason: 'WRONG_PIN' };
      }
      await host.updateDeviceState({ activePersonId: personId });
      return { ok: true, person };
    },
    superadminUnlock: async (input): Promise<boolean> => {
      const { passphrase } = PassphraseSchema.parse(input);
      // The super-admin secret lives in the vault (10-multi-device-vault §6.4). Verify against it,
      // migrating a legacy device-local hash on first use. Requires the vault to be unlocked.
      const ctx = await host.vaultAndKey();
      if (!ctx) return false;
      if (!(await hasSuperAdminPassphrase(ctx.fs))) {
        const legacy = (await host.readDeviceState()).superAdminPassphraseHash;
        if (legacy) await storeSuperAdminHash(ctx.fs, ctx.key, legacy);
      }
      const ok = await verifySuperAdminPassphrase(ctx.fs, ctx.key, passphrase);
      if (ok) host.setSuperAdminActive(true);
      return ok;
    },
    superadminLock: (): Promise<void> => {
      host.setSuperAdminActive(false);
      return Promise.resolve();
    },

    // --- Usage + budgets (06-ai-usage-and-budgets) ---
    usageSummary: async (input): Promise<UsageSummary> => {
      const { scope, period, personId } = UsageSummarySchema.parse(input);
      const ctx = await host.vaultAndKey();
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
      const self = await activePersonId();
      if (!self) return summarize([]);
      return summarize(await queryUsage(ctx.fs, ctx.key, { from, to, personId: self }));
    },
    budgetGet: async (): Promise<{ app: Budget | null; person: Budget | null }> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) return { app: null, person: null };
      const budgets = await getBudgets(ctx.fs, ctx.key);
      const personId = await activePersonId();
      return {
        app: budgets.app ?? null,
        person: personId ? await effectivePersonBudget(ctx.fs, ctx.key, personId) : null,
      };
    },
    budgetGetPerson: async (personId): Promise<Budget> => {
      const id = PersonIdSchema.parse(personId);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'budgets.manage'))) {
        return DEFAULT_BUDGET;
      }
      return effectivePersonBudget(ctx.fs, ctx.key, id);
    },
    budgetSetApp: async (budget): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'budgets.manage'))) return;
      await setAppBudget(ctx.fs, ctx.key, budget === null ? null : BudgetSchema.parse(budget));
    },
    budgetSetPerson: async (input): Promise<void> => {
      const { personId, budget } = BudgetSetPersonSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'budgets.manage'))) return;
      await setPersonBudget(ctx.fs, ctx.key, personId, budget);
    },
    budgetStatus: async (): Promise<{ person: BudgetState; app: BudgetState }> => {
      const none: BudgetState = { state: 'none', spentUsd: 0, limitUsd: null, period: null };
      const ctx = await host.vaultAndKey();
      if (!ctx) return { person: none, app: none };
      const now = new Date();
      const personId = await activePersonId();
      const person = personId
        ? await checkBudget(ctx.fs, ctx.key, { scope: 'person', personId, now })
        : none;
      const app = await checkBudget(ctx.fs, ctx.key, { scope: 'app', now });
      return { person, app };
    },

    // --- Conversations + chat (05-conversations) ---
    conversationsList: async (): Promise<ConversationMeta[]> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId) return [];
      return (await listConversations(ctx.fs, ctx.key, personId)).map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
      }));
    },
    conversationsGet: async (id): Promise<Conversation | null> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId) return null;
      return getConversation(ctx.fs, ctx.key, personId, PersonIdSchema.parse(id));
    },
    conversationsRename: async (input): Promise<void> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId) return;
      const { id, title } = RenameSchema.parse(input);
      const conversation = await getConversation(ctx.fs, ctx.key, personId, id);
      if (!conversation) return;
      await saveConversation(ctx.fs, ctx.key, {
        ...conversation,
        title,
        updatedAt: new Date().toISOString(),
      });
    },
    conversationsDelete: async (id): Promise<void> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId) return;
      await deleteConversation(ctx.fs, personId, PersonIdSchema.parse(id));
    },
    chatStream: async (input): Promise<ChatTurnResult> => {
      const { conversationId, userText } = ChatStreamSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      const apiKey = await host.secrets.get(ANTHROPIC_API_KEY_ID);
      return runChatTurn({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        conversationId,
        userText,
        onDelta: (text) => host.emitChatChunk(text),
        now: new Date(),
      });
    },

    // --- Questionnaires (08-questionnaires) — gated by `questionnaires.create` ---
    questionnairesList: async (): Promise<Questionnaire[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return [];
      return listQuestionnaires(ctx.fs, ctx.key);
    },
    questionnairesGet: async (id): Promise<Questionnaire | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return null;
      return getQuestionnaire(ctx.fs, ctx.key, PersonIdSchema.parse(id));
    },
    questionnairesSave: async (input): Promise<Questionnaire> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) {
        throw new Error('Not permitted');
      }
      return saveQuestionnaire(ctx.fs, ctx.key, QuestionnaireInputSchema.parse(input));
    },
    questionnairesDelete: async (id): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return;
      await deleteQuestionnaire(ctx.fs, PersonIdSchema.parse(id));
    },
    questionnairesValidate: async (input): Promise<string[]> => {
      // Pure pre-flight check — exposes nothing sensitive, so no vault/capability gate.
      return validateQuestionnaire(QuestionnaireInputSchema.parse(input));
    },
    questionnairesListTypes: async (): Promise<string[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return [];
      return listCustomTypes(ctx.fs);
    },
    questionnairesAddType: async (name): Promise<string[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) {
        throw new Error('Not permitted');
      }
      return addCustomType(ctx.fs, z.string().parse(name));
    },
    questionnairesStoreImage: async (input): Promise<{ imagePath: string; mime: string }> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) {
        throw new Error('Not permitted');
      }
      const { base64, mime } = StoreImageSchema.parse(input);
      if (!isAllowedImageMime(mime)) throw new Error('Unsupported image type');
      const bytes = fromBase64(base64);
      // Re-validate the size in main (the renderer's check isn't the trust boundary).
      if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error('Image too large');
      const imagePath = await storeQuestionnaireImage(ctx.fs, ctx.key, bytes);
      return { imagePath, mime };
    },
    questionnairesGetImage: async (imagePath): Promise<string | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return null;
      const bytes = await getQuestionnaireImage(ctx.fs, ctx.key, z.string().parse(imagePath));
      return bytes ? toBase64(bytes) : null;
    },
    questionnairesDeleteImage: async (imagePath): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return;
      await deleteQuestionnaireImage(ctx.fs, z.string().parse(imagePath));
    },
    questionnairesGenerate: async (input): Promise<QuestionnaireGenerateResult> => {
      const deps = await aiDeps();
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      const p = GenerateSchema.parse(input);
      return generateQuestions(deps, {
        type: p.type,
        sensitivity: p.sensitivity,
        ...(p.brief !== undefined ? { brief: p.brief } : {}),
        context: {
          authorPersonId: deps.personId,
          includeAuthor: p.includeAuthor,
          ...(p.targetPersonId !== undefined ? { targetPersonId: p.targetPersonId } : {}),
          includeTarget: p.includeTarget,
          includeRelationship: p.includeRelationship,
        },
        existingPrompts: p.existingPrompts,
      });
    },
    questionnairesImproveQuestion: async (input): Promise<QuestionnaireImproveResult> => {
      const deps = await aiDeps();
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      return improveQuestion(deps, ImproveSchema.parse(input));
    },
    gapfinderSuggest: async (input): Promise<QuestionnaireSuggestResult> => {
      const deps = await aiDeps();
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      const { targetPersonId } = SuggestSchema.parse(input);
      return suggestQuestionnaires(deps, targetPersonId !== undefined ? { targetPersonId } : {});
    },

    // --- Insights / analysis (08-questionnaires §13.4) — gated by `questionnaires.viewResults` ---
    insightsList: async (): Promise<Insight[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults')))
        return [];
      return listAllInsights(ctx.fs, ctx.key);
    },
    insightsAnalyze: async (input): Promise<QuestionnaireAnalyzeResult> => {
      const deps = await aiDeps('questionnaires.viewResults');
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      return analyzeAssignment(deps, AnalyzeSchema.parse(input));
    },
    insightsApprove: async (input): Promise<Insight | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults')))
        return null;
      const p = InsightEditSchema.parse(input);
      return updateInsight(ctx.fs, ctx.key, p.subjectPersonId, p.id, {
        approved: true,
        ...(p.summary !== undefined ? { summary: p.summary } : {}),
        ...(p.facts !== undefined ? { facts: p.facts } : {}),
      });
    },
    insightsUpdate: async (input): Promise<Insight | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults')))
        return null;
      const p = InsightEditSchema.parse(input);
      return updateInsight(ctx.fs, ctx.key, p.subjectPersonId, p.id, {
        ...(p.summary !== undefined ? { summary: p.summary } : {}),
        ...(p.facts !== undefined ? { facts: p.facts } : {}),
      });
    },
    insightsDelete: async (input): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults'))) return;
      const { subjectPersonId, id } = InsightIdSchema.parse(input);
      await deleteInsight(ctx.fs, subjectPersonId, id);
    },
    assignmentsCreate: async (input): Promise<Assignment> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) {
        throw new Error('Not permitted');
      }
      const personId = await activePersonId();
      if (!personId) throw new Error('No active person');
      const { questionnaireId, recipientPersonId, privacy, senderVisibleToRecipient, expiresAt } =
        AssignmentsCreateSchema.parse(input);
      // The recipient must be a real household person, so we never persist a dangling, unanswerable
      // send (a self-send is allowed — self check-ins are a valid use). Mirrors invitesCreate's lookup.
      if (!(await getPerson(ctx.fs, ctx.key, recipientPersonId))) {
        throw new Error('Recipient not found');
      }
      // In-app/household send only for now; the external relay channel lands with the delivery slice.
      return createAssignment(ctx.fs, ctx.key, {
        questionnaireId,
        senderPersonId: personId,
        recipient: { kind: 'person' as const, personId: recipientPersonId },
        channel: 'inApp',
        privacy: privacy ?? 'standard',
        senderVisibleToRecipient: senderVisibleToRecipient ?? true,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      });
    },

    // --- UI state (device-local) ---
    getSidebarCollapsed: async (): Promise<boolean> => {
      return (await host.readDeviceState()).sidebarCollapsed ?? false;
    },
    setSidebarCollapsed: async (collapsed): Promise<void> => {
      await host.updateDeviceState({ sidebarCollapsed: z.boolean().parse(collapsed) });
    },
  };
}

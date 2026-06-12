import { z } from 'zod';
import {
  ANTHROPIC_API_KEY_ID,
  MIN_OWNER_PIN_LENGTH,
  type AccessView,
  type BudgetState,
  type ChatTurnResult,
  type ClaudeTestResult,
  type ConversationMeta,
  type DreamApproveResult,
  type DreamNarrativeResult,
  type DreamShareResult,
  type DreamSynthesisResult,
  type HouseholdStatus,
  type InviteSummary,
  type SelfosBridge,
  type SetActiveResult,
  type SettingsValues,
  type UsageSummary,
} from './channels';
import {
  AnswerSchema,
  AnswerTypeSchema,
  BudgetSchema,
  DreamAnalysisEditsSchema,
  DreamInputSchema,
  PersonInputSchema,
  QuestionnaireInputSchema,
  RelationshipInputSchema,
  RoleSchema,
  SensitivityTierSchema,
  SettingsFileSchema,
  type AlignmentResult,
  type Assignment,
  type CompatibilityGroup,
  type CompatibilityMember,
  type CompatibilitySendResult,
  type CompatibilityVisibility,
  type InboxAssignmentDetail,
  type InboxCompatibilityView,
  type InboxItem,
  type Insight,
  type Question,
  type QuestionTrend,
  type RawAccessAuditEntry,
  type SendAnswer,
  type SendResult,
  type QuestionnaireAnalyzeResult,
  type QuestionnaireGenerateResult,
  type QuestionnaireImproveResult,
  type QuestionnaireSuggestResult,
  type BootState,
  type Budget,
  type Conversation,
  type DeviceState,
  type Dream,
  type DreamAnalysis,
  type DreamPatternStats,
  type DreamPatternSummary,
  type DreamPatternWindow,
  type DreamShareTarget,
  type Person,
  type Questionnaire,
  type Relationship,
  type RelayConfig,
  type RelayStatus,
} from './schemas';
import { OWNER_ROLE_ID, roleAllows, type CapabilityKey } from './capabilities';
import { runConnectionTest } from './claudeProxy';
import {
  deployRelay,
  teardownRelay,
  updateRelay,
  type FetchLike,
  type RelayBundle,
} from './relay/cloudflareDeployer';
import { createRelayHttpClient } from './relay/relayHttpClient';
import {
  clearRelayConfig,
  readRelayConfig,
  relayStatusOf,
  writeRelayConfig,
} from './relay/relayConfig';
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
import {
  deleteInsight,
  listAllInsights,
  listInsightsForPerson,
  updateInsight,
} from '@selfos/core/insights';
import {
  addCustomType,
  analyzeAssignment,
  appendAuditEntry,
  buildQuestionTrends,
  createAssignment,
  createCompatibilitySend,
  declineAssignment,
  deleteQuestionnaireImage,
  deleteSend,
  formatAnswerForDisplay,
  formatResponseAnswers,
  generateAlignment,
  generateVariant,
  getAlignmentReport,
  getCompatibilityGroup,
  hasSends,
  createRelaySend,
  drainRelaySend,
  externalSendDisclosure,
  garbageCollectImages,
  generateQuestions,
  getAssignment,
  getAssignmentSnapshot,
  getQuestionnaire,
  getQuestionnaireImage,
  getResponse,
  improveQuestion,
  isAllowedImageMime,
  listAuditEntries,
  isAnswerable,
  listAssignments,
  listCustomTypes,
  listQuestionnaires,
  MAX_IMAGE_BYTES,
  openAssignment,
  purgeQuestionnaire,
  revokeRelayForDeletion,
  revokeRelaySend,
  saveProgress,
  saveQuestionnaire,
  storeQuestionnaireImage,
  submitResponse,
  suggestQuestionnaires,
  validateQuestionnaire,
  type AiDeps,
  type TrendSend,
} from '@selfos/core/questionnaires';
import {
  approveAnalysis,
  approvePatternNarrative,
  generatePatternNarrative,
  getAnalysis,
  getDream,
  getDreamConversation,
  getDreamInsight,
  getPatternStats,
  getPatternSummary,
  listDreams,
  listDreamShareTargets,
  purgeDream,
  removeFromContext,
  removePatternNarrativeFromContext,
  runAnalysisTurn,
  saveDream,
  setDreamFactShare,
  synthesizeAnalysis,
  updateAnalysis,
} from '@selfos/core/dreams';
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

  // --- Relay (external delivery, 08-questionnaires §5.2/§5.4) ---
  /** Relay host surface: outbound `fetch` (Cloudflare REST + Worker) + the built Worker bundle to deploy. */
  relay: {
    fetch: FetchLike;
    /** The built relay Worker (`apps/relay/dist/worker.js`) + its version, read host-side. */
    loadBundle(): Promise<RelayBundle>;
    /** The app's current bundled relay version (drives the "update available" check). */
    currentVersion: string;
  };

  // --- Streaming sink ---
  /** Deliver a chat reply chunk to the renderer (Electron → IPC event; iOS → in-webview listener). */
  emitChatChunk(chunk: string): void;
  /** Deliver a dream-analysis reply chunk to the renderer (separate channel from chat). */
  emitDreamChunk(chunk: string): void;

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
  /** Subscribe to streamed dream-analysis chunks; the counterpart to `emitDreamChunk`. */
  onDreamChunk(listener: (delta: string) => void): () => void;
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
const DreamAnalyzeTurnSchema = z.object({
  dreamId: z.string().min(1),
  userText: z.string().min(1),
});
const DreamIdSchema = z.object({ dreamId: z.string().min(1) });
const DreamUpdateAnalysisSchema = z.object({
  dreamId: z.string().min(1),
  edits: DreamAnalysisEditsSchema,
});
const DreamPatternWindowSchema = z.object({ window: z.enum(['30d', '90d', 'all']) });
const DreamSetFactShareSchema = z.object({
  dreamId: z.string().min(1),
  factId: z.string().min(1),
  withPersonId: z.string().min(1),
  share: z.boolean(),
});

/** A zeroed stats object — returned to a denied/unready `dreamPatternStats` caller (a read, never throws). */
function emptyPatternStats(window: DreamPatternWindow): DreamPatternStats {
  return {
    window,
    dreamCount: 0,
    analyzedCount: 0,
    symbols: [],
    themes: [],
    people: [],
    emotions: [],
    lucidCount: 0,
    nightmareCount: 0,
    moodTrend: [],
    vividnessTrend: [],
    nightmareNudge: false,
  };
}
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
const CreateRelayLinkSchema = z.object({
  questionnaireId: z.string().min(1),
  recipient: z.object({
    kind: z.literal('external'),
    displayName: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
  }),
  privacy: z.enum(['standard', 'private']).optional(),
  senderVisibleToRecipient: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
});
const RelayConnectSchema = z.object({
  apiToken: z.string().min(1),
  accountId: z.string().min(1),
});
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
const AssignmentIdSchema = z.string().min(1);
const QuestionnaireIdSchema = z.string().min(1);
const AnswersSchema = z.object({
  assignmentId: z.string().min(1),
  answers: z.array(AnswerSchema),
});
const DeclineSchema = z.object({
  assignmentId: z.string().min(1),
  note: z.string().optional(),
});
const CompatibilityCreateSchema = z.object({
  questionnaireId: z.string().min(1),
  recipientPersonIdA: z.string().min(1),
  recipientPersonIdB: z.string().min(1),
});
const GroupIdSchema = z.string().min(1);

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

  /**
   * Best-effort revoke of the relay links for the sends matching `predicate`, before a deletion purges
   * them (§3.9). No-op if no relay is configured; a relay that's unreachable doesn't block the delete —
   * the mailbox expires on its own (§11.3).
   */
  const revokeRelayLinks = async (
    fs: FileSystem,
    key: Uint8Array,
    predicate: (assignment: Assignment) => boolean,
  ): Promise<void> => {
    const config = await readRelayConfig(fs, key);
    if (!config) return;
    const client = createRelayHttpClient(config.endpointUrl, config.drainSecret, host.relay.fetch);
    for (const assignment of await listAssignments(fs, key, {})) {
      if (assignment.relay && predicate(assignment)) {
        await revokeRelayForDeletion(fs, key, client, assignment.id);
      }
    }
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

  /** The sender's display name for the recipient — null when the send is anonymous (§3.2). */
  const senderNameFor = async (
    fs: FileSystem,
    key: Uint8Array,
    assignment: Assignment,
  ): Promise<string | null> => {
    if (!assignment.senderVisibleToRecipient) return null;
    const sender = await getPerson(fs, key, assignment.senderPersonId);
    return sender?.displayName ?? null;
  };

  /** A send's recipient display name (person → their name; external → its displayName or "External"). */
  const recipientDisplayName = async (
    fs: FileSystem,
    key: Uint8Array,
    assignment: Assignment,
  ): Promise<string> =>
    assignment.recipient.kind === 'person'
      ? ((await getPerson(fs, key, assignment.recipient.personId))?.displayName ?? 'Unknown')
      : (assignment.recipient.displayName ?? 'External');

  /**
   * Resolve an assignment the active person is **allowed to answer** — they hold `questionnaires.answer`
   * AND are the in-app person recipient. Returns null otherwise, so a non-recipient can never read or
   * mutate someone else's send. The renderer isn't the trust boundary; this enforcement lives here.
   */
  const recipientAssignment = async (
    assignmentId: string,
  ): Promise<{ fs: FileSystem; key: Uint8Array; assignment: Assignment } | null> => {
    const ctx = await host.vaultAndKey();
    if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.answer'))) return null;
    const personId = await activePersonId();
    if (!personId) return null;
    const assignment = await getAssignment(ctx.fs, ctx.key, assignmentId);
    if (
      !assignment ||
      assignment.recipient.kind !== 'person' ||
      assignment.recipient.personId !== personId
    ) {
      return null;
    }
    return { fs: ctx.fs, key: ctx.key, assignment };
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
    onDreamChunk: (listener) => host.onDreamChunk(listener),
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
      const personId = await activePersonId();
      const parsed = QuestionnaireInputSchema.parse(input);
      // Detect images dropped by this edit BEFORE saving, so the now-orphaned media gets reaped (the
      // builder's "remove" only clears the draft — §13.2 — leaving the encrypted file for GC).
      const before = parsed.id ? await getQuestionnaire(ctx.fs, ctx.key, parsed.id) : null;
      // Stamp the creator (main-side, never the renderer) so deletion can enforce "creator-only" rules.
      const saved = await saveQuestionnaire(ctx.fs, ctx.key, parsed, personId ?? undefined);
      if (before) {
        const after = new Set(saved.questions.flatMap((q) => (q.media ? [q.media.imagePath] : [])));
        const removedAnImage = before.questions.some(
          (q) => q.media && !after.has(q.media.imagePath),
        );
        if (removedAnImage) await garbageCollectImages(ctx.fs, ctx.key);
      }
      return saved;
    },
    questionnairesDelete: async (id): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return;
      const questionnaireId = QuestionnaireIdSchema.parse(id);
      // Owner / super-admin (people.manage) purge a questionnaire + everything downstream at any stage
      // (§3.9). A non-owner creator may delete their OWN questionnaire only while it is still unsent.
      if (await activePersonCan(ctx.fs, ctx.key, 'people.manage')) {
        await revokeRelayLinks(ctx.fs, ctx.key, (a) => a.questionnaireId === questionnaireId);
        await purgeQuestionnaire(ctx.fs, ctx.key, questionnaireId);
        return;
      }
      const questionnaire = await getQuestionnaire(ctx.fs, ctx.key, questionnaireId);
      if (!questionnaire) return;
      const personId = await activePersonId();
      if (
        questionnaire.creatorPersonId !== personId ||
        (await hasSends(ctx.fs, ctx.key, questionnaireId))
      ) {
        throw new Error('Not permitted');
      }
      // A creator-only delete is unsent (no sends), but revoke any preview relay link to be safe.
      await revokeRelayLinks(ctx.fs, ctx.key, (a) => a.questionnaireId === questionnaireId);
      await purgeQuestionnaire(ctx.fs, ctx.key, questionnaireId);
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

    // --- Inbox / answering (08-questionnaires §13.5) — gated by `questionnaires.answer` + recipient-scoped ---
    assignmentsInbox: async (): Promise<InboxItem[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.answer'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      const assignments = await listAssignments(ctx.fs, ctx.key, { recipientPersonId: personId });
      const items: InboxItem[] = [];
      for (const a of assignments) {
        const snapshot = await getAssignmentSnapshot(ctx.fs, ctx.key, a.id);
        if (!snapshot) continue; // a half-written send with no snapshot is unanswerable — skip it
        const draft = await getResponse(ctx.fs, ctx.key, a.id);
        items.push({
          assignmentId: a.id,
          title: snapshot.title,
          questionCount: snapshot.questions.length,
          status: a.status,
          privacy: a.privacy,
          senderName: await senderNameFor(ctx.fs, ctx.key, a),
          createdAt: a.createdAt,
          answerable: isAnswerable(a.status),
          hasDraft: Boolean(draft && draft.submittedAt === undefined),
        });
      }
      return items;
    },
    assignmentsGet: async (assignmentId): Promise<InboxAssignmentDetail | null> => {
      const resolved = await recipientAssignment(AssignmentIdSchema.parse(assignmentId));
      if (!resolved) return null;
      const { fs, key, assignment } = resolved;
      const snapshot = await getAssignmentSnapshot(fs, key, assignment.id);
      if (!snapshot) return null;
      const draft = await getResponse(fs, key, assignment.id);
      // For a compatibility send, surface the answerer's joint-report view per the visibility mode: the
      // shared report (once the sender generates it) for everyone, plus their OWN answers for eachSeesOwn.
      let compatibility: InboxCompatibilityView | undefined;
      if (snapshot.compatibility?.enabled && assignment.compatibilityGroupId) {
        const visibility = snapshot.compatibility.visibility;
        const report = await getAlignmentReport(fs, key, assignment.compatibilityGroupId);
        const submitted = draft && draft.submittedAt !== undefined ? draft : null;
        const ownAnswers =
          visibility === 'eachSeesOwn' && submitted
            ? formatResponseAnswers(snapshot.questions, submitted.answers)
            : undefined;
        compatibility = {
          visibility,
          report,
          ...(ownAnswers ? { ownAnswers } : {}),
        };
      }
      return {
        assignmentId: assignment.id,
        questionnaire: snapshot,
        status: assignment.status,
        privacy: assignment.privacy,
        senderName: await senderNameFor(fs, key, assignment),
        answers: draft?.answers ?? [],
        answerable: isAnswerable(assignment.status),
        ...(compatibility ? { compatibility } : {}),
      };
    },
    assignmentsOpen: async (assignmentId): Promise<void> => {
      // Best-effort status nudge (sent → opened); a non-recipient simply no-ops here rather than
      // throwing like the answer mutations, since opening reveals nothing and isn't user-initiated.
      const resolved = await recipientAssignment(AssignmentIdSchema.parse(assignmentId));
      if (!resolved) return;
      await openAssignment(resolved.fs, resolved.key, resolved.assignment.id);
    },
    assignmentsSaveProgress: async (input): Promise<void> => {
      const { assignmentId, answers } = AnswersSchema.parse(input);
      const resolved = await recipientAssignment(assignmentId);
      if (!resolved) throw new Error('Not permitted');
      await saveProgress(resolved.fs, resolved.key, { assignmentId, answers });
    },
    assignmentsSubmit: async (input): Promise<void> => {
      const { assignmentId, answers } = AnswersSchema.parse(input);
      const resolved = await recipientAssignment(assignmentId);
      if (!resolved) throw new Error('Not permitted');
      await submitResponse(resolved.fs, resolved.key, { assignmentId, answers });
    },
    assignmentsDecline: async (input): Promise<void> => {
      const { assignmentId, note } = DeclineSchema.parse(input);
      const resolved = await recipientAssignment(assignmentId);
      if (!resolved) throw new Error('Not permitted');
      await declineAssignment(resolved.fs, resolved.key, {
        assignmentId,
        ...(note !== undefined ? { note } : {}),
      });
    },
    assignmentsResults: async (questionnaireId): Promise<SendResult[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults')))
        return [];
      const personId = await activePersonId();
      if (!personId) return [];
      const qid = QuestionnaireIdSchema.parse(questionnaireId);
      // The active person's own sends of this questionnaire (Results is sender-scoped, newest first).
      const sends = (await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId })).filter(
        (a) => a.questionnaireId === qid,
      );
      const analyzed = new Set(
        (await listInsightsForPerson(ctx.fs, ctx.key, personId)).flatMap((i) =>
          i.provenance.assignmentId ? [i.provenance.assignmentId] : [],
        ),
      );
      const results: SendResult[] = [];
      for (const a of sends) {
        const recipientName =
          a.recipient.kind === 'person'
            ? ((await getPerson(ctx.fs, ctx.key, a.recipient.personId))?.displayName ?? 'Unknown')
            : (a.recipient.displayName ?? 'External');
        // Privacy boundary: only a Standard, submitted send exposes the raw answers to the sender.
        let answers: SendAnswer[] | undefined;
        if (a.privacy === 'standard' && a.status === 'submitted') {
          const snapshot = await getAssignmentSnapshot(ctx.fs, ctx.key, a.id);
          const response = await getResponse(ctx.fs, ctx.key, a.id);
          if (snapshot && response) {
            const byId = new Map(response.answers.map((ans) => [ans.questionId, ans.value]));
            answers = snapshot.questions.map((q) => ({
              prompt: q.prompt,
              answer: formatAnswerForDisplay(q, byId.get(q.id)),
            }));
          }
        }
        results.push({
          assignmentId: a.id,
          recipientName,
          channel: a.channel,
          status: a.status,
          privacy: a.privacy,
          createdAt: a.createdAt,
          analyzed: analyzed.has(a.id),
          ...(a.status === 'submitted' ? { submittedAt: a.updatedAt } : {}),
          ...(a.declineNote !== undefined ? { declineNote: a.declineNote } : {}),
          ...(answers ? { answers } : {}),
        });
      }
      return results;
    },
    assignmentsDelete: async (assignmentId): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults'))) return;
      const id = AssignmentIdSchema.parse(assignmentId);
      const assignment = await getAssignment(ctx.fs, ctx.key, id);
      if (!assignment) return;
      // Only the send's own sender (or an Owner / super-admin) may delete it + its derived Insight.
      const personId = await activePersonId();
      if (
        assignment.senderPersonId !== personId &&
        !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))
      ) {
        throw new Error('Not permitted');
      }
      if (assignment.relay) await revokeRelayLinks(ctx.fs, ctx.key, (a) => a.id === id);
      await deleteSend(ctx.fs, ctx.key, id);
    },
    assignmentsTrends: async (questionnaireId): Promise<QuestionTrend[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults')))
        return [];
      const personId = await activePersonId();
      if (!personId) return [];
      const qid = QuestionnaireIdSchema.parse(questionnaireId);
      // Trends span every SUBMITTED send of this questionnaire by the active person — Standard AND
      // Private (the Private disclosure is worded to allow this, §3.2). Numbers, never the prose answers.
      const sends = (await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId })).filter(
        (a) => a.questionnaireId === qid && a.status === 'submitted',
      );
      const trendSends: TrendSend[] = [];
      for (const a of sends) {
        const snapshot = await getAssignmentSnapshot(ctx.fs, ctx.key, a.id);
        const response = await getResponse(ctx.fs, ctx.key, a.id);
        if (!snapshot || !response) continue;
        const recipientName =
          a.recipient.kind === 'person'
            ? ((await getPerson(ctx.fs, ctx.key, a.recipient.personId))?.displayName ?? 'Unknown')
            : (a.recipient.displayName ?? 'External');
        trendSends.push({
          submittedAt: a.updatedAt,
          recipientName,
          questions: snapshot.questions,
          answers: response.answers,
        });
      }
      return buildQuestionTrends(trendSends);
    },

    // --- Compatibility (08-questionnaires §3.6/§13.5d) ---
    assignmentsCreateCompatibility: async (input): Promise<CompatibilitySendResult> => {
      const deps = await aiDeps('questionnaires.create');
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      const { questionnaireId, recipientPersonIdA, recipientPersonIdB } =
        CompatibilityCreateSchema.parse(input);
      if (recipientPersonIdA === recipientPersonIdB) {
        return { ok: false, reason: 'INVALID', message: 'Choose two different people.' };
      }
      if (recipientPersonIdA === deps.personId || recipientPersonIdB === deps.personId) {
        return {
          ok: false,
          reason: 'INVALID',
          message: 'Send a compatibility check to two other people.',
        };
      }
      const canonical = await getQuestionnaire(deps.fs, deps.key, questionnaireId);
      if (!canonical?.compatibility?.enabled) {
        return {
          ok: false,
          reason: 'INVALID',
          message: 'This isn’t a compatibility questionnaire.',
        };
      }
      const recipients = [recipientPersonIdA, recipientPersonIdB];
      const people = await Promise.all(recipients.map((id) => getPerson(deps.fs, deps.key, id)));
      if (people.some((p) => !p)) {
        return { ok: false, reason: 'INVALID', message: 'A chosen recipient no longer exists.' };
      }
      // Personalize a variant per recipient (target = shareable facts only — the §13.3 boundary).
      const variants: { personId: string; questions: Question[] }[] = [];
      for (let i = 0; i < recipients.length; i++) {
        const recipientId = recipients[i] as string;
        const result = await generateVariant(deps, {
          forName: people[i]?.displayName ?? 'them',
          questions: canonical.questions,
          targetContext: {
            authorPersonId: deps.personId,
            includeAuthor: false,
            targetPersonId: recipientId,
            includeTarget: true,
            includeRelationship: true,
          },
        });
        if (!result.ok || !result.questions) {
          return {
            ok: false,
            reason: result.reason ?? 'ERROR',
            message: result.message ?? 'Could not personalize.',
          };
        }
        variants.push({ personId: recipientId, questions: result.questions });
      }
      const [a, b] = variants;
      if (!a || !b) return { ok: false, reason: 'ERROR', message: 'Could not personalize.' };
      const compatibilityGroupId = await createCompatibilitySend(deps.fs, deps.key, {
        questionnaireId,
        senderPersonId: deps.personId,
        visibility: canonical.compatibility.visibility,
        recipients: [a, b],
      });
      return { ok: true, compatibilityGroupId };
    },
    assignmentsCompatibility: async (questionnaireId): Promise<CompatibilityGroup[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults')))
        return [];
      const personId = await activePersonId();
      if (!personId) return [];
      const qid = QuestionnaireIdSchema.parse(questionnaireId);
      const canReveal = await activePersonCan(ctx.fs, ctx.key, 'questionnaires.readRaw');
      // The active person's own compatibility sends of this questionnaire, grouped by their shared id.
      const sends = (await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId })).filter(
        (a) => a.questionnaireId === qid && a.compatibilityGroupId,
      );
      const insightGroups = new Set(
        (await listInsightsForPerson(ctx.fs, ctx.key, personId)).flatMap((i) =>
          i.provenance.compatibilityGroupId ? [i.provenance.compatibilityGroupId] : [],
        ),
      );
      const byGroup = new Map<string, Assignment[]>();
      for (const a of sends) {
        const gid = a.compatibilityGroupId as string;
        byGroup.set(gid, [...(byGroup.get(gid) ?? []), a]);
      }
      const groups: CompatibilityGroup[] = [];
      for (const [groupId, members] of byGroup) {
        const memberViews: CompatibilityMember[] = [];
        for (const a of members) {
          memberViews.push({
            assignmentId: a.id,
            recipientName: await recipientDisplayName(ctx.fs, ctx.key, a),
            status: a.status,
            ...(a.status === 'submitted' ? { submittedAt: a.updatedAt } : {}),
          });
        }
        const bothSubmitted = members.length >= 2 && members.every((a) => a.status === 'submitted');
        const first = members[0];
        const snapshot = first ? await getAssignmentSnapshot(ctx.fs, ctx.key, first.id) : null;
        const visibility: CompatibilityVisibility =
          snapshot?.compatibility?.visibility ?? 'sharedReport';
        groups.push({
          compatibilityGroupId: groupId,
          questionnaireId: qid,
          visibility,
          members: memberViews,
          bothSubmitted,
          report: await getAlignmentReport(ctx.fs, ctx.key, groupId),
          analyzed: insightGroups.has(groupId),
          canReveal: visibility === 'senderSeesAll' && canReveal,
        });
      }
      return groups;
    },
    assignmentsAlign: async (compatibilityGroupId): Promise<AlignmentResult> => {
      const deps = await aiDeps('questionnaires.viewResults');
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      const groupId = GroupIdSchema.parse(compatibilityGroupId);
      // Sender-scoped: only the person who sent the group may align it.
      const group = await getCompatibilityGroup(deps.fs, deps.key, groupId);
      if (group.length === 0 || group.some((a) => a.senderPersonId !== deps.personId)) {
        return { ok: false, reason: 'DENIED', message: 'Not available.' };
      }
      return generateAlignment(deps, { compatibilityGroupId: groupId });
    },
    assignmentsRevealRaw: async (assignmentId): Promise<SendAnswer[] | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) return null;
      const id = AssignmentIdSchema.parse(assignmentId);
      const assignment = await getAssignment(ctx.fs, ctx.key, id);
      if (!assignment) return null;
      const personId = await activePersonId();
      const viaSuperAdmin = host.isSuperAdminActive();
      // Read the snapshot once (server-side — the renderer can't spoof the visibility) for both the gate
      // and the answer formatting.
      const snapshot = await getAssignmentSnapshot(ctx.fs, ctx.key, assignment.id);
      // Who may reveal raw answers: the concealed super-admin (any send), OR the sender of a
      // `senderSeesAll` compatibility send holding `questionnaires.readRaw` (08 §8.4). Nothing else.
      let permitted = viaSuperAdmin;
      if (!permitted && assignment.senderPersonId === personId && assignment.compatibilityGroupId) {
        permitted =
          snapshot?.compatibility?.visibility === 'senderSeesAll' &&
          (await activePersonCan(ctx.fs, ctx.key, 'questionnaires.readRaw'));
      }
      if (!permitted) return null;

      const response = await getResponse(ctx.fs, ctx.key, assignment.id);
      if (!snapshot || !response || response.submittedAt === undefined) return null;

      // Audit BEFORE showing the answers — the trail is the whole point of break-glass (§8.4).
      const entry: RawAccessAuditEntry = {
        schemaVersion: 1,
        at: new Date().toISOString(),
        by: personId ?? 'super-admin',
        viaSuperAdmin,
        assignmentId: assignment.id,
        recipientName: await recipientDisplayName(ctx.fs, ctx.key, assignment),
        action: 'revealRaw',
      };
      await appendAuditEntry(ctx.fs, ctx.key, entry);
      return formatResponseAnswers(snapshot.questions, response.answers);
    },
    auditList: async (): Promise<RawAccessAuditEntry[]> => {
      const ctx = await host.vaultAndKey();
      // Super-admin only — the break-glass trail is not a normal-capability surface (§8.4).
      if (!ctx || !host.isSuperAdminActive()) return [];
      return listAuditEntries(ctx.fs, ctx.key);
    },

    // --- Relay: external delivery (08-questionnaires §3.2/§3.5/§3.8/§5.2). The Cloudflare token + drain
    //     secret stay host-side (read from config/relay.enc); only renderer-safe data crosses the bridge.
    assignmentsCreateRelayLink: async (
      input,
    ): Promise<{ assignmentId: string; link: string; pin: string }> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.sendExternal')))
        throw new Error('Not permitted');
      const parsed = CreateRelayLinkSchema.parse(input);
      const config = await readRelayConfig(ctx.fs, ctx.key);
      if (!config) {
        throw new Error('No relay is connected. Ask an admin to set one up in Settings → Relay.');
      }
      const personId = await activePersonId();
      if (!personId) throw new Error('Not permitted');
      const sender = await getPerson(ctx.fs, ctx.key, personId);
      const senderName = sender?.displayName ?? 'Someone';
      const privacy = parsed.privacy ?? 'private';
      const senderVisible = parsed.senderVisibleToRecipient ?? true;
      const settings = await readVaultSettingsValues(ctx.fs);
      const disclosure = externalSendDisclosure(
        senderVisible ? senderName : 'the person who sent this',
        privacy,
        { discloseAdminAccess: settings['questionnaires.discloseAdminAccess'] === true },
      );
      const client = createRelayHttpClient(
        config.endpointUrl,
        config.drainSecret,
        host.relay.fetch,
      );
      const { assignment, link, pin } = await createRelaySend(ctx.fs, ctx.key, client, {
        questionnaireId: parsed.questionnaireId,
        senderPersonId: personId,
        senderName,
        // Rebuild with conditional spreads so optional fields are absent (not `undefined`) under
        // exactOptionalPropertyTypes.
        recipient: {
          kind: 'external',
          ...(parsed.recipient.displayName !== undefined
            ? { displayName: parsed.recipient.displayName }
            : {}),
          ...(parsed.recipient.email !== undefined ? { email: parsed.recipient.email } : {}),
          ...(parsed.recipient.phone !== undefined ? { phone: parsed.recipient.phone } : {}),
        },
        senderVisibleToRecipient: senderVisible,
        privacy,
        disclosure,
        endpointUrl: config.endpointUrl,
        ...(parsed.expiresAt !== undefined ? { expiresAt: parsed.expiresAt } : {}),
      });
      return { assignmentId: assignment.id, link, pin };
    },
    assignmentsDrain: async (): Promise<{ drained: number; declined: number }> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.sendExternal')))
        return { drained: 0, declined: 0 };
      const config = await readRelayConfig(ctx.fs, ctx.key);
      const personId = await activePersonId();
      if (!config || !personId) return { drained: 0, declined: 0 };
      const client = createRelayHttpClient(
        config.endpointUrl,
        config.drainSecret,
        host.relay.fetch,
      );
      // Drain only the active person's still-open external sends; submitted/declined/revoked/expired
      // ones are already drained or done, so re-draining them is wasted relay round-trips.
      const open = ['sent', 'opened', 'inProgress'];
      const sends = (await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId })).filter(
        (a) => a.channel === 'relay' && a.relay && open.includes(a.status),
      );
      let drained = 0;
      let declined = 0;
      for (const a of sends) {
        try {
          const result = await drainRelaySend(ctx.fs, ctx.key, client, a.id);
          drained += result.drained;
          if (result.declined) declined += 1;
        } catch {
          // A send the relay can't reach right now is skipped; the next drain retries (idempotent).
        }
      }
      return { drained, declined };
    },
    assignmentsRevoke: async (assignmentId): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.sendExternal'))) return;
      const id = AssignmentIdSchema.parse(assignmentId);
      const assignment = await getAssignment(ctx.fs, ctx.key, id);
      if (!assignment?.relay) return;
      const personId = await activePersonId();
      if (
        assignment.senderPersonId !== personId &&
        !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))
      ) {
        throw new Error('Not permitted');
      }
      const config = await readRelayConfig(ctx.fs, ctx.key);
      if (!config) return;
      const client = createRelayHttpClient(
        config.endpointUrl,
        config.drainSecret,
        host.relay.fetch,
      );
      await revokeRelaySend(ctx.fs, ctx.key, client, id);
    },
    relayStatus: async (): Promise<RelayStatus> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.sendExternal')))
        return { configured: false, updateAvailable: false };
      return relayStatusOf(await readRelayConfig(ctx.fs, ctx.key), host.relay.currentVersion);
    },
    relayConnect: async (input): Promise<RelayStatus> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage')))
        throw new Error('Not permitted');
      const { apiToken, accountId } = RelayConnectSchema.parse(input);
      const bundle = await host.relay.loadBundle();
      const result = await deployRelay(host.relay.fetch, bundle, { apiToken, accountId });
      const config: RelayConfig = {
        schemaVersion: 1,
        endpointUrl: result.endpointUrl,
        drainSecret: result.drainSecret,
        cloudflare: {
          accountId,
          apiToken,
          relayVersion: result.relayVersion,
          scriptName: result.scriptName,
          kvNamespaceId: result.kvNamespaceId,
        },
      };
      await writeRelayConfig(ctx.fs, ctx.key, config);
      return relayStatusOf(config, host.relay.currentVersion);
    },
    relayUpdate: async (): Promise<RelayStatus> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage')))
        throw new Error('Not permitted');
      const config = await readRelayConfig(ctx.fs, ctx.key);
      if (!config) return { configured: false, updateAvailable: false };
      const bundle = await host.relay.loadBundle();
      const relayVersion = await updateRelay(host.relay.fetch, bundle, {
        apiToken: config.cloudflare.apiToken,
        accountId: config.cloudflare.accountId,
        kvNamespaceId: config.cloudflare.kvNamespaceId,
        drainSecret: config.drainSecret,
      });
      const next: RelayConfig = { ...config, cloudflare: { ...config.cloudflare, relayVersion } };
      await writeRelayConfig(ctx.fs, ctx.key, next);
      return relayStatusOf(next, host.relay.currentVersion);
    },
    relayTeardown: async (): Promise<RelayStatus> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage')))
        throw new Error('Not permitted');
      const config = await readRelayConfig(ctx.fs, ctx.key);
      if (config) {
        await teardownRelay(host.relay.fetch, {
          apiToken: config.cloudflare.apiToken,
          accountId: config.cloudflare.accountId,
          scriptName: config.cloudflare.scriptName,
          kvNamespaceId: config.cloudflare.kvNamespaceId,
        });
        await clearRelayConfig(ctx.fs);
      }
      return { configured: false, updateAvailable: false };
    },

    // --- Dreams (12-dreams) — gated by `dreams.own`, scoped to the active dreamer ---
    dreamsList: async (): Promise<Dream[]> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return [];
      return listDreams(ctx.fs, ctx.key, personId);
    },
    dreamGet: async (id): Promise<Dream | null> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return null;
      return getDream(ctx.fs, ctx.key, personId, PersonIdSchema.parse(id));
    },
    dreamSave: async (input): Promise<Dream> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) {
        throw new Error('Not permitted');
      }
      const { id: inputId, ...fields } = DreamInputSchema.parse(input);
      // Main owns id/schemaVersion/personId/status/timestamps; merge over an existing dream so editing
      // preserves createdAt + the analysis link (status/analysisId change only in the analysis slice).
      const existing = inputId ? await getDream(ctx.fs, ctx.key, personId, inputId) : null;
      const now = new Date().toISOString();
      const dream: Dream = {
        ...fields,
        id: existing?.id ?? inputId ?? uuid(),
        schemaVersion: 1,
        personId,
        status: existing?.status ?? 'captured',
        ...(existing?.analysisId !== undefined ? { analysisId: existing.analysisId } : {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await saveDream(ctx.fs, ctx.key, dream);
      return dream;
    },
    dreamDelete: async (id): Promise<void> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return;
      // purgeDream (not deleteDream) so the linked Insight is removed too — else it orphans + keeps
      // feeding the coach (12 §3.6).
      await purgeDream(ctx.fs, ctx.key, personId, PersonIdSchema.parse(id));
    },
    dreamAnalyzeTurn: async (input): Promise<ChatTurnResult> => {
      const { dreamId, userText } = DreamAnalyzeTurnSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      // The API key is read host-side and never crosses to the renderer; streamed deltas go to the
      // dedicated dream sink so they never mix with the Sessions chat stream.
      const apiKey = await host.secrets.get(ANTHROPIC_API_KEY_ID);
      return runAnalysisTurn({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        dreamId,
        userText,
        onDelta: (text) => host.emitDreamChunk(text),
        now: new Date(),
      });
    },
    dreamGetAnalysis: async (dreamId): Promise<DreamAnalysis | null> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return null;
      return getAnalysis(ctx.fs, ctx.key, personId, PersonIdSchema.parse(dreamId));
    },
    dreamGetConversation: async (dreamId): Promise<Conversation | null> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return null;
      return getDreamConversation(ctx.fs, ctx.key, personId, PersonIdSchema.parse(dreamId));
    },
    dreamSynthesize: async (input): Promise<DreamSynthesisResult> => {
      const { dreamId } = DreamIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      const apiKey = await host.secrets.get(ANTHROPIC_API_KEY_ID);
      return synthesizeAnalysis({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        dreamId,
        now: new Date(),
      });
    },
    dreamUpdateAnalysis: async (input): Promise<DreamAnalysis | null> => {
      const { dreamId, edits } = DreamUpdateAnalysisSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return null;
      return updateAnalysis({
        fs: ctx.fs,
        key: ctx.key,
        personId,
        dreamId,
        edits,
        now: new Date(),
      });
    },
    dreamApprove: async (input): Promise<DreamApproveResult> => {
      const { dreamId } = DreamIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) {
        return { ok: false, reason: 'NOT_FOUND', message: 'There’s no analysis to approve yet.' };
      }
      // The dream→coach master toggle lives in vault settings (default ON); the service refuses when off.
      const memoryEnabled =
        (await readVaultSettingsValues(ctx.fs))['dreams.memoryEnabled'] !== false;
      return approveAnalysis({
        fs: ctx.fs,
        key: ctx.key,
        personId,
        dreamId,
        memoryEnabled,
        now: new Date(),
      });
    },
    dreamRemoveFromContext: async (input): Promise<void> => {
      const { dreamId } = DreamIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return;
      await removeFromContext({ fs: ctx.fs, key: ctx.key, personId, dreamId, now: new Date() });
    },
    dreamPatternStats: async (input): Promise<DreamPatternStats> => {
      const { window } = DreamPatternWindowSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) {
        return emptyPatternStats(window);
      }
      return getPatternStats(ctx.fs, ctx.key, personId, window, new Date());
    },
    dreamGetPatternSummary: async (): Promise<DreamPatternSummary | null> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return null;
      return getPatternSummary(ctx.fs, ctx.key, personId);
    },
    dreamPatternNarrative: async (): Promise<DreamNarrativeResult> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      const apiKey = await host.secrets.get(ANTHROPIC_API_KEY_ID);
      return generatePatternNarrative({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        now: new Date(),
      });
    },
    dreamApprovePatternNarrative: async (): Promise<DreamApproveResult> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) {
        return {
          ok: false,
          reason: 'NOT_FOUND',
          message: 'There’s no pattern reflection to approve yet.',
        };
      }
      const memoryEnabled =
        (await readVaultSettingsValues(ctx.fs))['dreams.memoryEnabled'] !== false;
      return approvePatternNarrative({
        fs: ctx.fs,
        key: ctx.key,
        personId,
        memoryEnabled,
        now: new Date(),
      });
    },
    dreamRemovePatternNarrative: async (): Promise<void> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return;
      await removePatternNarrativeFromContext({ fs: ctx.fs, key: ctx.key, personId });
    },
    dreamShareTargets: async (): Promise<DreamShareTarget[]> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return [];
      return listDreamShareTargets(ctx.fs, ctx.key, personId);
    },
    dreamGetInsight: async (dreamId): Promise<Insight | null> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.own'))) return null;
      return getDreamInsight(ctx.fs, ctx.key, personId, PersonIdSchema.parse(dreamId));
    },
    dreamSetFactShare: async (input): Promise<DreamShareResult> => {
      const { dreamId, factId, withPersonId, share } = DreamSetFactShareSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      // Cross-person sharing is the privileged action — gated by `dreams.shareContext`, not `dreams.own`.
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.shareContext'))) {
        return { ok: false, reason: 'NOT_FOUND' };
      }
      return setDreamFactShare({
        fs: ctx.fs,
        key: ctx.key,
        personId,
        dreamId,
        factId,
        withPersonId,
        share,
        now: new Date(),
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

import { z } from 'zod';
import {
  ANTHROPIC_API_KEY_ID,
  MIN_OWNER_PIN_LENGTH,
  OPENAI_API_KEY_ID,
  type AccessView,
  type BudgetState,
  type ChatTurnResult,
  type ClaudeTestResult,
  type ConversationMeta,
  type KeyRotateResult,
  type RotationStatus,
  type VaultSyncReadiness,
  type DreamApproveResult,
  type DreamImageResult,
  type DreamNarrativeResult,
  type DreamSharedImage,
  type AppPlatform,
  type DreamShareResult,
  type DreamSynthesisResult,
  type GuidanceState,
  type GuidedSuggestResult,
  type HouseholdStatus,
  type InviteSummary,
  type SelfosBridge,
  type SetActiveResult,
  type SettingsValues,
  type UsageSummary,
} from './channels';
import {
  AiProviderSchema,
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
  SessionStatusSchema,
  SettingsFileSchema,
  conversationStatus,
  type AiKeyStatus,
  type AlignmentResult,
  type DeviceView,
  type Assignment,
  type CompatibilityGroup,
  type CompatibilityMember,
  type CompatibilitySendResult,
  type CompatibilityVisibility,
  type CompatResultPublish,
  type ContextOnlyResult,
  type InAppSendResult,
  type RelayResult,
  type InboxAssignmentDetail,
  type InboxCompatibilityView,
  type InboxItem,
  type Insight,
  type IntimacyTopicsView,
  type MemoryReconcileResult,
  IntakeAnswerValueSchema,
  type IntakeState,
  type ProfileUpdateSuggestion,
  type IntakeSynthesisResult,
  type IntakeTurnResult,
  type QuestionTrend,
  type Role,
  type RelayLinkResult,
  type SendAnswer,
  type SendResult,
  type QuestionnaireSendState,
  type QuestionnaireAnalyzeResult,
  type QuestionnaireGenerateResult,
  type QuestionnaireImproveResult,
  type QuestionnaireSuggestResult,
  type BootState,
  type Budget,
  type Conversation,
  type DeviceState,
  type DeviceStatePatch,
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
  type SessionCost,
  type SessionSummaryResult,
} from './schemas';
import { OWNER_ROLE_ID, roleAllows, type CapabilityKey } from './capabilities';
import { runConnectionTest } from './claudeProxy';
import { runOpenAiConnectionTest } from './openaiProxy';
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
import type { ClaudeClient, FileSystem, ImageClient, SecretStore } from '@selfos/core/host';
import { uuid } from '@selfos/core/id';
import {
  aiKeyStatus as computeAiKeyStatus,
  clearSharedKey,
  readAiCredentials,
  resolveAiKey,
  resolveOpenAiKey,
  writeSharedKey,
} from '@selfos/core/ai';
import { settingWriteNeedsAdmin } from './settingsPolicy';
import {
  createMasterKey,
  isVaultInitialized,
  loadMasterKey,
  MASTER_KEY_ID,
  readRotationJournal,
  restoreFromRecoveryPhrase,
  resumeRotation,
  rotateMasterKey,
  RotationError,
  storeMasterKey,
  VAULT_ALREADY_INITIALIZED,
} from '@selfos/core/crypto';
import {
  cancelInvite,
  createInvite,
  defaultDeviceLabel,
  deletePerson,
  deleteRelationship,
  ensureMemberAccounts,
  getAccessConfig,
  getAccessView,
  getPerson,
  listDevices,
  listInvitesForPerson,
  listPeople,
  listRelatedPeople,
  listRelationships,
  redeemInvite,
  registerThisDevice,
  removeAccount,
  renameDevice,
  savePerson,
  saveRole,
  setAccount,
  upsertPerson,
  upsertRelationship,
  verifyAccountPin,
} from '@selfos/core/people';
import {
  checkBudget,
  DEFAULT_BUDGET,
  effectivePersonBudget,
  getBudgets,
  periodStart,
  queryUsage,
  rollupSessionCosts,
  setAppBudget,
  setPersonBudget,
  summarize,
} from '@selfos/core/usage';
import {
  acknowledgeAdult,
  deleteConversation,
  endAndSummarize,
  getConversation,
  getGuidancePrefs,
  getGuidanceState,
  listConversations,
  runChatTurn,
  saveConversation,
  setSessionStatus,
  startGuided,
  suggestGuidedSessions,
} from '@selfos/core/conversations';
import {
  deleteInsight,
  flagInsightFact,
  listAllInsights,
  listInsightsForPerson,
  listRelatedShareableInsights,
  reconcileInsights,
  updateInsight,
} from '@selfos/core/insights';
import { INTIMACY_ACTIVITIES, INTIMACY_FANTASIES } from '@selfos/core/intimacy';
import {
  addCustomIntimacyTopic,
  addCustomType,
  analyzeAssignment,
  attachRelayLink,
  readRelayLink,
  buildQuestionTrends,
  compatibilityDisclosure,
  createAssignment,
  createCompatibilitySend,
  writeCompatibilityMember,
  declineAssignment,
  deleteQuestionnaireImage,
  deleteSend,
  distillContextOnly,
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
  gatherRecipientHistory,
  generateQuestions,
  getAssignment,
  getAssignmentSnapshot,
  getQuestionnaire,
  getQuestionnaireImage,
  getResponse,
  improveQuestion,
  isAllowedImageMime,
  isAnswerable,
  listAssignments,
  listCustomTypes,
  listQuestionnaires,
  MAX_IMAGE_BYTES,
  openAssignment,
  publishRelayResult,
  purgeQuestionnaire,
  readCustomIntimacyTopics,
  removeCustomIntimacyTopic,
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
  deleteDreamImage,
  generateDreamImage,
  generatePatternNarrative,
  getAnalysis,
  getDream,
  getDreamConversation,
  getDreamImage,
  getDreamInsight,
  getSharedDreamImage,
  listImagesSharedWith,
  setDreamImageShare,
  getPatternStats,
  getPatternSummary,
  listDreams,
  listDreamShareTargets,
  deleteDream,
  removeFromContext,
  removePatternNarrativeFromContext,
  runAnalysisTurn,
  saveDream,
  setDreamFactShare,
  synthesizeAnalysis,
  updateAnalysis,
} from '@selfos/core/dreams';
import {
  ensureIntakeSession,
  getIntakeSection,
  getIntakeSession,
  intakeSectionMeta,
  runIntakeTurn,
  skipIntakeSection,
  submitSectionForm,
  synthesizeIntake,
} from '@selfos/core/intake';
import {
  acceptSuggestion,
  dismissSuggestion,
  listPendingSuggestions,
  unfilledInvitedSections,
} from '@selfos/core/profile';
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
  /** Image-generation client (OpenAI second provider, 13-dream-images §5.1). */
  image: ImageClient;

  // --- Device-local state ---
  readDeviceState(): Promise<DeviceState>;
  updateDeviceState(patch: DeviceStatePatch): Promise<DeviceState>;
  /** Device-scoped settings (`key → value`); device-local, separate from the synced vault settings. */
  readDeviceSettings(): Promise<Record<string, unknown>>;
  writeDeviceSettings(values: Record<string, unknown>): Promise<void>;

  // --- Misc ---
  /** The model to use for AI calls (the host reads its own model preference + default). */
  activeModel(): Promise<string>;
  /** The app version string (About section). */
  appVersion: string;
  /** The host platform — drives the titlebar's window-control layout (02-app-shell §13). */
  platform: AppPlatform;

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
  /** Deliver an intake interview reply chunk to the renderer (separate channel from chat/dreams). */
  emitIntakeChunk(chunk: string): void;

  // --- Platform-specific surface, forwarded verbatim to the renderer-facing bridge ---
  getBootState(): Promise<BootState>;
  refreshBootState(): Promise<BootState>;
  selectVaultFolder(): Promise<string | null>;
  useVault(path: string): Promise<BootState>;
  getConflicts(): Promise<string[]>;
  /** Whether the active vault folder still has not-yet-downloaded iCloud items (33 §5.D). Best-effort. */
  hasPendingDownloads?(): Promise<boolean>;
  revealVault(): Promise<void>;
  /**
   * Save image bytes to a file the user chooses OUTSIDE the vault (13-dream-images §3.5) — a native save
   * dialog on Electron, a download on iOS/web. Returns the chosen path, or null if cancelled.
   */
  saveImageFile(suggestedName: string, bytes: Uint8Array, mime: string): Promise<string | null>;
  /** Subscribe to external vault changes (the host's watcher); returns an unsubscribe. */
  onVaultChanged(listener: () => void): () => void;
  /** Subscribe to streamed chat chunks; the renderer-facing counterpart to `emitChatChunk`. */
  onChatChunk(listener: (delta: string) => void): () => void;
  /** Subscribe to streamed dream-analysis chunks; the counterpart to `emitDreamChunk`. */
  onDreamChunk(listener: (delta: string) => void): () => void;
  /** Subscribe to streamed intake interview chunks; the counterpart to `emitIntakeChunk`. */
  onIntakeChunk(listener: (delta: string) => void): () => void;
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
const AiProviderInputSchema = z.object({ provider: AiProviderSchema.default('anthropic') });
const AiSetSharedKeySchema = z.object({ provider: AiProviderSchema, value: z.string().min(1) });
const DevicesRenameSchema = z.object({
  deviceId: z.string().min(1),
  label: z.string().min(1).max(80),
});
const KeysRotateSchema = z.object({ revokeDeviceIds: z.array(z.string()).default([]) });
const HouseholdSetupSchema = z.object({
  ownerName: z.string().min(1),
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
const ChatConversationIdSchema = z.object({ conversationId: z.string().min(1) });
const StartGuidedSchema = z.object({ guideId: z.string().min(1) });
const SessionSetStatusSchema = z.object({
  conversationId: z.string().min(1),
  status: SessionStatusSchema,
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
const DreamGenerateImageSchema = z.object({
  dreamId: z.string().min(1),
  style: z.string().min(1).optional(), // per-image override; falls back to the Settings default
});
const DreamSetImageShareSchema = z.object({
  dreamId: z.string().min(1),
  targetPersonId: z.string().min(1),
  shared: z.boolean(),
});
const DreamGetSharedImageSchema = z.object({
  dreamerId: z.string().min(1),
  dreamId: z.string().min(1),
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
const IntimacyTopicSchema = z.object({
  kind: z.enum(['activities', 'fantasies']),
  name: z.string().min(1),
});
const AssignmentsCreateSchema = z.object({
  questionnaireId: z.string().min(1),
  // No recipient here — it's bound to the questionnaire at creation (08 §17.3) and read from the def.
  privacy: z.enum(['standard', 'private']).optional(),
  senderVisibleToRecipient: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
});
const StoreImageSchema = z.object({ base64: z.string().min(1), mime: z.string().min(1) });
const GenerateSchema = z.object({
  type: z.string().min(1),
  sensitivity: SensitivityTierSchema,
  brief: z.string().optional(),
  existingPrompts: z.array(z.string()),
  // The bound household recipient (08 §17.12) — the bridge auto-tailors to their shareable context AND de-dups
  // against their full history. The author never receives any of it. No separate "about a person" picker.
  recipientPersonId: z.string().min(1).optional(),
  // Intimacy draft format (08 §17.12-C): direct questions, described scenarios, or a mix.
  intimacyMode: z.enum(['questions', 'scenarios', 'mix']).optional(),
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
  // No recipient here — the external recipient is bound to the questionnaire at creation (08 §17.3); the
  // bridge reads name/email/phone from the def.
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
// Flag (or clear) a fact as inaccurate (20-memory-dashboard §3.6). `factId` omitted = the whole insight.
const InsightFlagSchema = z.object({
  insightId: z.string().min(1),
  factId: z.string().min(1).optional(),
  flagged: z.boolean(),
});
// Personal onboarding (18-personal-onboarding §6).
const IntakeRunTurnSchema = z.object({ sectionId: z.string().min(1), userText: z.string() });
const IntakeSectionIdSchema = z.object({ sectionId: z.string().min(1) });
const IntakeSynthesizeSchema = z.object({ sectionId: z.string().min(1).optional() });
const IntakeSubmitFormSchema = z.object({
  sectionId: z.string().min(1),
  answers: z.record(z.string(), IntakeAnswerValueSchema),
});
const ProfileSuggestionIdSchema = z.string().min(1);
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
  // Compatibility is always the sender + the bound recipient (08 §17.12-B) — both derived from the
  // questionnaire, so no participant ids are passed.
  questionnaireId: z.string().min(1),
});
const GroupIdSchema = z.string().min(1);

/**
 * Mint a FRESH relay link + PIN for an existing, already-validated shareable send (08 §17.14a/c): revoke the
 * old mailbox, derive the disclosure (compat vs external), re-upload. Shared by `assignmentsReshare` (by id)
 * and `questionnairesShareLink` (the latest send of a questionnaire). Returns null if the upload fails.
 */
async function reshareLink(
  fs: FileSystem,
  key: Uint8Array,
  client: ReturnType<typeof createRelayHttpClient>,
  endpointUrl: string,
  assignment: Assignment,
): Promise<RelayLinkResult | null> {
  if (assignment.relay) await revokeRelayForDeletion(fs, key, client, assignment.id);
  const senderName =
    (await getPerson(fs, key, assignment.senderPersonId))?.displayName ?? 'Someone';
  const snapshot = await getAssignmentSnapshot(fs, key, assignment.id);
  const compat = snapshot?.compatibility;
  const disclosure = compat?.enabled
    ? compatibilityDisclosure(compat.visibility, {
        otherParticipantName: senderName,
        senderName,
        viewerIsSender: false,
      })
    : externalSendDisclosure(
        assignment.senderVisibleToRecipient ? senderName : 'the person who sent this',
        assignment.privacy,
      );
  try {
    return await attachRelayLink(fs, key, client, assignment.id, {
      senderName,
      senderVisibleToRecipient: assignment.senderVisibleToRecipient,
      disclosure,
      endpointUrl,
    });
  } catch {
    // Mint failed after the old mailbox was revoked: the send keeps its stale relay; the user can retry.
    return null;
  }
}

/** Build the renderer-facing `SelfosBridge` from a platform `BridgeHost`. */
export function createCoreBridge(host: BridgeHost): SelfosBridge {
  const activePersonId = async (): Promise<string | null> =>
    (await host.readDeviceState()).activePersonId ?? null;

  /** The active person's role (from the access config), or null. */
  const activePersonRole = async (fs: FileSystem, key: Uint8Array): Promise<Role | null> => {
    const personId = await activePersonId();
    if (!personId) return null;
    const access = await getAccessConfig(fs, key);
    const account = access.accounts.find((candidate) => candidate.personId === personId);
    return access.roles.find((candidate) => candidate.id === account?.roleId) ?? null;
  };

  /**
   * Whether the active person's role grants a capability — enforces admin-only actions in the bridge (the
   * trust boundary). The Owner is the full-access role (the concealed super-admin was removed 2026-06-15).
   */
  const activePersonCan = async (
    fs: FileSystem,
    key: Uint8Array,
    capability: CapabilityKey,
  ): Promise<boolean> => {
    return roleAllows((await activePersonRole(fs, key)) ?? undefined, capability);
  };

  /** Whether the active person is the household Owner (the full-access role). */
  const activePersonIsOwner = async (fs: FileSystem, key: Uint8Array): Promise<boolean> =>
    (await activePersonRole(fs, key))?.id === OWNER_ROLE_ID;

  // The device registry (32-device-management §5.2): register/heartbeat this device into the vault on each
  // join path + once per app launch. The key-free `deviceId` is generated once + cached device-local.
  let deviceHeartbeatDone = false;
  const ensureDeviceRegistered = async (fs: FileSystem, key: Uint8Array): Promise<void> => {
    const device = await host.readDeviceState();
    let deviceId = device.deviceId;
    let deviceLabel = device.deviceLabel;
    if (!deviceId) {
      deviceId = uuid();
      deviceLabel = defaultDeviceLabel(host.platform);
      await host.updateDeviceState({ deviceId, deviceLabel });
    }
    await registerThisDevice(fs, key, {
      deviceId,
      label: deviceLabel ?? defaultDeviceLabel(host.platform),
      platform: host.platform,
      now: new Date(),
      activePersonId: device.activePersonId ?? null,
    });
  };

  const AI_KEY_IDS = { anthropic: ANTHROPIC_API_KEY_ID, openai: OPENAI_API_KEY_ID } as const;

  /**
   * Auto-share (25 §5.6): mirror the active owner's device-local AI keys into the vault-shared credentials
   * so member devices inherit them with NO manual step — the fix for the recurring "AI not set up on a
   * member's shared vault" trap (a device-local key + a synced `ai.enabled` left members locked out). Runs
   * only for an owner (`settings.manage`), only when the `ai.shareCredentials` opt-out is not off, and is
   * idempotent — a provider already shared is skipped, so it costs nothing on repeat boots. Best-effort.
   */
  const ensureSharedAiCredentials = async (fs: FileSystem, key: Uint8Array): Promise<void> => {
    if (!(await activePersonCan(fs, key, 'settings.manage'))) return;
    if ((await readVaultSettingsValues(fs))['ai.shareCredentials'] === false) return;
    const creds = await readAiCredentials(fs, key);
    const sharedByPersonId = (await activePersonId()) ?? undefined;
    for (const provider of ['anthropic', 'openai'] as const) {
      const already = provider === 'anthropic' ? creds?.anthropicApiKey : creds?.openaiApiKey;
      if (already) continue;
      const deviceKey = await host.secrets.get(AI_KEY_IDS[provider]);
      if (!deviceKey) continue;
      await writeSharedKey(fs, key, {
        provider,
        value: deviceKey,
        ...(sharedByPersonId ? { sharedByPersonId } : {}),
        now: new Date(),
      });
    }
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
      apiKey: (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null,
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

  /** Assemble the renderer-facing intake state (§6): the resumable session + catalog meta + availability. */
  const buildIntakeState = async (
    fs: FileSystem,
    key: Uint8Array,
    personId: string,
  ): Promise<IntakeState> => {
    const session = await ensureIntakeSession(fs, key, personId, new Date());
    const apiKey = (await resolveAiKey(host.secrets, fs, key)).key ?? null;
    const aiEnabled = (await readVaultSettingsValues(fs))['ai.enabled'] === true;
    const prefs = await getGuidancePrefs(fs, key, personId);
    return {
      session,
      sections: intakeSectionMeta(),
      aiAvailable: Boolean(apiKey) && aiEnabled,
      adultAcknowledged: prefs.adultAcknowledged === true,
    };
  };

  /** A benign, non-nudging intake state for an unpermitted / signed-out caller (renderer renders nothing). */
  const emptyIntakeState = (personId: string): IntakeState => ({
    session: {
      id: 'none',
      schemaVersion: 1,
      personId,
      status: 'complete',
      sections: [],
      startedAt: '',
      updatedAt: '',
    },
    sections: intakeSectionMeta(),
    aiAvailable: false,
    adultAcknowledged: false,
  });

  return {
    // --- Platform-specific (forwarded to the host) ---
    getBootState: () => host.getBootState(),
    refreshBootState: () => host.refreshBootState(),
    selectVaultFolder: () => host.selectVaultFolder(),
    useVault: (path) => host.useVault(path),
    getConflicts: () => host.getConflicts(),
    vaultSyncReadiness: async (): Promise<VaultSyncReadiness> => {
      // Sync-safety (33 §5.D): if the chosen folder has NO recovery.enc but still has pending iCloud
      // downloads, "absent marker" may just mean "not downloaded yet" — warn instead of routing to Setup.
      const ctx = await host.vaultPath();
      if (!ctx) return { ready: true };
      const fs = host.fileSystem(ctx);
      if (await isVaultInitialized(fs)) return { ready: true }; // initialized → Unlock, never Setup
      const pending = host.hasPendingDownloads ? await host.hasPendingDownloads() : false;
      return pending ? { ready: false, reason: 'icloud-pending' } : { ready: true };
    },
    revealVault: () => host.revealVault(),
    onVaultChanged: (listener) => host.onVaultChanged(listener),
    onChatChunk: (listener) => host.onChatChunk(listener),
    onDreamChunk: (listener) => host.onDreamChunk(listener),
    onIntakeChunk: (listener) => host.onIntakeChunk(listener),
    platform: host.platform,
    // iOS/web have no OS window chrome, so there is no fullscreen-titlebar transition to report.
    onFullscreenChanged: () => () => {},
    getAppVersion: () => Promise.resolve(host.appVersion),

    // --- Settings ---
    getSettings: async (): Promise<SettingsValues> => {
      const vaultDir = await host.vaultPath();
      const vault = vaultDir ? await readVaultSettingsValues(host.fileSystem(vaultDir)) : {};
      return { vault, device: await host.readDeviceSettings() };
    },
    setSetting: async (input): Promise<void> => {
      const { key, value, scope } = SetSettingSchema.parse(input);
      // Trust boundary (26): a vault-scoped (household-wide) or admin-only setting write requires
      // `settings.manage` — enforced here, not just hidden in the UI.
      if (settingWriteNeedsAdmin(key, scope)) {
        const ctx = await host.vaultAndKey();
        if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage'))) {
          throw new Error('Not permitted');
        }
      }
      if (scope === 'device') {
        await host.writeDeviceSettings({ ...(await host.readDeviceSettings()), [key]: value });
        return;
      }
      const vaultDir = await host.vaultPath();
      if (!vaultDir) return;
      const fs = host.fileSystem(vaultDir);
      await writeVaultSettingsValues(fs, { ...(await readVaultSettingsValues(fs)), [key]: value });
      // Toggling household key-sharing takes effect immediately (25 §5.6): turning it ON shares the owner's
      // current device keys; turning it OFF withdraws them from the vault (members fall back to their own).
      if (key === 'ai.shareCredentials') {
        const liveKey = await loadMasterKey(host.secrets);
        if (liveKey) {
          if (value === true) await ensureSharedAiCredentials(fs, liveKey);
          else if (value === false && (await activePersonCan(fs, liveKey, 'settings.manage'))) {
            await clearSharedKey(fs, liveKey, { provider: 'anthropic', now: new Date() });
            await clearSharedKey(fs, liveKey, { provider: 'openai', now: new Date() });
          }
        }
      }
    },
    resetSetting: async (input): Promise<void> => {
      const { key, scope } = ResetSettingSchema.parse(input);
      if (settingWriteNeedsAdmin(key, scope)) {
        const ctx = await host.vaultAndKey();
        if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage'))) {
          throw new Error('Not permitted');
        }
      }
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
      // Auto-share an AI key to the household by default (25 §5.6): when an OWNER saves a Claude/OpenAI key
      // and sharing isn't opted out, mirror it into the vault so members inherit it with no extra step. A
      // member's own-key override is device-local only (the settings.manage guard skips non-owners).
      if (id === ANTHROPIC_API_KEY_ID || id === OPENAI_API_KEY_ID) {
        const ctx = await host.vaultAndKey();
        if (ctx && (await activePersonCan(ctx.fs, ctx.key, 'settings.manage'))) {
          if ((await readVaultSettingsValues(ctx.fs))['ai.shareCredentials'] !== false) {
            const sharedByPersonId = (await activePersonId()) ?? undefined;
            await writeSharedKey(ctx.fs, ctx.key, {
              provider: id === ANTHROPIC_API_KEY_ID ? 'anthropic' : 'openai',
              value,
              ...(sharedByPersonId ? { sharedByPersonId } : {}),
              now: new Date(),
            });
          }
        }
      }
    },
    secretHas: async (input): Promise<boolean> => {
      return host.secrets.has(SecretIdSchema.parse(input).id);
    },
    secretClear: async (input): Promise<void> => {
      await host.secrets.clear(SecretIdSchema.parse(input).id);
    },
    claudeTest: async (): Promise<ClaudeTestResult> => {
      // Test the *resolved* key (device override → vault-shared → device-only when no vault), 25 §6.3.
      const ctx = await host.vaultAndKey();
      const apiKey = ctx
        ? ((await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null)
        : await host.secrets.get(ANTHROPIC_API_KEY_ID);
      return runConnectionTest(host.claude, apiKey, await host.activeModel());
    },
    openaiTest: async (): Promise<ClaudeTestResult> => {
      // Verify the *resolved* OpenAI key (override → shared, 25 §6.3) with a non-generative probe — never an
      // image generation, so it bills nothing (33 §5.B). The key stays host-side.
      const ctx = await host.vaultAndKey();
      const apiKey = ctx
        ? ((await resolveOpenAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null)
        : await host.secrets.get(OPENAI_API_KEY_ID);
      return runOpenAiConnectionTest(host.image, apiKey);
    },

    // --- Household AI credentials (25-household-ai-credentials) ---
    // Readiness — booleans + an enum only, never a key value (§5.3). Ungated (a self-readiness read, like
    // secretHas); the value never leaves the bridge.
    aiKeyStatus: async (input): Promise<AiKeyStatus> => {
      const { provider } = AiProviderInputSchema.parse(input ?? {});
      const ctx = await host.vaultAndKey();
      if (!ctx) {
        const hasDeviceOverride = await host.secrets.has(
          provider === 'anthropic' ? ANTHROPIC_API_KEY_ID : OPENAI_API_KEY_ID,
        );
        return {
          hasSharedKey: false,
          hasDeviceOverride,
          resolvedReady: hasDeviceOverride,
          source: hasDeviceOverride ? 'device' : 'none',
        };
      }
      return computeAiKeyStatus(host.secrets, ctx.fs, ctx.key, provider);
    },
    // Owner-only writes to the shared household key (§6.2). Gated on `settings.manage` in the bridge — the
    // trust boundary is here, not the UI (coordinates with spec 30).
    aiSetSharedKey: async (input): Promise<void> => {
      const { provider, value } = AiSetSharedKeySchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage'))) {
        throw new Error('Not permitted');
      }
      const sharedByPersonId = (await activePersonId()) ?? undefined;
      await writeSharedKey(ctx.fs, ctx.key, {
        provider,
        value,
        ...(sharedByPersonId ? { sharedByPersonId } : {}),
        now: new Date(),
      });
    },
    // Promote the owner's existing device key into the vault (the §5.4 migration) — reads the device secret
    // host-side; no key value crosses IPC inbound. No-op if no device key exists.
    aiShareDeviceKey: async (input): Promise<void> => {
      const { provider } = AiProviderInputSchema.parse(input ?? {});
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage'))) {
        throw new Error('Not permitted');
      }
      const deviceKey = await host.secrets.get(
        provider === 'anthropic' ? ANTHROPIC_API_KEY_ID : OPENAI_API_KEY_ID,
      );
      if (!deviceKey) return;
      const sharedByPersonId = (await activePersonId()) ?? undefined;
      await writeSharedKey(ctx.fs, ctx.key, {
        provider,
        value: deviceKey,
        ...(sharedByPersonId ? { sharedByPersonId } : {}),
        now: new Date(),
      });
    },
    aiClearSharedKey: async (input): Promise<void> => {
      const { provider } = AiProviderInputSchema.parse(input ?? {});
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'settings.manage'))) {
        throw new Error('Not permitted');
      }
      await clearSharedKey(ctx.fs, ctx.key, { provider, now: new Date() });
    },

    // --- Devices (32-device-management) — owner-only, enforced in the bridge ---
    devicesList: async (): Promise<DeviceView[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'devices.manage'))) return [];
      const device = await host.readDeviceState();
      const [records, people] = await Promise.all([
        listDevices(ctx.fs, ctx.key),
        listPeople(ctx.fs, ctx.key),
      ]);
      const nameOf = (id?: string | null): string | null =>
        id ? (people.find((p) => p.id === id)?.displayName ?? null) : null;
      return records.map((r) => ({
        deviceId: r.deviceId,
        label: r.label,
        platform: r.platform,
        createdAt: r.createdAt,
        lastSeenAt: r.lastSeenAt,
        isThisDevice: r.deviceId === device.deviceId,
        lastActivePersonName: nameOf(r.lastActivePersonId),
      }));
    },
    devicesRename: async (input): Promise<void> => {
      const { deviceId, label } = DevicesRenameSchema.parse(input);
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'devices.manage'))) {
        throw new Error('Not permitted');
      }
      await renameDevice(ctx.fs, ctx.key, deviceId, label);
      const device = await host.readDeviceState();
      if (device.deviceId === deviceId) await host.updateDeviceState({ deviceLabel: label });
    },
    // Whole-vault key rotation (32 §5.3/§6.4) — owner-only, sync-aware pre-flight, returns the NEW phrase once.
    keysRotate: async (input): Promise<KeyRotateResult> => {
      const { revokeDeviceIds } = KeysRotateSchema.parse(input ?? {});
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'devices.manage'))) {
        return { ok: false, code: 'NOT_PERMITTED' };
      }
      // Pre-flight: refuse on unresolved sync conflicts (re-keying a conflicted vault could orphan a copy).
      if ((await host.getConflicts()).length > 0)
        return { ok: false, code: 'SYNC_CONFLICT_UNRESOLVED' };
      const thisDeviceId = (await host.readDeviceState()).deviceId;
      if (!thisDeviceId) return { ok: false, code: 'ERROR' };
      try {
        const result = await rotateMasterKey(ctx.fs, host.secrets, {
          revokeDeviceIds,
          thisDeviceId,
          now: new Date(),
        });
        return { ok: true, ...result };
      } catch (error) {
        if (error instanceof RotationError) return { ok: false, code: error.code };
        return { ok: false, code: 'ERROR' };
      }
    },
    keysRotateStatus: async (): Promise<RotationStatus> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'devices.manage'))) return null;
      const journal = await readRotationJournal(ctx.fs);
      return journal ? { phase: journal.phase, total: journal.files.length } : null;
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
      // (32 §5.3) Resume a rotation this device may have crashed mid-flight, BEFORE reading anything
      // key-dependent. A 'committing' resume promotes the new master key — so reload it afterward.
      if (device.deviceId) {
        try {
          await resumeRotation(fs, host.secrets, device.deviceId);
        } catch {
          /* resume is best-effort; a stuck journal surfaces via keys:rotateStatus */
        }
      }
      const liveKey = (await loadMasterKey(host.secrets)) ?? key;

      // (32 §5.5) Re-key detection: if this device's key can't decrypt the access config but the vault IS
      // initialized, the vault was re-keyed elsewhere (this device was signed out). Clear the stale key and
      // route to Unlock (a graceful "rejoin", not a corruption error).
      let access;
      try {
        access = await getAccessConfig(fs, liveKey);
      } catch {
        await host.secrets.clear(MASTER_KEY_ID);
        return {
          vaultInitialized,
          hasMasterKey: false,
          hasOwner: false,
          activePersonId: null,
          pendingJoinPersonId,
        };
      }
      const hasOwner = access.accounts.some((account) => account.roleId === OWNER_ROLE_ID);
      // Heartbeat this device into the registry once per app launch (32 §6.1) — non-fatal if it fails.
      if (!deviceHeartbeatDone && vaultInitialized && hasOwner) {
        deviceHeartbeatDone = true;
        try {
          await ensureDeviceRegistered(fs, liveKey);
          // Auto-share the owner's device-local AI keys into the vault (25 §5.6) so an existing setup that
          // predates auto-sharing reaches members on the next launch — without the owner clicking anything.
          await ensureSharedAiCredentials(fs, liveKey);
        } catch {
          /* registry heartbeat + auto-share are best-effort; never block boot */
        }
      }
      return {
        vaultInitialized,
        hasMasterKey: true,
        hasOwner,
        activePersonId: device.activePersonId ?? null,
        pendingJoinPersonId,
      };
    },
    householdSetup: async (input): Promise<{ recoveryPhrase: string; ownerId: string }> => {
      const { ownerName, pin } = HouseholdSetupSchema.parse(input);
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
      await host.updateDeviceState({ activePersonId: owner.id });
      await ensureDeviceRegistered(fs, key);
      return { recoveryPhrase, ownerId: owner.id };
    },
    unlockWithRecoveryPhrase: async (input): Promise<{ ok: boolean }> => {
      // Join/recover this device: restore the master key from the recovery phrase (10-multi-device
      // §6.2). No owner is created. The phrase is never logged. Bad/garbled phrase → { ok: false }.
      const { phrase } = UnlockWithRecoveryPhraseSchema.parse(input);
      const vaultDir = await host.vaultPath();
      if (!vaultDir) return { ok: false };
      const ok = await restoreFromRecoveryPhrase(host.secrets, host.fileSystem(vaultDir), phrase);
      if (ok) {
        const ctx = await host.vaultAndKey();
        if (ctx) await ensureDeviceRegistered(ctx.fs, ctx.key);
      }
      return { ok };
    },
    unlinkVault: async (): Promise<BootState> => {
      // Detach this device from the current vault (14-vault-relinking). The host-agnostic half: the
      // Electron wrapper in ipc.ts also stops the chokidar watcher first (a platform concern, like
      // useVault's startVaultWatcher); on iOS that step is a no-op.
      //
      // CLEAR THE MASTER KEY FIRST. The key is a single device-local slot, not keyed per vault — so a
      // stale key left behind would mis-route the next folder (§7.1): a fresh folder → the desync
      // UnlockScreen, a different existing vault → wrong-key decrypt failures. Once it is gone, the
      // existing HouseholdGate routes correctly with no new routing code. This is why unlink == switch.
      await host.secrets.clear(MASTER_KEY_ID);
      // Forget the vault pointer + this device's session/join state (all device-local). Touch NOTHING
      // inside the vault on disk — the folder stays byte-intact and re-linkable via its recovery phrase.
      // Clear BOTH pointers: `vaultPath` (Electron) and `vaultBookmark` (the web/iOS bookmark) — each
      // host reads only its own, so clearing both keeps the detach correct on every platform.
      await host.updateDeviceState({
        vaultPath: null,
        vaultBookmark: undefined,
        activePersonId: null,
        pendingJoinPersonId: null,
      });
      // Recompute boot from the now-cleared device state → onboarding ("Choose a folder").
      return host.refreshBootState();
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
      const person = await upsertPerson(ctx.fs, ctx.key, PersonInputSchema.parse(input));
      // A subject person gets a no-PIN Member login by default, so they're immediately switchable by the
      // Owner and gated into onboarding (roles refactor 2026-06-15). The Access tab refines role/PIN later.
      if (person.isSubject) await ensureMemberAccounts(ctx.fs, ctx.key, [person.id]);
      return person;
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
      if (!ctx) return { roles: [], accounts: [] };
      // Backfill a Member login for any subject person that predates auto-accounts, so every household
      // subject is switchable by the Owner (roles refactor 2026-06-15). Idempotent + cheap after the
      // first (writes only when an account is genuinely missing). Best-effort: a transient vault-write
      // failure (e.g. an iCloud sync race) must NOT break a plain `access:get` read — degrade to the
      // current view and let a later call backfill once the write succeeds.
      try {
        const subjects = (await listPeople(ctx.fs, ctx.key))
          .filter((p) => p.isSubject)
          .map((p) => p.id);
        await ensureMemberAccounts(ctx.fs, ctx.key, subjects);
      } catch {
        // swallowed — the backfill retries on the next access:get
      }
      return getAccessView(ctx.fs, ctx.key);
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
      await ensureDeviceRegistered(ctx.fs, ctx.key);
      return { ok: true };
    },

    // --- Session ---
    sessionSetActive: async (input): Promise<SetActiveResult> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) return { ok: false, reason: 'NO_ACCOUNT' };
      const { personId, pin } = SetActiveSchema.parse(input);
      const person = await getPerson(ctx.fs, ctx.key, personId);
      if (!person) return { ok: false, reason: 'NO_ACCOUNT' };
      // The Owner (the full-access role) can switch to ANY household person with no PIN — even one whose
      // own login has a PIN set (god-mode switching, 2026-06-15). Everyone else must pass the target's PIN.
      if (!(await activePersonIsOwner(ctx.fs, ctx.key))) {
        if (!(await verifyAccountPin(ctx.fs, ctx.key, personId, pin ?? ''))) {
          return { ok: false, reason: 'WRONG_PIN' };
        }
      }
      await host.updateDeviceState({ activePersonId: personId });
      return { ok: true, person };
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
      const none: BudgetState = {
        state: 'none',
        budgetRatio: 0,
        spentUsd: 0,
        limitUsd: null,
        period: null,
      };
      const ctx = await host.vaultAndKey();
      if (!ctx) return { person: none, app: none };
      const now = new Date();
      const personId = await activePersonId();
      const person = personId
        ? await checkBudget(ctx.fs, ctx.key, { scope: 'person', personId, now })
        : none;
      const app = await checkBudget(ctx.fs, ctx.key, { scope: 'app', now });
      // $ is admin-only (the budgets.manage gate). A non-admin gets only `budgetRatio` (+ state/period)
      // for their OWN budget — never the dollars over IPC — and nothing about the household app budget
      // (the "Everyone" scope is admin-only too). Mirrors usage:summary / usage:sessionCosts redaction.
      const canManage = await activePersonCan(ctx.fs, ctx.key, 'budgets.manage');
      if (canManage) return { person, app };
      const ratioOnly = (b: BudgetState): BudgetState => ({
        state: b.state,
        budgetRatio: b.budgetRatio,
        period: b.period,
      });
      return { person: ratioOnly(person), app: none };
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
        status: conversationStatus(c),
        ...(c.guideId ? { guideId: c.guideId } : {}),
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
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      // 29 §3.5 — the in-session depth ask (setting `intake.inSessionDepthAsk`, default ON). When on, hand the
      // turn the person's unexplored invited sections so the coach may gently invite ONE (prompt-level,
      // relevance-gated). Adult (18+) sections are withheld until the shared ack; restricted-but-not-adult
      // areas stay in the list but the instruction only raises them if the person opens that door (§8).
      const depthAskOn =
        (await readVaultSettingsValues(ctx.fs))['intake.inSessionDepthAsk'] !== false;
      let depthAsk: { sections: ReturnType<typeof unfilledInvitedSections> } | undefined;
      if (depthAskOn) {
        const session = await getIntakeSession(ctx.fs, ctx.key, personId);
        const prefs = await getGuidancePrefs(ctx.fs, ctx.key, personId);
        const adultAcked = prefs.adultAcknowledged === true;
        const sections = unfilledInvitedSections(session).filter((s) => !s.adult || adultAcked);
        if (sections.length > 0) depthAsk = { sections };
      }
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
        ...(depthAsk ? { depthAsk } : {}),
        now: new Date(),
      });
    },

    // --- Session lifecycle + analysis (09-session-analysis §14) — gated by `sessions.own` ---
    sessionsSetStatus: async (input): Promise<ConversationMeta | null> => {
      const { conversationId, status } = SessionSetStatusSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own')))
        return null;
      const updated = await setSessionStatus({
        fs: ctx.fs,
        key: ctx.key,
        personId,
        conversationId,
        status,
        now: new Date(),
      });
      return updated
        ? {
            id: updated.id,
            title: updated.title,
            updatedAt: updated.updatedAt,
            status: conversationStatus(updated),
          }
        : null;
    },
    sessionsEndAndSummarize: async (input): Promise<SessionSummaryResult> => {
      const { conversationId } = ChatConversationIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      // The session-memory master toggle lives in vault settings (default ON); the service refuses when off.
      const memoryEnabled =
        (await readVaultSettingsValues(ctx.fs))['sessions.memoryEnabled'] !== false;
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      // 29 — hand the analysis the person's intake session so the same (paid) pass can detect an unexplored
      // profile area and emit a depth invitation for free.
      const intakeSession = await getIntakeSession(ctx.fs, ctx.key, personId);
      return endAndSummarize({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        conversationId,
        memoryEnabled,
        intakeSession,
        now: new Date(),
      });
    },
    // --- Guided sessions (16-guided-sessions §6) — gated by `sessions.own` ---
    sessionsStartGuided: async (input): Promise<{ conversationId: string } | null> => {
      const { guideId } = StartGuidedSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own'))) {
        return null;
      }
      return startGuided({ fs: ctx.fs, key: ctx.key, personId, guideId, now: new Date() });
    },
    guidedGetState: async (): Promise<GuidanceState> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own'))) {
        return { cache: null, adultAcknowledged: false };
      }
      return getGuidanceState(ctx.fs, ctx.key, personId);
    },
    guidedSuggest: async (): Promise<GuidedSuggestResult> => {
      // Reuses the gap-finder deps (budget + metering + key-in-main), gated on `sessions.own`.
      const deps = await aiDeps('sessions.own');
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      // The Intimacy group is excluded from suggestions until the 18+ ack (§8.3).
      const prefs = await getGuidancePrefs(deps.fs, deps.key, deps.personId);
      return suggestGuidedSessions(deps, { adultAllowed: prefs.adultAcknowledged === true });
    },
    guidedAcknowledgeAdult: async (): Promise<GuidanceState> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'sessions.own'))) {
        return { cache: null, adultAcknowledged: false };
      }
      await acknowledgeAdult(ctx.fs, ctx.key, personId);
      return getGuidanceState(ctx.fs, ctx.key, personId);
    },
    usageSessionCosts: async (): Promise<Record<string, SessionCost>> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId) return {};
      // Lifetime usage for the active person, rolled up per session (chat turns + any session.analyze).
      const events = await queryUsage(ctx.fs, ctx.key, {
        from: '0000',
        to: '9999',
        personId,
      });
      const rollup = rollupSessionCosts(events);
      // $ is admin-only (the budgets.manage gate). Everyone gets `budgetRatio` — a fraction, no $ leaked.
      const showCost = await activePersonCan(ctx.fs, ctx.key, 'budgets.manage');
      const budget = await effectivePersonBudget(ctx.fs, ctx.key, personId);
      const limit = budget.limitUsd > 0 ? budget.limitUsd : null;
      const out: Record<string, SessionCost> = {};
      for (const [id, { tokens, costUsd }] of Object.entries(rollup)) {
        out[id] = {
          tokens,
          ...(showCost ? { costUsd } : {}),
          ...(limit !== null ? { budgetRatio: Math.min(1, costUsd / limit) } : {}),
        };
      }
      return out;
    },

    // --- Questionnaires (08-questionnaires) — gated by `questionnaires.create` ---
    questionnairesList: async (): Promise<Questionnaire[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return [];
      return listQuestionnaires(ctx.fs, ctx.key);
    },
    questionnairesSendStates: async (): Promise<Record<string, QuestionnaireSendState>> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return {};
      const personId = await activePersonId();
      if (!personId) return {};
      // The active person's own sends, aggregated by questionnaire — latest send time + count. Pure
      // metadata for the list's "Sent · <date>" badge (08 §17.14); no answers or recipient detail.
      const sends = await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId });
      const states: Record<string, QuestionnaireSendState> = {};
      for (const a of sends) {
        const prev = states[a.questionnaireId];
        states[a.questionnaireId] = {
          lastSentAt: prev && prev.lastSentAt > a.createdAt ? prev.lastSentAt : a.createdAt,
          total: (prev?.total ?? 0) + 1,
        };
      }
      return states;
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
      // Owner (people.manage) purge a questionnaire + everything downstream at any stage
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

    // --- Owner-extensible intimacy topics (08-questionnaires §16.5a). Read = any author; add/remove are
    //     owner-only (people.manage) since the lists are household-wide. The boundary is enforced by the
    //     generation prompt + the model (the Owner is the full-access, trusted role), not a keyword filter.
    questionnairesIntimacyTopics: async (): Promise<IntimacyTopicsView> => {
      const ctx = await host.vaultAndKey();
      const empty: IntimacyTopicsView = {
        builtIn: { activities: [], fantasies: [] },
        custom: { activities: [], fantasies: [] },
      };
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) return empty;
      return {
        builtIn: { activities: [...INTIMACY_ACTIVITIES], fantasies: [...INTIMACY_FANTASIES] },
        custom: await readCustomIntimacyTopics(ctx.fs),
      };
    },
    questionnairesAddIntimacyTopic: async (input): Promise<IntimacyTopicsView> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))) {
        throw new Error('Not permitted');
      }
      const { kind, name } = IntimacyTopicSchema.parse(input);
      const builtIns = kind === 'activities' ? INTIMACY_ACTIVITIES : INTIMACY_FANTASIES;
      await addCustomIntimacyTopic(ctx.fs, kind, name, builtIns);
      return {
        builtIn: { activities: [...INTIMACY_ACTIVITIES], fantasies: [...INTIMACY_FANTASIES] },
        custom: await readCustomIntimacyTopics(ctx.fs),
      };
    },
    questionnairesRemoveIntimacyTopic: async (input): Promise<IntimacyTopicsView> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))) {
        throw new Error('Not permitted');
      }
      const { kind, name } = IntimacyTopicSchema.parse(input);
      await removeCustomIntimacyTopic(ctx.fs, kind, name);
      return {
        builtIn: { activities: [...INTIMACY_ACTIVITIES], fantasies: [...INTIMACY_FANTASIES] },
        custom: await readCustomIntimacyTopics(ctx.fs),
      };
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
      if (!ctx) return null;
      const path = z.string().parse(imagePath);
      // An author (`create`) reads any media for the builder/preview. A recipient (`answer`) may read ONLY
      // images referenced by a questionnaire actually sent TO THEM — so they can see author images in the
      // Inbox without being able to enumerate the household's media (the bridge is the trust boundary).
      if (!(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) {
        const personId = await activePersonId();
        if (!personId || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.answer'))) {
          return null;
        }
        const mine = await listAssignments(ctx.fs, ctx.key, { recipientPersonId: personId });
        let referenced = false;
        for (const a of mine) {
          const snapshot = await getAssignmentSnapshot(ctx.fs, ctx.key, a.id);
          if (snapshot?.questions.some((q) => q.media?.imagePath === path)) {
            referenced = true;
            break;
          }
        }
        if (!referenced) return null;
      }
      const bytes = await getQuestionnaireImage(ctx.fs, ctx.key, path);
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
      // The bound recipient (08 §17.12) drives BOTH (a) relevance — auto-tailor to the recipient's *shareable*
      // context (their profile/relationship/shareable insights, the §13.3 boundary) so questions fit the person
      // they're for, and (b) de-dup — their FULL answered content as avoid-only grounding (§17.4), gathered
      // host-side, never returned to the author. Only a HOUSEHOLD recipient has this context; an external one
      // has neither, so both are skipped. There is no separate "about a person" picker (§17.12-A).
      const recipientIsHousehold =
        p.recipientPersonId !== undefined &&
        (await getPerson(deps.fs, deps.key, p.recipientPersonId)) !== null;
      const recipientHistory = recipientIsHousehold
        ? await gatherRecipientHistory(deps.fs, deps.key, p.recipientPersonId as string)
        : '';
      return generateQuestions(deps, {
        type: p.type,
        sensitivity: p.sensitivity,
        ...(p.brief !== undefined ? { brief: p.brief } : {}),
        context: {
          authorPersonId: deps.personId,
          // The author's own shareable data always feeds (§15.4); the recipient's shareable context tailors.
          includeAuthor: true,
          ...(recipientIsHousehold ? { targetPersonId: p.recipientPersonId as string } : {}),
          includeTarget: recipientIsHousehold,
          includeRelationship: recipientIsHousehold,
        },
        existingPrompts: p.existingPrompts,
        ...(recipientHistory ? { recipientHistory } : {}),
        ...(p.intimacyMode !== undefined ? { intimacyMode: p.intimacyMode } : {}),
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

    // --- Memory / insights (20-memory-dashboard §5.1/§6) — gated by `memory.own`, active-person-scoped.
    // The trust boundary (spec 20 §1.1): the dashboard returns ONLY the active person's own insights +
    // their relationships' shareable, non-restricted facts — NEVER `listAllInsights` (the cross-user leak). ---
    insightsList: async (): Promise<Insight[]> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return [];
      const personId = await activePersonId();
      if (!personId) return [];
      // Own insights in full — the user sees ALL their own facts, INCLUDING their own `restricted` intake
      // facts (their own data). Never another member's insights.
      const own = await listInsightsForPerson(ctx.fs, ctx.key, personId);
      // Related people contribute ONLY their shareable, non-restricted facts (the `summarizeForContext`
      // boundary, re-gated at read via `listRelatedPeople`); their summaries + private/restricted facts
      // never cross over.
      const related = await listRelatedPeople(ctx.fs, ctx.key, personId);
      const relatedShareable = await listRelatedShareableInsights(
        ctx.fs,
        ctx.key,
        personId,
        related,
      );
      return [...own, ...relatedShareable];
    },
    insightsAnalyze: async (input): Promise<QuestionnaireAnalyzeResult> => {
      const deps = await aiDeps('questionnaires.viewResults');
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      return analyzeAssignment(deps, AnalyzeSchema.parse(input));
    },
    insightsApprove: async (input): Promise<Insight | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return null;
      const p = InsightEditSchema.parse(input);
      // A person can only ever approve/edit their OWN insight (the subject is always the active person —
      // the sender for a questionnaire/compatibility draft, the dreamer/intaker otherwise). Reject any other
      // subject so a member can't reach into another's memory by passing their id (spec 20 §6).
      if (p.subjectPersonId !== (await activePersonId())) return null;
      return updateInsight(ctx.fs, ctx.key, p.subjectPersonId, p.id, {
        approved: true,
        ...(p.summary !== undefined ? { summary: p.summary } : {}),
        ...(p.facts !== undefined ? { facts: p.facts } : {}),
      });
    },
    insightsUpdate: async (input): Promise<Insight | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return null;
      const p = InsightEditSchema.parse(input);
      if (p.subjectPersonId !== (await activePersonId())) return null;
      return updateInsight(ctx.fs, ctx.key, p.subjectPersonId, p.id, {
        ...(p.summary !== undefined ? { summary: p.summary } : {}),
        ...(p.facts !== undefined ? { facts: p.facts } : {}),
      });
    },
    insightsDelete: async (input): Promise<void> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return;
      const { subjectPersonId, id } = InsightIdSchema.parse(input);
      if (subjectPersonId !== (await activePersonId())) return;
      await deleteInsight(ctx.fs, subjectPersonId, id);
    },
    insightsFlag: async (input): Promise<Insight | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'memory.own'))) return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const p = InsightFlagSchema.parse(input);
      // flagInsightFact loads the ACTIVE person's own insight by id — a person can only flag their own.
      return flagInsightFact(
        ctx.fs,
        ctx.key,
        personId,
        p.insightId,
        p.factId ?? null,
        p.flagged,
        new Date(),
      );
    },
    memoryRefresh: async (): Promise<MemoryReconcileResult> => {
      // Reuse the AI-deps assembly (gates on `memory.own`, reads the key host-side, never to the renderer).
      const deps = await aiDeps('memory.own');
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      return reconcileInsights(deps);
    },
    assignmentsCreate: async (input): Promise<InAppSendResult> => {
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.create'))) {
        throw new Error('Not permitted');
      }
      const personId = await activePersonId();
      if (!personId) throw new Error('No active person');
      const { questionnaireId, privacy, senderVisibleToRecipient, expiresAt } =
        AssignmentsCreateSchema.parse(input);
      // The recipient is BOUND to the questionnaire at creation (08 §17.3) — the sender never re-picks it.
      // An in-app send requires a household recipient; an external-bound questionnaire goes via the relay.
      const def = await getQuestionnaire(ctx.fs, ctx.key, questionnaireId);
      if (!def) throw new Error('Questionnaire not found');
      if (def.recipient?.kind !== 'person') {
        throw new Error(
          'This questionnaire is addressed to someone outside the household — use the link.',
        );
      }
      const recipientPersonId = def.recipient.personId;
      // The bound recipient must still be a real household person, so we never persist a dangling,
      // unanswerable send (a self-send is allowed — self check-ins are a valid use).
      if (!(await getPerson(ctx.fs, ctx.key, recipientPersonId))) {
        throw new Error('Recipient not found');
      }
      const senderVisible = senderVisibleToRecipient ?? true;
      const assignment = await createAssignment(ctx.fs, ctx.key, {
        questionnaireId,
        senderPersonId: personId,
        recipient: { kind: 'person' as const, personId: recipientPersonId },
        channel: 'inApp',
        privacy: privacy ?? 'standard',
        senderVisibleToRecipient: senderVisible,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      });

      // 08 §17.13 — unified delivery: ALSO mint a relay link so the recipient can answer in their Inbox OR
      // anywhere via the link. Only when the sender can deliver externally AND a relay is connected;
      // otherwise the send is Inbox-only (the graceful fallback — the app works without Cloudflare).
      const config = (await activePersonCan(ctx.fs, ctx.key, 'questionnaires.sendExternal'))
        ? await readRelayConfig(ctx.fs, ctx.key)
        : null;
      if (!config) return { assignment };
      const senderName = (await getPerson(ctx.fs, ctx.key, personId))?.displayName ?? 'Someone';
      const client = createRelayHttpClient(
        config.endpointUrl,
        config.drainSecret,
        host.relay.fetch,
      );
      try {
        const { link, pin } = await attachRelayLink(ctx.fs, ctx.key, client, assignment.id, {
          senderName,
          senderVisibleToRecipient: senderVisible,
          disclosure: externalSendDisclosure(
            senderVisible ? senderName : 'the person who sent this',
            privacy ?? 'standard',
          ),
          endpointUrl: config.endpointUrl,
          ...(expiresAt !== undefined ? { expiresAt } : {}),
        });
        return {
          assignment: (await getAssignment(ctx.fs, ctx.key, assignment.id)) ?? assignment,
          link,
          pin,
        };
      } catch (e) {
        // A relay IS connected but minting failed — surface it (don't swallow): the in-app send stands,
        // but the sender should know the link didn't go out and can retry from Results (§17.14a).
        return {
          assignment,
          linkError: e instanceof Error ? e.message : 'The relay couldn’t be reached.',
        };
      }
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
        // The participant context for the disclosure (§16.1): this recipient is one participant; find the
        // OTHER member of the group and whether this recipient is themselves the sender.
        const group = (await listAssignments(fs, key)).filter(
          (a) => a.compatibilityGroupId === assignment.compatibilityGroupId,
        );
        const other = group.find((a) => a.id !== assignment.id);
        const otherParticipantName =
          other && other.recipient.kind === 'person'
            ? ((await getPerson(fs, key, other.recipient.personId))?.displayName ??
              'the other person')
            : 'the other person';
        const viewerIsSender =
          assignment.recipient.kind === 'person' &&
          assignment.recipient.personId === assignment.senderPersonId;
        compatibility = {
          visibility,
          report,
          otherParticipantName,
          viewerIsSender,
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
      // 08 §17.13 first-wins: if this send also has a relay link, close its mailbox so the link can't be
      // answered again on the other surface (best-effort; the drain guard is the backstop).
      const assignment = await getAssignment(resolved.fs, resolved.key, assignmentId);
      if (assignment?.relay) {
        const config = await readRelayConfig(resolved.fs, resolved.key);
        if (config) {
          const client = createRelayHttpClient(
            config.endpointUrl,
            config.drainSecret,
            host.relay.fetch,
          );
          await revokeRelayForDeletion(resolved.fs, resolved.key, client, assignmentId);
        }
      }
    },
    assignmentsDecline: async (input): Promise<void> => {
      const { assignmentId, note } = DeclineSchema.parse(input);
      const resolved = await recipientAssignment(assignmentId);
      if (!resolved) throw new Error('Not permitted');
      await declineAssignment(resolved.fs, resolved.key, {
        assignmentId,
        ...(note !== undefined ? { note } : {}),
      });
      // Close the relay link too, if any (§17.13) — a declined send shouldn't stay answerable via the link.
      const assignment = await getAssignment(resolved.fs, resolved.key, assignmentId);
      if (assignment?.relay) {
        const config = await readRelayConfig(resolved.fs, resolved.key);
        if (config) {
          const client = createRelayHttpClient(
            config.endpointUrl,
            config.drainSecret,
            host.relay.fetch,
          );
          await revokeRelayForDeletion(resolved.fs, resolved.key, client, assignmentId);
        }
      }
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
          relayLinked: Boolean(a.relay),
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
      // Only the send's own sender (or the Owner) may delete it + its derived Insight.
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
      const { questionnaireId } = CompatibilityCreateSchema.parse(input);
      const canonical = await getQuestionnaire(deps.fs, deps.key, questionnaireId);
      if (!canonical?.compatibility?.enabled) {
        return {
          ok: false,
          reason: 'INVALID',
          message: 'This isn’t a compatibility questionnaire.',
        };
      }
      // The participants are the sender + the BOUND recipient (08 §17.12-B), derived from the questionnaire.
      const recipient = canonical.recipient;
      if (!recipient) {
        return { ok: false, reason: 'INVALID', message: 'This questionnaire has no recipient.' };
      }
      const visibility = canonical.compatibility.visibility;
      const senderPerson = await getPerson(deps.fs, deps.key, deps.personId);
      const senderName = senderPerson?.displayName ?? 'Someone';
      // Each participant's gender drives the OTHER person's pronouns in their variant (§17.14e) — so a man
      // asked about his female partner reads "her", never "him".
      const senderGender = senderPerson?.gender;

      // Resolve the OTHER participant up front: each person's variant must ask about the OTHER one (08
      // §17.12 — the recipient was being asked about themselves, not the sender). For a household person,
      // validate it exists + isn't the sender; for an external recipient, it's their given name.
      let otherName: string;
      let otherGender: string | undefined;
      if (recipient.kind === 'person') {
        if (recipient.personId === deps.personId) {
          return {
            ok: false,
            reason: 'INVALID',
            message: 'You can’t compare yourself with yourself.',
          };
        }
        const rp = await getPerson(deps.fs, deps.key, recipient.personId);
        if (!rp)
          return { ok: false, reason: 'INVALID', message: 'A chosen person no longer exists.' };
        otherName = rp.displayName;
        otherGender = rp.gender;
      } else {
        // An external recipient nearly always has a name; fall back to a warm placeholder, not "them".
        otherName = recipient.displayName ?? 'your partner';
      }

      // The sender's own variant — written TO the sender, ABOUT the other participant; their own full context.
      const senderVariant = await generateVariant(deps, {
        forName: senderName,
        ...(senderGender ? { forGender: senderGender } : {}),
        aboutName: otherName,
        ...(otherGender ? { aboutGender: otherGender } : {}),
        questions: canonical.questions,
        targetContext: {
          authorPersonId: deps.personId,
          includeAuthor: true,
          includeTarget: false,
          includeRelationship: false,
        },
      });
      if (!senderVariant.ok || !senderVariant.questions) {
        return {
          ok: false,
          reason: senderVariant.reason ?? 'ERROR',
          message: senderVariant.message ?? 'Could not personalize.',
        };
      }

      if (recipient.kind === 'person') {
        // --- Household: two paired in-app sends (sender + the recipient) ---
        const recipientPersonId = recipient.personId;
        // The recipient's variant — written TO them, ABOUT the sender; their SHAREABLE context only (§13.3).
        const recipientVariant = await generateVariant(deps, {
          forName: otherName,
          ...(otherGender ? { forGender: otherGender } : {}),
          aboutName: senderName,
          ...(senderGender ? { aboutGender: senderGender } : {}),
          questions: canonical.questions,
          targetContext: {
            authorPersonId: deps.personId,
            includeAuthor: false,
            targetPersonId: recipientPersonId,
            includeTarget: true,
            includeRelationship: true,
          },
        });
        if (!recipientVariant.ok || !recipientVariant.questions) {
          return {
            ok: false,
            reason: recipientVariant.reason ?? 'ERROR',
            message: recipientVariant.message ?? 'Could not personalize.',
          };
        }
        const compatibilityGroupId = await createCompatibilitySend(deps.fs, deps.key, {
          questionnaireId,
          senderPersonId: deps.personId,
          visibility,
          recipients: [
            { personId: deps.personId, questions: senderVariant.questions },
            { personId: recipientPersonId, questions: recipientVariant.questions },
          ],
        });
        // Unified delivery (§17.14): also mint a relay link for the RECIPIENT's variant so a household
        // recipient can answer in their Inbox OR via a link + email/SMS — exactly like an external send.
        // The sender answers their OWN variant in-app, so no link is minted for the sender's member. Only
        // when the sender can deliver externally AND a relay is connected (else Inbox-only, graceful).
        const config = (await activePersonCan(deps.fs, deps.key, 'questionnaires.sendExternal'))
          ? await readRelayConfig(deps.fs, deps.key)
          : null;
        if (!config) return { ok: true, compatibilityGroupId };
        const recipientMember = (
          await listAssignments(deps.fs, deps.key, { senderPersonId: deps.personId })
        ).find(
          (a) =>
            a.compatibilityGroupId === compatibilityGroupId &&
            a.recipient.kind === 'person' &&
            a.recipient.personId === recipientPersonId,
        );
        if (!recipientMember) {
          // A relay is connected but we can't find the recipient's just-created member to attach a link —
          // surface it (don't fall back to a silent no-link), matching the mint-failure path below.
          return {
            ok: true,
            compatibilityGroupId,
            linkError: 'Couldn’t prepare the share link. Open Results to add one.',
          };
        }
        const client = createRelayHttpClient(
          config.endpointUrl,
          config.drainSecret,
          host.relay.fetch,
        );
        try {
          const { link, pin } = await attachRelayLink(
            deps.fs,
            deps.key,
            client,
            recipientMember.id,
            {
              senderName,
              senderVisibleToRecipient: true,
              // The recipient is told (from their POV) who's comparing them — the sender (§16.1).
              disclosure: compatibilityDisclosure(visibility, {
                otherParticipantName: senderName,
                senderName,
                viewerIsSender: false,
              }),
              endpointUrl: config.endpointUrl,
            },
          );
          return { ok: true, compatibilityGroupId, link, pin };
        } catch (e) {
          // A relay IS connected but minting failed (e.g. the relay is unreachable / its deploy is stale).
          // The in-app paired sends still stand, but DON'T swallow it: surface a linkError so the sender
          // sees the link didn't go out and can retry from Results, instead of a silent Inbox-only state.
          return {
            ok: true,
            compatibilityGroupId,
            linkError: e instanceof Error ? e.message : 'The relay couldn’t be reached.',
          };
        }
      }

      // --- External (relay): the sender answers in-app + the recipient answers via the relay (08 §17.12-B) ---
      if (!(await activePersonCan(deps.fs, deps.key, 'questionnaires.sendExternal'))) {
        return { ok: false, reason: 'DENIED', message: 'You can’t send external links.' };
      }
      const relayConfig = await readRelayConfig(deps.fs, deps.key);
      if (!relayConfig) {
        return {
          ok: false,
          reason: 'INVALID',
          message: 'No relay is connected. Ask an admin to set one up in Settings → Relay.',
        };
      }
      // The external recipient's variant — written TO them, ABOUT the sender (no household context to draw on).
      const externalVariant = await generateVariant(deps, {
        forName: otherName,
        // An external recipient has no stored gender → their variant refers to the sender by name/their
        // gender, and to the external person by name (no pronoun assumed).
        aboutName: senderName,
        ...(senderGender ? { aboutGender: senderGender } : {}),
        questions: canonical.questions,
        targetContext: {
          authorPersonId: deps.personId,
          includeAuthor: false,
          includeTarget: false,
          includeRelationship: false,
        },
      });
      if (!externalVariant.ok || !externalVariant.questions) {
        return {
          ok: false,
          reason: externalVariant.reason ?? 'ERROR',
          message: externalVariant.message ?? 'Could not personalize.',
        };
      }
      const compatibilityGroupId = uuid();
      // The sender's in-app member.
      await writeCompatibilityMember(deps.fs, deps.key, {
        canonical,
        senderPersonId: deps.personId,
        participantPersonId: deps.personId,
        questions: senderVariant.questions,
        visibility,
        compatibilityGroupId,
      });
      // The external recipient's relay member — the recipient is told who's comparing (the sender).
      const disclosure = compatibilityDisclosure(visibility, {
        otherParticipantName: senderName,
        senderName,
        viewerIsSender: false,
      });
      const client = createRelayHttpClient(
        relayConfig.endpointUrl,
        relayConfig.drainSecret,
        host.relay.fetch,
      );
      const { link, pin } = await createRelaySend(deps.fs, deps.key, client, {
        questionnaireId,
        senderPersonId: deps.personId,
        senderName,
        recipient: {
          kind: 'external',
          ...(recipient.displayName !== undefined ? { displayName: recipient.displayName } : {}),
          ...(recipient.email !== undefined ? { email: recipient.email } : {}),
          ...(recipient.phone !== undefined ? { phone: recipient.phone } : {}),
        },
        senderVisibleToRecipient: true,
        privacy: 'private',
        disclosure,
        endpointUrl: relayConfig.endpointUrl,
        variant: externalVariant.questions,
        compatibilityGroupId,
      });
      return { ok: true, compatibilityGroupId, link, pin };
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
      // "Processed" groups: a report Insight (subject = sender) for the report modes, OR the per-participant
      // context Insights for a `contextOnly` group (subject = each participant) — so scan ALL insights for
      // the group id, not just the sender's (§16.2). These are the sender's own groups, so no privacy gap.
      const insightGroups = new Set(
        (await listAllInsights(ctx.fs, ctx.key)).flatMap((i) =>
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
            channel: a.channel,
            relayLinked: Boolean(a.relay),
            // The sender's own member answers in-app — never a link to share.
            isSelf: a.recipient.kind === 'person' && a.recipient.personId === personId,
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
      // A contextOnly group produces NO report — it's distilled per-participant via the dedicated path.
      const first = group[0];
      const snapshot = first ? await getAssignmentSnapshot(deps.fs, deps.key, first.id) : null;
      if (snapshot?.compatibility?.visibility === 'contextOnly') {
        return { ok: false, reason: 'DENIED', message: 'This is a context-only send.' };
      }
      return generateAlignment(deps, { compatibilityGroupId: groupId });
    },
    assignmentsDistillContextOnly: async (compatibilityGroupId): Promise<ContextOnlyResult> => {
      const deps = await aiDeps('questionnaires.viewResults');
      if (!deps) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      const groupId = GroupIdSchema.parse(compatibilityGroupId);
      // Sender-scoped: only the sender of the group may run the distillation (they pay for it).
      const group = await getCompatibilityGroup(deps.fs, deps.key, groupId);
      if (group.length === 0 || group.some((a) => a.senderPersonId !== deps.personId)) {
        return { ok: false, reason: 'DENIED', message: 'Not available.' };
      }
      const first = group[0];
      const snapshot = first ? await getAssignmentSnapshot(deps.fs, deps.key, first.id) : null;
      if (snapshot?.compatibility?.visibility !== 'contextOnly') {
        return { ok: false, reason: 'DENIED', message: 'This isn’t a context-only send.' };
      }
      return distillContextOnly(deps, { compatibilityGroupId: groupId });
    },
    assignmentsPublishCompatResult: async (compatibilityGroupId): Promise<CompatResultPublish> => {
      // Push the generated alignment report back to the EXTERNAL recipient(s) of a compatibility group,
      // sealed under each one's content key so the relay page shows it (08 §17.12-D). Sender-scoped; needs
      // the report already generated. contextOnly isn't offered for external, so it never reaches here.
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.viewResults'))) {
        return { ok: false, reason: 'DENIED', message: 'Not available.' };
      }
      const personId = await activePersonId();
      if (!personId) return { ok: false, reason: 'DENIED', message: 'Not available.' };
      const groupId = GroupIdSchema.parse(compatibilityGroupId);
      const group = await getCompatibilityGroup(ctx.fs, ctx.key, groupId);
      if (group.length === 0 || group.some((a) => a.senderPersonId !== personId)) {
        return { ok: false, reason: 'DENIED', message: 'Not available.' };
      }
      const externals = group.filter((a) => a.channel === 'relay' && a.relay);
      if (externals.length === 0) {
        return {
          ok: false,
          reason: 'INVALID',
          message: 'There’s no external recipient to share with.',
        };
      }
      const report = await getAlignmentReport(ctx.fs, ctx.key, groupId);
      if (!report) {
        return { ok: false, reason: 'NOT_READY', message: 'Generate the report first.' };
      }
      const config = await readRelayConfig(ctx.fs, ctx.key);
      if (!config) {
        return { ok: false, reason: 'INVALID', message: 'No relay is connected.' };
      }
      const senderName = (await getPerson(ctx.fs, ctx.key, personId))?.displayName ?? 'them';
      // From the recipient's point of view the "other" participant is the sender. Every external-eligible
      // visibility (sharedReport / eachSeesOwn / senderSeesAll) gives the recipient the combined report.
      const result: RelayResult = {
        schemaVersion: 1,
        kind: 'report',
        headline: `How you and ${senderName} compare`,
        summary: report.summary,
        items: report.items,
        generatedAt: report.generatedAt,
      };
      const client = createRelayHttpClient(
        config.endpointUrl,
        config.drainSecret,
        host.relay.fetch,
      );
      let published = 0;
      let unsupported = 0; // a send minted before the wrapped content key existed (can't write back)
      for (const member of externals) {
        try {
          if (await publishRelayResult(ctx.fs, ctx.key, client, member.id, result)) published += 1;
          else unsupported += 1;
        } catch {
          // A relay the app can't reach right now is skipped; the sender can retry (idempotent).
        }
      }
      if (published === 0) {
        // Distinguish "this link predates result-sharing" from a transport failure, so the message is honest.
        return unsupported === externals.length
          ? {
              ok: false,
              reason: 'INVALID',
              message: 'This link was created before sharing results was supported.',
            }
          : {
              ok: false,
              reason: 'ERROR',
              message: 'Couldn’t reach the relay to share the results.',
            };
      }
      return { ok: true, published };
    },
    assignmentsRevealRaw: async (assignmentId): Promise<SendAnswer[] | null> => {
      const ctx = await host.vaultAndKey();
      if (!ctx) return null;
      const id = AssignmentIdSchema.parse(assignmentId);
      const assignment = await getAssignment(ctx.fs, ctx.key, id);
      if (!assignment) return null;
      const personId = await activePersonId();
      const snapshot = await getAssignmentSnapshot(ctx.fs, ctx.key, assignment.id);
      // Who may read a Private send's raw answers: the Owner (full-access role — any send), OR the sender of
      // a `senderSeesAll` compatibility send holding the granted `questionnaires.readRaw`. Nothing else.
      // (The super-admin concept + the break-glass audit log were removed 2026-06-15.)
      let permitted = await activePersonIsOwner(ctx.fs, ctx.key);
      if (!permitted && assignment.senderPersonId === personId && assignment.compatibilityGroupId) {
        permitted =
          snapshot?.compatibility?.visibility === 'senderSeesAll' &&
          (await activePersonCan(ctx.fs, ctx.key, 'questionnaires.readRaw'));
      }
      if (!permitted) return null;

      const response = await getResponse(ctx.fs, ctx.key, assignment.id);
      if (!snapshot || !response || response.submittedAt === undefined) return null;
      return formatResponseAnswers(snapshot.questions, response.answers);
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
      // The external recipient is BOUND to the questionnaire at creation (08 §17.3) — read it from the def.
      const def = await getQuestionnaire(ctx.fs, ctx.key, parsed.questionnaireId);
      if (!def) throw new Error('Questionnaire not found');
      if (def.recipient?.kind !== 'external') {
        throw new Error(
          'This questionnaire is addressed to someone in the household — send it in-app.',
        );
      }
      const bound = def.recipient;
      const sender = await getPerson(ctx.fs, ctx.key, personId);
      const senderName = sender?.displayName ?? 'Someone';
      const privacy = parsed.privacy ?? 'private';
      const senderVisible = parsed.senderVisibleToRecipient ?? true;
      const disclosure = externalSendDisclosure(
        senderVisible ? senderName : 'the person who sent this',
        privacy,
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
          ...(bound.displayName !== undefined ? { displayName: bound.displayName } : {}),
          ...(bound.email !== undefined ? { email: bound.email } : {}),
          ...(bound.phone !== undefined ? { phone: bound.phone } : {}),
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
      // Drain the active person's still-open sends that carry relay material — external links AND the
      // links attached to in-app household sends (08 §17.13). Submitted/declined/revoked/expired ones are
      // already drained or done, so re-draining them is wasted relay round-trips.
      const open = ['sent', 'opened', 'inProgress'];
      const sends = (await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId })).filter(
        (a) => a.relay && open.includes(a.status),
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
    assignmentsReshare: async (assignmentId): Promise<RelayLinkResult | null> => {
      // Re-publish a fresh link + PIN for an existing send (08 §17.14). We never store the PIN (only a
      // hash), so the original can't be re-shown — resharing mints a NEW link + PIN and revokes the old
      // mailbox so the previous link stops working. Sender-scoped + external-capable + relay connected.
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.sendExternal')))
        return null;
      const id = AssignmentIdSchema.parse(assignmentId);
      const assignment = await getAssignment(ctx.fs, ctx.key, id);
      if (!assignment) return null;
      const personId = await activePersonId();
      if (
        assignment.senderPersonId !== personId &&
        !(await activePersonCan(ctx.fs, ctx.key, 'people.manage'))
      ) {
        throw new Error('Not permitted');
      }
      // Never mint a link for the SENDER'S OWN member (they answer in-app), or for an already-answered
      // send. Key off the send's own sender (NOT the active person) so an admin resharing someone else's
      // group can't mint a link to the sender's full-context self-variant.
      if (
        assignment.recipient.kind === 'person' &&
        assignment.recipient.personId === assignment.senderPersonId
      ) {
        return null;
      }
      if (assignment.status === 'submitted' || assignment.status === 'declined') return null;
      const config = await readRelayConfig(ctx.fs, ctx.key);
      if (!config) return null;
      const client = createRelayHttpClient(
        config.endpointUrl,
        config.drainSecret,
        host.relay.fetch,
      );
      return reshareLink(ctx.fs, ctx.key, client, config.endpointUrl, assignment);
    },
    questionnairesShareLink: async (
      questionnaireId,
      regenerate,
    ): Promise<RelayLinkResult | null> => {
      // The shareable link + PIN for a SENT questionnaire (08 §17.14d) — at the top of the sent (locked)
      // preview + the list kebab, so the link stays reachable after sending without going to Results. By
      // default this RE-SHOWS the EXISTING link/PIN (no regeneration); `regenerate: true` (the manual
      // Refresh) mints a fresh one + revokes the old. Always the latest still-open RECIPIENT send (never
      // the sender's own self member).
      const ctx = await host.vaultAndKey();
      if (!ctx || !(await activePersonCan(ctx.fs, ctx.key, 'questionnaires.sendExternal')))
        return null;
      const personId = await activePersonId();
      if (!personId) return null;
      const qid = QuestionnaireIdSchema.parse(questionnaireId);
      const open = ['sent', 'opened', 'inProgress'];
      const candidate = (await listAssignments(ctx.fs, ctx.key, { senderPersonId: personId }))
        .filter(
          (a) =>
            a.questionnaireId === qid &&
            open.includes(a.status) &&
            // The shareable member is the RECIPIENT, never the sender's own (self) compat member.
            !(a.recipient.kind === 'person' && a.recipient.personId === a.senderPersonId),
        )
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
      if (!candidate) return null;
      const config = await readRelayConfig(ctx.fs, ctx.key);
      if (!config) return null;
      // Re-show the existing link unless a refresh was asked for (or the send predates stored PIN material).
      if (!regenerate) {
        const existing = await readRelayLink(ctx.fs, ctx.key, candidate.id, config.endpointUrl);
        if (existing) return existing;
      }
      const client = createRelayHttpClient(
        config.endpointUrl,
        config.drainSecret,
        host.relay.fetch,
      );
      return reshareLink(ctx.fs, ctx.key, client, config.endpointUrl, candidate);
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
      // deleteDream removes the dream folder but KEEPS its derived Insight (20-memory-dashboard §3.7) — an
      // insight is the coach's lasting memory and persists when its source is gone (its provenance link then
      // shows "source removed"). To remove the insight too, the dreamer uses Memory's explicit delete.
      await deleteDream(ctx.fs, personId, PersonIdSchema.parse(id));
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
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
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
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
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
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
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
    dreamGenerateImage: async (input): Promise<DreamImageResult> => {
      const { dreamId, style } = DreamGenerateImageSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.generateImage'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      // Consent + image model + default style are vault settings; both API keys are read host-side and
      // never cross to the renderer (the `anthropic.apiKey` rule, applied to the second provider).
      const settings = await readVaultSettingsValues(ctx.fs);
      const imageModel =
        typeof settings['dreams.imageModel'] === 'string'
          ? settings['dreams.imageModel']
          : 'gpt-image-2';
      const defaultStyle =
        typeof settings['dreams.imageStyle'] === 'string'
          ? settings['dreams.imageStyle']
          : 'dreamlike';
      // Settings-only free-text style direction (§15.2); blank ⇒ omitted so the prompt is unchanged.
      const styleNotes =
        typeof settings['dreams.imageStyleNotes'] === 'string'
          ? settings['dreams.imageStyleNotes'].trim()
          : '';
      const result = await generateDreamImage({
        fs: ctx.fs,
        key: ctx.key,
        claude: host.claude,
        image: host.image,
        anthropicApiKey: (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null,
        openaiApiKey: (await resolveOpenAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null,
        consent: settings['dreams.imageGenerationEnabled'] === true,
        claudeModel: await host.activeModel(),
        imageModel,
        style: style ?? defaultStyle,
        ...(styleNotes ? { styleNotes } : {}),
        personId,
        dreamId,
        now: new Date(),
      });
      if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
      // Cost ($) is admin-only (the budgets.manage gate, like everywhere else) — a non-admin's result
      // carries no cost figure. Combines the flat image charge + the small distillation charge.
      const showCost = await activePersonCan(ctx.fs, ctx.key, 'budgets.manage');
      return {
        ok: true,
        mime: result.mime,
        ...(showCost ? { costUsd: result.imageUsage.costUsd + result.promptUsage.costUsd } : {}),
      };
    },
    dreamGetImage: async (input): Promise<{ mime: string; dataBase64: string } | null> => {
      const { dreamId } = DreamIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.generateImage'))) {
        return null;
      }
      const image = await getDreamImage(ctx.fs, ctx.key, personId, dreamId);
      return image ? { mime: image.mime, dataBase64: toBase64(image.bytes) } : null;
    },
    dreamDeleteImage: async (input): Promise<void> => {
      const { dreamId } = DreamIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.generateImage'))) {
        return;
      }
      await deleteDreamImage(ctx.fs, ctx.key, personId, dreamId, new Date());
    },
    dreamExportImage: async (input): Promise<string | null> => {
      const { dreamId } = DreamIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.generateImage'))) {
        return null;
      }
      const image = await getDreamImage(ctx.fs, ctx.key, personId, dreamId);
      if (!image) return null;
      const ext =
        image.mime === 'image/webp' ? 'webp' : image.mime === 'image/jpeg' ? 'jpg' : 'png';
      // The bytes leave the encrypted vault by the dreamer's explicit choice (§3.5/§8.5).
      return host.saveImageFile(`dream-image.${ext}`, image.bytes, image.mime);
    },
    dreamSetImageShare: async (input): Promise<DreamShareResult> => {
      const { dreamId, targetPersonId, shared } = DreamSetImageShareSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      // Cross-person sharing is the privileged action — gated by `dreams.shareContext` (not `dreams.own`).
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'dreams.shareContext'))) {
        return { ok: false, reason: 'NOT_FOUND' };
      }
      return setDreamImageShare({
        fs: ctx.fs,
        key: ctx.key,
        dreamerId: personId,
        dreamId,
        targetPersonId,
        shared,
        now: new Date(),
      });
    },
    dreamGetSharedImage: async (input): Promise<{ mime: string; dataBase64: string } | null> => {
      const { dreamerId, dreamId } = DreamGetSharedImageSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const viewerId = ctx ? await activePersonId() : null;
      // Any signed-in person may read — the SHARE itself is the grant; the service re-gates relationship +
      // shareableWith + sensitivity at read time, so this can't reach an image not shared with the viewer.
      if (!ctx || !viewerId) return null;
      const image = await getSharedDreamImage(ctx.fs, ctx.key, viewerId, dreamerId, dreamId);
      return image ? { mime: image.mime, dataBase64: toBase64(image.bytes) } : null;
    },
    dreamListSharedImages: async (): Promise<DreamSharedImage[]> => {
      const ctx = await host.vaultAndKey();
      const viewerId = ctx ? await activePersonId() : null;
      if (!ctx || !viewerId) return [];
      return listImagesSharedWith(ctx.fs, ctx.key, viewerId);
    },

    // --- Personal onboarding (18-personal-onboarding §6) — gated by `intake.own`, active-person-scoped ---
    intakeGetState: async (): Promise<IntakeState> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) {
        return emptyIntakeState(personId ?? '');
      }
      return buildIntakeState(ctx.fs, ctx.key, personId);
    },
    intakeRunTurn: async (input): Promise<IntakeTurnResult> => {
      const { sectionId, userText } = IntakeRunTurnSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      // The API key is read host-side and never crosses to the renderer; deltas go to the dedicated intake
      // sink so they never mix with the Sessions / Dreams streams.
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      return runIntakeTurn({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        sectionId,
        userText,
        onDelta: (text) => host.emitIntakeChunk(text),
        now: new Date(),
      });
    },
    intakeSkipSection: async (input): Promise<IntakeState> => {
      const { sectionId } = IntakeSectionIdSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) {
        return emptyIntakeState(personId ?? '');
      }
      await skipIntakeSection(ctx.fs, ctx.key, personId, sectionId, new Date());
      return buildIntakeState(ctx.fs, ctx.key, personId);
    },
    intakeSubmitForm: async (input): Promise<IntakeState> => {
      const { sectionId, answers } = IntakeSubmitFormSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) {
        return emptyIntakeState(personId ?? '');
      }
      // An adult-gated section (intimacy) requires the shared 18+ acknowledgement — enforced HERE (the bridge
      // is the trust boundary, not the renderer). Without it, the submit is a no-op.
      const def = getIntakeSection(sectionId);
      if (def?.adult) {
        const prefs = await getGuidancePrefs(ctx.fs, ctx.key, personId);
        if (prefs.adultAcknowledged !== true) return buildIntakeState(ctx.fs, ctx.key, personId);
      }
      await submitSectionForm(ctx.fs, ctx.key, personId, sectionId, answers, new Date());
      return buildIntakeState(ctx.fs, ctx.key, personId);
    },
    intakeAcknowledgeAdult: async (): Promise<IntakeState> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) {
        return emptyIntakeState(personId ?? '');
      }
      // The 18+ ack is shared with guided sessions (16) — acking here unlocks both surfaces (§3.3 decision).
      await acknowledgeAdult(ctx.fs, ctx.key, personId);
      return buildIntakeState(ctx.fs, ctx.key, personId);
    },
    intakeSynthesize: async (input): Promise<IntakeSynthesisResult> => {
      const { sectionId } = IntakeSynthesizeSchema.parse(input);
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) {
        return { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
      }
      const apiKey = (await resolveAiKey(host.secrets, ctx.fs, ctx.key)).key ?? null;
      return synthesizeIntake({
        fs: ctx.fs,
        key: ctx.key,
        client: host.claude,
        apiKey,
        model: await host.activeModel(),
        personId,
        ...(sectionId !== undefined ? { sectionId } : {}),
        now: new Date(),
      });
    },
    // Self-maintaining profile (18 §15) — own-scoped + gated `intake.own`. The list/accept/dismiss return the
    // updated PENDING set so the renderer re-renders from one round-trip.
    profileSuggestions: async (): Promise<ProfileUpdateSuggestion[]> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) return [];
      return listPendingSuggestions(ctx.fs, ctx.key, personId);
    },
    profileAcceptSuggestion: async (id): Promise<ProfileUpdateSuggestion[]> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) return [];
      await acceptSuggestion(
        ctx.fs,
        ctx.key,
        personId,
        ProfileSuggestionIdSchema.parse(id),
        new Date(),
      );
      return listPendingSuggestions(ctx.fs, ctx.key, personId);
    },
    profileDismissSuggestion: async (id): Promise<ProfileUpdateSuggestion[]> => {
      const ctx = await host.vaultAndKey();
      const personId = ctx ? await activePersonId() : null;
      if (!ctx || !personId || !(await activePersonCan(ctx.fs, ctx.key, 'intake.own'))) return [];
      await dismissSuggestion(
        ctx.fs,
        ctx.key,
        personId,
        ProfileSuggestionIdSchema.parse(id),
        new Date(),
      );
      return listPendingSuggestions(ctx.fs, ctx.key, personId);
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

import type {
  AccessView,
  AiKeyStatus,
  AiProvider,
  AlignmentResult,
  Goal,
  GoalStatus,
  Challenge,
  ChallengeStatus,
  ChallengeDomain,
  ChallengeOutcome,
  ChallengeSuggestion,
  ChallengeSuggestionResult,
  ChallengeCheckInResult,
  CoachingPrefs,
  CoachingSynthesis,
  CoachingSynthesisResult,
  RelationshipSynthesis,
  RelationshipSynthesisResult,
  ProactivityLevel,
  MemoryReconcileState,
  DeviceView,
  Answer,
  AnswerType,
  Assignment,
  AttachmentRef,
  BootState,
  Budget,
  BudgetState,
  ChatTurnResult,
  CompatibilityGroup,
  CompatibilitySendResult,
  CompatibilityVisibility,
  CompatResultPublish,
  ContextOnlyResult,
  Conversation,
  Dream,
  DreamAnalysis,
  DreamAnalysisEdits,
  DreamApproveResult,
  DreamImageResult,
  DreamInput,
  DreamNarrativeResult,
  DreamPatternStats,
  DreamPatternSummary,
  DreamPatternWindow,
  DreamPersonRef,
  DreamReflectionResult,
  DreamSharedImage,
  DreamShareResult,
  DreamShareTarget,
  DreamSynthesisResult,
  GuidanceState,
  GuidedSuggestResult,
  InAppSendResult,
  InboxAssignmentDetail,
  InboxItem,
  IntimacyTopicsView,
  IntimacyTopicSuggestResult,
  InviteSummary,
  Insight,
  InsightFact,
  IntakeAnswerValue,
  IntakeSection,
  IntakeSectionMeta,
  IntakeSession,
  IntakeState,
  IntakeSynthesisResult,
  IntakeTurnResult,
  Notification,
  NotificationAction,
  NotificationKind,
  NotificationSeverity,
  PersonNotificationState,
  Person,
  ProfileUpdateSuggestion,
  AnswersUpdatedSummary,
  ReminderDueSummary,
  ResponsesArrivedSummary,
  SendAnswer,
  SendResult,
  MemoryReconcileResult,
  OutboundSharing,
  PersonInput,
  PrivacyMode,
  Questionnaire,
  QuestionnaireAnalyzeResult,
  QuestionnaireGenerateResult,
  QuestionnaireImproveResult,
  QuestionnaireInput,
  QuestionnaireSendState,
  QuestionnaireSentOverview,
  SentRecipientSummary,
  QuestionnaireSuggestResult,
  SavedSuggestion,
  SavedSuggestionsResult,
  RelayLinkResult,
  QuestionTrend,
  QuestionnaireAggregate,
  Relationship,
  RelationshipInput,
  RelationshipType,
  RelayStatus,
  Role,
  SensitivityTier,
  SessionCost,
  SessionStatus,
  SessionSummaryResult,
  TestResult,
  TogetherCreateResult,
  TogetherSessionSummary,
  TogetherSessionView,
  TogetherTurnResult,
  TogetherWrapUpResult,
  TogetherReportView,
  TogetherCatalogEntry,
  TogetherYnmStatus,
  TogetherYnmOverlap,
  TogetherPulseView,
  JointChallengeStatus,
  TogetherSuggestion,
  Agreement,
  UpdateCheckResult,
  UsageEvent,
  UsageSummary,
} from './schemas';
import type { TestForm, TestNarrateResponse, TestSummary } from '@selfos/core/tests';

/**
 * IPC channel names + the renderer-facing bridge type. This module is zod-free so it is safe to
 * import from the sandboxed preload (the `BootState` import is type-only and erased at build time).
 */

/**
 * The host platform the renderer runs on — drives the integrated titlebar's window-control layout
 * (02-app-shell §13.2): macOS reserves the traffic-light inset, Windows the `titleBarOverlay` inset,
 * iOS/web render no window controls. `'unknown'` is a safe no-controls fallback.
 */
export type AppPlatform = 'darwin' | 'win32' | 'linux' | 'ios' | 'web' | 'unknown';

export const IpcChannels = {
  getBootState: 'app:getBootState',
  refreshBootState: 'app:refreshBootState',
  getAppVersion: 'app:getVersion',
  selectVaultFolder: 'vault:selectFolder',
  useVault: 'vault:use',
  unlinkVault: 'vault:unlink',
  getConflicts: 'vault:getConflicts',
  vaultSyncReadiness: 'vault:syncReadiness',
  revealVault: 'vault:reveal',
  vaultChanged: 'vault:changed', // main → renderer event
  fullscreenChanged: 'window:fullscreenChanged', // main → renderer event (macOS hides traffic lights)
  getSettings: 'settings:get',
  setSetting: 'settings:set',
  resetSetting: 'settings:reset',
  secretSet: 'secret:set',
  secretHas: 'secret:has',
  secretClear: 'secret:clear',
  claudeTest: 'claude:test',
  openaiTest: 'ai:openaiTest',
  aiKeyStatus: 'ai:keyStatus',
  aiSetSharedKey: 'ai:setSharedKey',
  aiShareDeviceKey: 'ai:shareDeviceKey',
  aiClearSharedKey: 'ai:clearSharedKey',
  devicesList: 'devices:list',
  devicesRename: 'devices:rename',
  keysRotate: 'keys:rotate',
  keysRotateStatus: 'keys:rotateStatus',
  householdStatus: 'household:status',
  householdSetup: 'household:setup',
  unlockWithRecoveryPhrase: 'household:unlockWithRecoveryPhrase',
  getActivePerson: 'session:getActivePerson',
  peopleList: 'people:list',
  peopleSave: 'people:save',
  peopleDelete: 'people:delete',
  relationshipsList: 'relationships:list',
  relationshipsSave: 'relationships:save',
  relationshipsDelete: 'relationships:delete',
  accessGet: 'access:get',
  accessSaveRole: 'access:saveRole',
  accessSetAccount: 'access:setAccount',
  accessRemoveAccount: 'access:removeAccount',
  invitesCreate: 'invites:create',
  invitesList: 'invites:list',
  invitesCancel: 'invites:cancel',
  invitesRedeem: 'invites:redeem',
  invitesCompleteJoin: 'invites:completeJoin',
  sessionSetActive: 'session:setActive',
  usageSummary: 'usage:summary',
  budgetGet: 'budget:get',
  budgetGetPerson: 'budget:getPerson',
  budgetSetApp: 'budget:setApp',
  budgetSetPerson: 'budget:setPerson',
  budgetStatus: 'budget:status',
  chatStream: 'chat:stream',
  chatRetry: 'chat:retry',
  chatChunk: 'chat:chunk', // main → renderer event
  conversationStoreAttachment: 'conversation:storeAttachment',
  conversationGetAttachment: 'conversation:getAttachment',
  conversationExportAttachment: 'conversation:exportAttachment',
  conversationsList: 'conversations:list',
  conversationsGet: 'conversations:get',
  conversationsRename: 'conversations:rename',
  conversationsDelete: 'conversations:delete',
  sessionsSetStatus: 'sessions:setStatus',
  sessionsEndAndSummarize: 'sessions:endAndSummarize',
  sessionsStartGuided: 'sessions:startGuided',
  guidedGetState: 'guided:getState',
  guidedSuggest: 'guided:suggest',
  guidedAcknowledgeAdult: 'guided:acknowledgeAdult',
  usageSessionCosts: 'usage:sessionCosts',
  questionnairesList: 'questionnaires:list',
  questionnairesSendStates: 'questionnaires:sendStates',
  questionnairesSentOverview: 'questionnaires:sentOverview',
  questionnairesShareLink: 'questionnaires:shareLink',
  questionnairesGet: 'questionnaires:get',
  questionnairesSave: 'questionnaires:save',
  questionnairesDelete: 'questionnaires:delete',
  questionnairesValidate: 'questionnaires:validate',
  questionnairesSetFavorite: 'questionnaires:setFavorite',
  questionnairesListTypes: 'questionnaires:listTypes',
  questionnairesAddType: 'questionnaires:addType',
  questionnairesIntimacyTopics: 'questionnaires:intimacyTopics',
  questionnairesAddIntimacyTopic: 'questionnaires:addIntimacyTopic',
  questionnairesRemoveIntimacyTopic: 'questionnaires:removeIntimacyTopic',
  questionnairesSuggestIntimacyTopics: 'questionnaires:suggestIntimacyTopics',
  questionnairesStoreImage: 'questionnaires:storeImage',
  questionnairesGetImage: 'questionnaires:getImage',
  questionnairesDeleteImage: 'questionnaires:deleteImage',
  questionnairesGenerate: 'questionnaires:generate',
  questionnairesImproveQuestion: 'questionnaires:improveQuestion',
  gapfinderSuggest: 'gapfinder:suggest',
  questionnaireSuggestionsList: 'questionnaires:suggestionsList',
  questionnaireSuggestionsGenerate: 'questionnaires:suggestionsGenerate',
  questionnaireSuggestionDelete: 'questionnaires:suggestionDelete',
  questionnaireSuggestionMaterialize: 'questionnaires:suggestionMaterialize',
  insightsList: 'insights:list',
  memoryOutboundSharing: 'memory:outboundSharing',
  insightsAnalyze: 'insights:analyze',
  insightsApprove: 'insights:approve',
  insightsUpdate: 'insights:update',
  insightsDelete: 'insights:delete',
  insightsFlag: 'insights:flag',
  memoryRefresh: 'memory:refresh',
  memoryReconcileState: 'memory:reconcileState',
  memoryResolveProposal: 'memory:resolveProposal',
  goalsList: 'goals:list',
  goalsSetStatus: 'goals:setStatus',
  goalsUpdate: 'goals:update',
  goalsDelete: 'goals:delete',
  coachingGetPrefs: 'coaching:getPrefs',
  coachingSetPrefs: 'coaching:setPrefs',
  coachingGetSynthesis: 'coaching:getSynthesis',
  coachingSynthesize: 'coaching:synthesize',
  relationshipsGetSynthesis: 'relationships:getSynthesis',
  relationshipsSynthesize: 'relationships:synthesize',
  // Challenges / experiments (52-challenge-sessions §6). All gated by `challenges.own` + active-person-scoped.
  challengesStart: 'challenges:start',
  challengesStartReflection: 'challenges:startReflection',
  challengesList: 'challenges:list',
  challengesGet: 'challenges:get',
  challengesSetStatus: 'challenges:setStatus',
  challengesCheckIn: 'challenges:checkIn',
  challengesSnooze: 'challenges:snooze',
  challengesSeedGoal: 'challenges:seedGoal',
  challengesDelete: 'challenges:delete',
  challengesSuggest: 'challenges:suggest',
  challengesGetSuggestion: 'challenges:getSuggestion',
  challengesClearSuggestion: 'challenges:clearSuggestion',
  // Together / couples sessions (58-together §6.1). All gated by `together.own` + participant membership +
  // a live `partner` edge; every read is viewer-projected in the bridge (the trust boundary, §5.2).
  togetherList: 'together:list',
  togetherGet: 'together:get',
  togetherCreate: 'together:create',
  togetherAccept: 'together:accept',
  togetherDecline: 'together:decline',
  togetherSetPaused: 'together:setPaused',
  togetherLeave: 'together:leave',
  togetherWithdraw: 'together:withdraw',
  togetherMarkRead: 'together:markRead',
  togetherSendMessage: 'together:sendMessage',
  togetherRetry: 'together:retry',
  togetherChunk: 'together:chunk', // main → renderer event
  togetherPrepOpen: 'together:prepOpen',
  togetherStoreAttachment: 'together:storeAttachment',
  togetherGetAttachment: 'together:getAttachment',
  togetherCatalog: 'together:catalog',
  togetherAcknowledgeAdult: 'together:acknowledgeAdult',
  togetherYnmStatus: 'together:ynmStatus',
  togetherYnmOptIn: 'together:ynmOptIn',
  togetherYnmRevoke: 'together:ynmRevoke',
  togetherYnmOverlap: 'together:ynmOverlap',
  togetherPulse: 'together:pulse',
  togetherPulseLog: 'together:pulseLog',
  togetherJointChallenges: 'together:jointChallenges',
  togetherSuggestions: 'together:suggestions',
  togetherWrapUp: 'together:wrapUp',
  togetherGetReport: 'together:getReport',
  togetherSaveAgreement: 'together:saveAgreement',
  assignmentsCreate: 'assignments:create',
  assignmentsInbox: 'assignments:inbox',
  assignmentsSetFavorite: 'assignments:setFavorite',
  assignmentsGet: 'assignments:get',
  assignmentsOpen: 'assignments:open',
  assignmentsSaveProgress: 'assignments:saveProgress',
  assignmentsReopen: 'assignments:reopen',
  assignmentsSubmit: 'assignments:submit',
  assignmentsDecline: 'assignments:decline',
  assignmentsResults: 'assignments:results',
  assignmentsTrends: 'assignments:trends',
  assignmentsAggregate: 'assignments:aggregate',
  assignmentsDelete: 'assignments:delete',
  assignmentsCreateCompatibility: 'assignments:createCompatibility',
  assignmentsCompatibility: 'assignments:compatibility',
  assignmentsAlign: 'assignments:align',
  assignmentsPublishCompatResult: 'assignments:publishCompatResult',
  assignmentsDistillContextOnly: 'assignments:distillContextOnly',
  assignmentsRevealRaw: 'assignments:revealRaw',
  assignmentsCreateRelayLink: 'assignments:createRelayLink',
  assignmentsDrain: 'assignments:drain',
  assignmentsRevoke: 'assignments:revoke',
  assignmentsReshare: 'assignments:reshare',
  assignmentsReAsk: 'assignments:reAsk',
  assignmentsExportResults: 'assignments:exportResults',
  relayStatus: 'relay:status',
  relayConnect: 'relay:connect',
  relayUpdate: 'relay:update',
  relayTeardown: 'relay:teardown',
  dreamsList: 'dreams:list',
  dreamGet: 'dreams:get',
  dreamSave: 'dreams:save',
  dreamDelete: 'dreams:delete',
  dreamStartReflection: 'dreams:startReflection',
  dreamAnalyzeTurn: 'dreams:analyzeTurn',
  dreamChunk: 'dreams:chunk', // main → renderer event
  dreamGetAnalysis: 'dreams:getAnalysis',
  dreamGetConversation: 'dreams:getConversation',
  dreamSynthesize: 'dreams:synthesize',
  dreamUpdateAnalysis: 'dreams:updateAnalysis',
  dreamApprove: 'dreams:approve',
  dreamRemoveFromContext: 'dreams:removeFromContext',
  dreamPatternStats: 'dreams:patternStats',
  dreamGetPatternSummary: 'dreams:getPatternSummary',
  dreamPatternNarrative: 'dreams:patternNarrative',
  dreamApprovePatternNarrative: 'dreams:approvePatternNarrative',
  dreamRemovePatternNarrative: 'dreams:removePatternNarrative',
  dreamShareTargets: 'dreams:shareTargets',
  dreamGetInsight: 'dreams:getInsight',
  dreamSetFactShare: 'dreams:setFactShare',
  dreamGenerateImage: 'dreams:generateImage',
  dreamGetImage: 'dreams:getImage',
  dreamDeleteImage: 'dreams:deleteImage',
  dreamExportImage: 'dreams:exportImage',
  dreamSetImageShare: 'dreams:setImageShare',
  dreamGetSharedImage: 'dreams:getSharedImage',
  dreamListSharedImages: 'dreams:listSharedImages',
  // Personal onboarding (18-personal-onboarding §6).
  intakeGetState: 'intake:getState',
  intakeRunTurn: 'intake:runTurn',
  intakeChunk: 'intake:chunk', // main → renderer event
  intakeSkipSection: 'intake:skipSection',
  intakeSubmitForm: 'intake:submitForm',
  intakeAcknowledgeAdult: 'intake:acknowledgeAdult',
  intakeSetAnswerSharing: 'intake:setAnswerSharing',
  intakeSynthesize: 'intake:synthesize',
  // Self-assessments / "Tests" (50-self-assessments §6). All gated `tests.own` + active-person-scoped; the
  // 18+ group's items/results are withheld in the bridge until `adultAcknowledged`. Only `tests:narrate` spends.
  testsList: 'tests:list',
  testsGet: 'tests:get',
  testsTake: 'tests:take',
  testsResults: 'tests:results',
  testsNarrate: 'tests:narrate',
  testsAcknowledgeAdult: 'tests:acknowledgeAdult',
  testsDeleteResult: 'tests:deleteResult',
  testsDeleteAll: 'tests:deleteAll',
  profileSuggestions: 'profile:suggestions',
  profileAcceptSuggestion: 'profile:acceptSuggestion',
  profileDismissSuggestion: 'profile:dismissSuggestion',
  getSidebarCollapsed: 'ui:getSidebarCollapsed',
  setSidebarCollapsed: 'ui:setSidebarCollapsed',
  // Discovery (41 §4) — dismissed one-time orientation/tips, device-local + per-person.
  getDiscoveryDismissals: 'discovery:getDismissals',
  setDiscoveryDismissals: 'discovery:setDismissals',
  // Notifications (35-notification-system §6) — read/dismissed flags ride device-state (per-person);
  // openExternal is the shell path the renderer uses for an external action (e.g. the update link).
  getNotificationState: 'notifications:getState',
  setNotificationState: 'notifications:setState',
  notificationsResponsesArrived: 'notifications:responsesArrived',
  notificationsAnswersUpdated: 'notifications:answersUpdated',
  notificationsRemindersDue: 'notifications:remindersDue',
  openExternal: 'shell:openExternal',
  // Update awareness (36-update-awareness §6) — a notify-only check against the public GitHub Releases API.
  updatesCheck: 'updates:check',
  updatesGetState: 'updates:getState',
} as const;

export type SettingScope = 'vault' | 'device';

/** Minimum length of the owner login PIN set at Setup (10-multi-device-vault §3.2). */
export const MIN_OWNER_PIN_LENGTH = 4;

// The Claude + OpenAI secret ids. Defined as local string literals (NOT re-exported from
// `@selfos/core/schemas`) because `channels.ts` is imported by the **preload**, which runs sandboxed and
// must stay free of any runtime `zod` import — a value re-export from core/schemas pulls zod into the
// preload bundle and breaks it ("module not found: zod" → preload fails to load → boot hangs). These mirror
// the canonical `@selfos/core/schemas` constants (kept in lockstep; both are `'<provider>.apiKey'`).
export const ANTHROPIC_API_KEY_ID = 'anthropic.apiKey';
export const OPENAI_API_KEY_ID = 'openai.apiKey';
export type { DeviceView } from '@selfos/core/schemas';

/** The outcome of a key rotation (32 §6.4). The new recovery phrase is shown once; never logged. */
export type KeyRotateResult =
  | {
      ok: true;
      recoveryPhrase: string;
      reencryptedFileCount: number;
      revokedDeviceIds: string[];
      cancelledInviteCount: number;
    }
  | {
      ok: false;
      code:
        | 'SYNC_CONFLICT_UNRESOLVED'
        | 'NO_MASTER_KEY'
        | 'ROTATION_IN_PROGRESS'
        | 'CANNOT_REVOKE_THIS_DEVICE'
        | 'FILE_CORRUPT'
        | 'NOT_PERMITTED'
        | 'ERROR';
    };

/** A resumable rotation found at boot (32 §6.5), or null when none is in progress. */
export type RotationStatus = { phase: 'staging' | 'committing'; total: number } | null;

/** Whether the chosen vault folder is ready to set up, or still syncing from iCloud (33 §5.D). */
export type VaultSyncReadiness = { ready: boolean; reason?: 'icloud-pending' };

/**
 * A fact patch carried by `insightsApprove`/`insightsUpdate`. `shareableTypes` is the relationship-type scope
 * (42/44); `restricted: false` is the deliberate un-restrict of a sensitive OWN fact (42 §8). Both optional +
 * merged by id server-side, so a normal edit (omitting them) preserves the stored scope/restriction.
 */
export interface InsightFactEdit {
  id: string;
  text: string;
  shareable: boolean;
  shareableTypes?: RelationshipType[];
  restricted?: boolean;
}

export type ClaudeErrorCode = 'NO_KEY' | 'AUTH' | 'RATE_LIMIT' | 'NETWORK' | 'API_ERROR';
export type ClaudeTestResult =
  | { ok: true; text: string }
  | { ok: false; code: ClaudeErrorCode; message: string };

export interface SettingsValues {
  vault: Record<string, unknown>;
  device: Record<string, unknown>;
}

/** Drives the post-boot household gate (setup vs. unlock vs. the app — 10-multi-device-vault §3.1). */
export interface HouseholdStatus {
  /** Whether the vault is already initialized (config/recovery.enc present) — key-free, vault property. */
  vaultInitialized: boolean;
  /** Whether THIS device holds the master key (in its secret store). */
  hasMasterKey: boolean;
  /** Whether an owner account exists (requires the key to read; false when hasMasterKey is false). */
  hasOwner: boolean;
  activePersonId: string | null;
  /** A redeemed-but-not-yet-finished member join (set their PIN) — resumes on boot (§5.4). */
  pendingJoinPersonId: string | null;
}

export type SetActiveResult =
  | { ok: true; person: Person }
  | { ok: false; reason: 'WRONG_PIN' | 'NO_ACCOUNT' };

export type UsageScope = 'person' | 'app';
export type UsagePeriod = 'week' | 'month';

/** Lightweight conversation list item (05-conversations; 09 §14.1 adds lifecycle status). */
export interface ConversationMeta {
  id: string;
  title: string;
  updatedAt: string;
  status: SessionStatus; // normalized; absent ⇒ 'inProgress'
  guideId?: string; // set when the session was started from a guided exercise (16-guided-sessions §4.2)
}

export interface SelfosBridge {
  /** Current boot state (computed from device-local state + vault status). */
  getBootState(): Promise<BootState>;
  /** Recompute the boot state (e.g. after a vault-error retry). */
  refreshBootState(): Promise<BootState>;
  /** Open the native folder picker; resolves to the chosen path or null if cancelled. */
  selectVaultFolder(): Promise<string | null>;
  /** Initialize + activate the vault at `path`, then return the recomputed boot state. */
  useVault(path: string): Promise<BootState>;
  /**
   * Detach this device from the current vault (14-vault-relinking): stop the watcher, clear the
   * device-local master key + `vaultPath`/`activePersonId`/`pendingJoinPersonId`, and return the
   * recomputed (onboarding) boot state. Touches **no** bytes inside the vault —
   * the folder stays intact and re-linkable via its recovery phrase. "Unlink" and "switch" are the same
   * operation; the caller re-enters the existing onboarding folder picker afterward.
   */
  unlinkVault(): Promise<BootState>;
  /** Absolute paths of any sync-conflict copies found in the active vault. */
  getConflicts(): Promise<string[]>;
  /** Whether the active vault folder is ready to set up, or still downloading from iCloud (33 §5.D). */
  vaultSyncReadiness(): Promise<VaultSyncReadiness>;
  /** Open the active vault folder in the OS file manager. */
  revealVault(): Promise<void>;
  /** Subscribe to external vault changes; returns an unsubscribe function. */
  onVaultChanged(listener: () => void): () => void;
  /**
   * The host platform — drives the integrated titlebar's per-platform window-control layout
   * (02-app-shell §13). A plain value (not a promise) so the header lays out before first paint with
   * no flash of the wrong inset.
   */
  readonly platform: AppPlatform;
  /**
   * Subscribe to OS fullscreen transitions; returns an unsubscribe function. On macOS the traffic
   * lights hide in fullscreen, so the titlebar reclaims their reserved inset (02-app-shell §13.5). A
   * no-op on platforms without window chrome (iOS/web).
   */
  onFullscreenChanged(listener: (fullscreen: boolean) => void): () => void;
  /** The app version string (for the About section). */
  getAppVersion(): Promise<string>;
  /** Persisted setting values, by scope. */
  getSettings(): Promise<SettingsValues>;
  /** Persist a single setting value to the given scope. */
  setSetting(input: { key: string; value: unknown; scope: SettingScope }): Promise<void>;
  /** Remove a single setting value (revert to its default). */
  resetSetting(input: { key: string; scope: SettingScope }): Promise<void>;
  /** Store an encrypted secret (e.g. the Claude API key) device-local. The value never comes back. */
  secretSet(input: { id: string; value: string }): Promise<void>;
  /** Whether a secret is configured (the value itself is never exposed to the renderer). */
  secretHas(input: { id: string }): Promise<boolean>;
  /** Remove a stored secret. */
  secretClear(input: { id: string }): Promise<void>;
  /** Test the Claude connection with the stored (resolved) key + selected model. */
  claudeTest(): Promise<ClaudeTestResult>;
  /** Test the OpenAI (dream-image) key with a non-generative probe (33 §6.B). */
  openaiTest(): Promise<ClaudeTestResult>;
  /** AI key readiness for a provider — booleans + an enum only, never a key value (25 §5.3). */
  aiKeyStatus(input?: { provider?: AiProvider }): Promise<AiKeyStatus>;
  /** Owner-only: set the household's shared key for a provider (the value never comes back). */
  aiSetSharedKey(input: { provider: AiProvider; value: string }): Promise<void>;
  /** Owner-only: promote this device's key into the shared household credentials (25 §5.4). */
  aiShareDeviceKey(input?: { provider?: AiProvider }): Promise<void>;
  /** Owner-only: stop sharing a provider's key with the household. */
  aiClearSharedKey(input?: { provider?: AiProvider }): Promise<void>;
  /** Owner-only: the household's joined devices (32-device-management §6.2). */
  devicesList(): Promise<DeviceView[]>;
  /** Owner-only: rename a device in the registry. */
  devicesRename(input: { deviceId: string; label: string }): Promise<void>;
  /** Owner-only: re-encrypt the whole vault under a new key, revoking the given devices (32 §6.4). */
  keysRotate(input?: { revokeDeviceIds?: string[] }): Promise<KeyRotateResult>;
  /** Owner-only: a resumable rotation found at boot, or null (32 §6.5). */
  keysRotateStatus(): Promise<RotationStatus>;
  /** Whether the household is set up (master key + owner) and who is active. */
  householdStatus(): Promise<HouseholdStatus>;
  /** First-run setup: create the owner (with a login PIN) and return the recovery phrase. */
  householdSetup(input: {
    ownerName: string;
    pin: string;
  }): Promise<{ recoveryPhrase: string; ownerId: string }>;
  /** Join/recover this device: restore the master key from the recovery phrase. No owner is created. */
  unlockWithRecoveryPhrase(input: { phrase: string }): Promise<{ ok: boolean }>;
  /** The currently active person (decrypted), or null. */
  getActivePerson(): Promise<Person | null>;
  /** All people in the household (decrypted), sorted by name. */
  peopleList(): Promise<Person[]>;
  /** Create or update a person; returns the saved record. */
  peopleSave(input: PersonInput): Promise<Person>;
  /** Delete a person and their data folder. */
  peopleDelete(id: string): Promise<void>;
  /** All relationships in the household. */
  relationshipsList(): Promise<Relationship[]>;
  /** Create or update a relationship; returns the saved record. */
  relationshipsSave(input: RelationshipInput): Promise<Relationship>;
  /** Delete a relationship. */
  relationshipsDelete(id: string): Promise<void>;
  /** Roles + accounts (PIN hashes stripped). */
  accessGet(): Promise<AccessView>;
  /** Create or update a role (capability matrix); returns the refreshed view. */
  accessSaveRole(role: Role): Promise<AccessView>;
  /** Grant or update a person's account (role + optional PIN); returns the refreshed view. */
  accessSetAccount(input: {
    personId: string;
    roleId: string;
    pin?: string | null;
  }): Promise<AccessView>;
  /** Revoke a person's account. */
  accessRemoveAccount(personId: string): Promise<AccessView>;
  /** Generate a one-time device-invite code for a member; the code is shown once and never stored. */
  invitesCreate(input: { personId: string }): Promise<{ code: string; expiresAt: string }>;
  /** Pending (non-expired) invites for a person, for the owner's UI. */
  invitesList(input: { personId: string }): Promise<InviteSummary[]>;
  /** Cancel a pending invite by id. */
  invitesCancel(input: { id: string }): Promise<void>;
  /** Redeem an invite code on this device: unlock the vault key, resolving who the invite is for. */
  invitesRedeem(input: { code: string }): Promise<{ ok: boolean; displayName?: string }>;
  /** Finish joining after a redeem: set the member's own PIN and sign them in. */
  invitesCompleteJoin(input: { pin: string }): Promise<{ ok: boolean }>;
  /**
   * Switch the active person. The Owner (full-access role) may switch to ANY household person with no PIN;
   * everyone else must pass the target's PIN if one is set (roles refactor 2026-06-15).
   */
  sessionSetActive(input: { personId: string; pin?: string }): Promise<SetActiveResult>;
  /**
   * Rolled-up usage. Non-admins always get their own. Admins (`budgets.manage`) get the whole app
   * (`scope: 'app'`) or, with `personId`, a single chosen person.
   */
  usageSummary(input: {
    scope: UsageScope;
    period: UsagePeriod;
    personId?: string;
  }): Promise<UsageSummary>;
  /** The active person's effective budget + the app cap. */
  budgetGet(): Promise<{ app: Budget | null; person: Budget | null }>;
  /** A specific person's effective budget (override or the default). Admin-only. */
  budgetGetPerson(personId: string): Promise<Budget>;
  /** Set (or clear with null) the optional app-wide cap. Admin-only. */
  budgetSetApp(budget: Budget | null): Promise<void>;
  /** Set (or clear with null → default) a specific person's budget. Admin-only. */
  budgetSetPerson(input: { personId: string; budget: Budget | null }): Promise<void>;
  /** Current budget state for the active person + the app (drives progress + chat warnings). */
  budgetStatus(): Promise<{ person: BudgetState; app: BudgetState }>;
  /** Send a chat message: streams reply chunks via `onChatChunk`, resolves with the final turn. The optional
   *  image `attachments` (45) are stored refs from `conversationStoreAttachment`, re-read host-side per turn. */
  chatStream(input: {
    conversationId: string;
    userText: string;
    attachments?: AttachmentRef[];
  }): Promise<ChatTurnResult>;
  /**
   * Re-generate the coach's reply for a session whose last message is an unanswered user message (05 §4.1) —
   * an empty/failed turn, or a re-opened session that ended on the user. Adds no new user message (no
   * duplication); streams via `chat:chunk`. Scoped to the active person in the bridge.
   */
  chatRetry(conversationId: string): Promise<ChatTurnResult>;
  /** Subscribe to streamed reply chunks; returns an unsubscribe function. */
  onChatChunk(listener: (delta: string) => void): () => void;
  /**
   * Encrypt + store an image attachment (base64 in) for a Session message (45 §6) → an `AttachmentRef`, or a
   * calm reject. mime + size re-validated in main; scoped to the active person's conversation.
   */
  conversationStoreAttachment(input: {
    conversationId: string;
    base64: string;
    mime: string;
    width?: number;
    height?: number;
    bytes?: number;
  }): Promise<
    | AttachmentRef
    | { ok: false; reason: 'UNSUPPORTED' | 'TOO_LARGE' | 'NOT_FOUND'; message: string }
  >;
  /** Read + decrypt a stored attachment as base64 for a thumbnail/lightbox; null if absent/out-of-bounds. */
  conversationGetAttachment(input: {
    conversationId: string;
    path: string;
  }): Promise<{ mime: string; dataBase64: string } | null>;
  /** Export a stored attachment to a file the user chooses OUTSIDE the encrypted vault (45 §11). Saved path,
   *  or null if cancelled. */
  conversationExportAttachment(input: {
    conversationId: string;
    path: string;
  }): Promise<string | null>;
  /** The active person's conversations (newest first), metadata only. */
  conversationsList(): Promise<ConversationMeta[]>;
  /** Load a full conversation transcript. */
  conversationsGet(id: string): Promise<Conversation | null>;
  /** Rename a conversation. */
  conversationsRename(input: { id: string; title: string }): Promise<void>;
  /** Delete a conversation. */
  conversationsDelete(id: string): Promise<void>;
  /**
   * Set a session's lifecycle status (09 §14.1) — scoped to the active person, gated by `sessions.own`.
   * Completing stamps `endedAt`. Returns the updated meta, or null if it's missing.
   */
  sessionsSetStatus(input: {
    conversationId: string;
    status: SessionStatus;
  }): Promise<ConversationMeta | null>;
  /**
   * End & summarize a session into an auto-approved Session Insight (09 §3.1/§14.2). Also used for the
   * re-run on a reopened (stale) session. Budget-gated + metered (`session.analyze`); the key stays in main.
   */
  sessionsEndAndSummarize(input: { conversationId: string }): Promise<SessionSummaryResult>;
  /**
   * Start a guided session (16-guided-sessions §6): create + seed a conversation stamped with `guideId`,
   * returning its id. Gated `sessions.own`, scoped to the active person; rejects an unknown `guideId`. No
   * model call — the static opener is seeded, so it works with AI off.
   */
  sessionsStartGuided(input: { guideId: string }): Promise<{ conversationId: string } | null>;
  /**
   * The launcher's no-spend read (16 §6): cached "Suggested for you" (if any) + the 18+ ack state. Gated
   * `sessions.own`.
   */
  guidedGetState(): Promise<GuidanceState>;
  /**
   * Generate/refresh "Suggested for you" (16 §3.4) — budget-gated + metered (`guided.suggest`); caches the
   * result. Gated `sessions.own`; reads the gap-finder context-provider registry. Key stays in main.
   */
  guidedSuggest(): Promise<GuidedSuggestResult>;
  /** Record the one-time 18+ acknowledgement for the Intimacy group (16 §8.3); returns the new state. */
  guidedAcknowledgeAdult(): Promise<GuidanceState>;
  /**
   * Per-session accumulated AI cost for the active person (09 §14.3). `costUsd` is present **only for
   * admins** (`budgets.manage`), redacted at the bridge; everyone gets `tokens` + a `budgetRatio`.
   */
  usageSessionCosts(): Promise<Record<string, SessionCost>>;
  /** The household's questionnaire definitions, newest first. Requires `questionnaires.create`. */
  questionnairesList(): Promise<Questionnaire[]>;
  /**
   * Per-questionnaire send state for the active person's own sends (08 §17.14): keyed by questionnaire id,
   * the latest send time + count. Drives the list's "Sent · <date>" badge so an author can tell which of
   * their questionnaires have gone out. Sender-scoped; requires `questionnaires.create`.
   */
  questionnairesSendStates(): Promise<Record<string, QuestionnaireSendState>>;
  /**
   * A richer per-questionnaire "Sent" overview for the landing cards (08 §3.1): keyed by questionnaire id,
   * the latest send time + the distinct recipients (deduped to their latest send) with their answered status,
   * plus how many responses are newly in (submitted, not yet analysed). Recipient detail is results
   * territory, so this is sender-scoped and requires `questionnaires.viewResults` (stricter than send-states).
   * The raw answers never cross here.
   */
  questionnairesSentOverview(): Promise<Record<string, QuestionnaireSentOverview>>;
  /**
   * The shareable link + PIN for a SENT questionnaire's latest open send (08 §17.14d) — for the "Share link"
   * affordance on the sent preview + list kebab. By default RE-SHOWS the existing link/PIN (no regeneration);
   * `regenerate: true` (the manual Refresh) mints a fresh one + revokes the old. Null if there's no relay,
   * no open send, or (on regenerate) the mint fails. Requires `questionnaires.sendExternal`.
   */
  questionnairesShareLink(
    questionnaireId: string,
    regenerate?: boolean,
  ): Promise<RelayLinkResult | null>;
  /** Load one questionnaire definition; null if absent. */
  questionnairesGet(id: string): Promise<Questionnaire | null>;
  /** Create or update a questionnaire definition (editing bumps its version); returns the saved record. */
  questionnairesSave(input: QuestionnaireInput): Promise<Questionnaire>;
  /** Delete a questionnaire definition. */
  questionnairesDelete(id: string): Promise<void>;
  /** Structural problems with a draft (empty array = valid) — for live builder feedback. */
  questionnairesValidate(input: QuestionnaireInput): Promise<string[]>;
  /**
   * Pin/unpin a questionnaire (the list star, 38 §13.8) — sets `favorite` without bumping the content
   * version. Requires `questionnaires.create`.
   */
  questionnairesSetFavorite(input: { id: string; favorite: boolean }): Promise<void>;
  /** The user-defined custom types (vault-stored), for the builder's type picker. Requires `questionnaires.create`. */
  questionnairesListTypes(): Promise<string[]>;
  /** Add a custom type (trimmed, de-duped) and return the updated list. Requires `questionnaires.create`. */
  questionnairesAddType(name: string): Promise<string[]>;
  /**
   * The shared intimacy topic inventory (08-questionnaires §16.5a): built-in topics + the Owner's custom
   * additions, split so the UI shows built-ins read-only and custom as removable. Read requires
   * `questionnaires.create`; add/remove are **owner-only** (`people.manage`).
   */
  questionnairesIntimacyTopics(): Promise<IntimacyTopicsView>;
  questionnairesAddIntimacyTopic(input: {
    kind: 'activities' | 'fantasies';
    name: string;
  }): Promise<IntimacyTopicsView>;
  questionnairesRemoveIntimacyTopic(input: {
    kind: 'activities' | 'fantasies';
    name: string;
  }): Promise<IntimacyTopicsView>;
  /** Owner-only: AI-suggest fresh intimacy topics around an optional subject (deduped). Persists nothing. */
  questionnairesSuggestIntimacyTopics(input: {
    subject?: string;
  }): Promise<IntimacyTopicSuggestResult>;
  /** Encrypt + store an author-attached question image (base64 in); returns its vault path + mime. */
  questionnairesStoreImage(input: { base64: string; mime: string }): Promise<{
    imagePath: string;
    mime: string;
  }>;
  /** Read + decrypt a stored question image as base64; null if absent/out-of-bounds. */
  questionnairesGetImage(imagePath: string): Promise<string | null>;
  /** Delete a stored question image. */
  questionnairesDeleteImage(imagePath: string): Promise<void>;
  /** AI-draft questions from a brief and/or the configured structured context. Budget-gated + metered. */
  questionnairesGenerate(input: {
    type: string;
    sensitivity: SensitivityTier;
    brief?: string;
    existingPrompts: string[];
    // The bound household recipient (08 §17.12) — the bridge auto-tailors to their shareable context AND skips
    // what they've already covered. Their full content is gathered host-side; it never returns to the renderer.
    // There is no separate "about a person" picker anymore (§17.12-A).
    recipientPersonId?: string;
    // Intimacy draft format (08 §17.12-C): direct questions, described scenarios, or a mix.
    intimacyMode?: 'questions' | 'scenarios' | 'mix';
  }): Promise<QuestionnaireGenerateResult>;
  /** Reword a single question per an instruction ("warmer", "tighter"). Budget-gated + metered. */
  questionnairesImproveQuestion(input: {
    prompt: string;
    type: AnswerType;
    instruction: string;
  }): Promise<QuestionnaireImproveResult>;
  /** Gap-finder: propose the next questionnaires from structured context. Budget-gated + metered. */
  gapfinderSuggest(input: { targetPersonId?: string }): Promise<QuestionnaireSuggestResult>;
  /** Recipient-first saved suggestions (08 §18). Read the author's saved set for one household recipient — no
   * AI spend. */
  questionnaireSuggestionsList(input: { recipientPersonId: string }): Promise<SavedSuggestion[]>;
  /** Generate a fresh, recipient-tailored batch (de-dup against their history + the already-saved ideas) and
   * accumulate it into the saved set. Budget-gated + metered; the prior set is preserved on failure. */
  questionnaireSuggestionsGenerate(input: {
    recipientPersonId: string;
  }): Promise<SavedSuggestionsResult>;
  /** Remove one saved suggestion (the card Delete, or the auto-remove once a questionnaire is created from it).
   * Returns the recipient's remaining set. */
  questionnaireSuggestionDelete(input: {
    recipientPersonId: string;
    suggestionId: string;
  }): Promise<SavedSuggestion[]>;
  /** "Create from this" (08 §19.4): run a full, knowledge-aware generation from a saved suggestion's idea —
   * a complete, de-duped questionnaire with proper options. Budget-gated + metered; the renderer falls back
   * to seeding the sample questions on failure. */
  questionnaireSuggestionMaterialize(input: {
    recipientPersonId: string;
    suggestionId: string;
  }): Promise<QuestionnaireGenerateResult>;
  /**
   * The ACTIVE person's memory (20-memory-dashboard §5.1): their own insights + their relationships'
   * shareable facts only — scoped + gated on `memory.own` in the bridge (the trust boundary).
   */
  insightsList(): Promise<Insight[]>;
  /**
   * The active person's OWN outbound sharing (42-relationship-scoped-sharing §5.3): every shareable item
   * they own + the concrete related people currently receiving it. Own-scoped + gated on `memory.own`.
   */
  memoryOutboundSharing(): Promise<OutboundSharing>;
  /** Analyze a submitted assignment's answers into an UNapproved Insight. Budget-gated + metered. */
  insightsAnalyze(input: { assignmentId: string }): Promise<QuestionnaireAnalyzeResult>;
  /** Approve an Insight (apply edits + chosen shareable facts) so it enters the coach's context. */
  insightsApprove(input: {
    subjectPersonId: string;
    id: string;
    summary?: string;
    facts?: InsightFactEdit[];
  }): Promise<Insight | null>;
  /**
   * Edit an existing Insight (summary / facts). A fact's `shareableTypes` is the relationship-type scope set
   * by the Memory sharing control (42/44); `restricted: false` is the deliberate un-restrict of a sensitive
   * OWN fact (42 §8). Omitted fields are preserved (merged by id in `updateInsight`).
   */
  insightsUpdate(input: {
    subjectPersonId: string;
    id: string;
    summary?: string;
    facts?: InsightFactEdit[];
  }): Promise<Insight | null>;
  /** Delete an Insight. */
  insightsDelete(input: { subjectPersonId: string; id: string }): Promise<void>;
  /**
   * Flag (or clear) a fact as inaccurate (20-memory-dashboard §3.6) on one of the active person's OWN
   * insights — `factId` omitted flags the whole insight. Excludes it from context immediately.
   */
  insightsFlag(input: {
    insightId: string;
    factId?: string;
    flagged: boolean;
  }): Promise<Insight | null>;
  /**
   * Reconcile the active person's memory (20 §3.5 / 39 §3.3). A manual "Refresh" (`auto` omitted/false) always
   * forces it; an automatic pass (`auto: true`, driven by the renderer cadence) only runs when warranted
   * (threshold/gap, throttled, opt-out honored) — otherwise it returns a calm `SKIPPED` no-op.
   */
  memoryRefresh(input?: { auto?: boolean }): Promise<MemoryReconcileResult>;
  /** The "kept tidy" signal + queued merge proposals for the active person (39 §3.2/§3.4). */
  memoryReconcileState(): Promise<MemoryReconcileState>;
  /** Confirm (merge) or dismiss (keep both) one of the active person's queued merge proposals (39 §3.4). */
  memoryResolveProposal(input: { proposalId: string; action: 'merge' | 'keepBoth' }): Promise<void>;
  /**
   * The ACTIVE person's tracked goals / commitments (39-living-memory §3.1) — own only, scoped + gated on
   * `memory.own` in the bridge (the trust boundary). Newest-first.
   */
  goalsList(): Promise<Goal[]>;
  /** Set one of the active person's OWN goals' status (39 §3.1); bumps lastTouchedAt (un-stales). */
  goalsSetStatus(input: { goalId: string; status: GoalStatus }): Promise<Goal | null>;
  /** Edit one of the active person's OWN goals (text / due / horizon; empty due/horizon clears). */
  goalsUpdate(input: {
    goalId: string;
    text?: string;
    due?: string;
    horizon?: string;
  }): Promise<Goal | null>;
  /** Delete one of the active person's OWN goals. */
  goalsDelete(input: { goalId: string }): Promise<void>;
  /**
   * The active person's OWN proactive-coaching preferences (40 §4.1a) — the per-person proactivity level.
   * Gated `sessions.own`, active-person-scoped in the bridge. `null` when not signed in / not permitted.
   */
  coachingGetPrefs(): Promise<CoachingPrefs | null>;
  /** Set the active person's OWN proactivity level (40 §3.6) — off / gentle / active. */
  coachingSetPrefs(input: { proactivity: ProactivityLevel }): Promise<CoachingPrefs | null>;
  /** The active person's cached cross-feature synthesis (40 §4.1), or null. No spend — a cached read. */
  coachingGetSynthesis(): Promise<CoachingSynthesis | null>;
  /**
   * Run the cross-feature synthesis pass (40 §3.3) — budget-gated, metered `coaching.synthesize`, tolerant-
   * parsed. `auto: true` (renderer cadence) applies the throttle/threshold gate; omitting it forces a run
   * (manual "What are you noticing lately?"). Gated `sessions.own`, active-person-scoped.
   */
  coachingSynthesize(input?: { auto?: boolean }): Promise<CoachingSynthesisResult>;
  /**
   * The active person's cached relationship-insights synthesis about a partner (54 §6), or null. Cached read,
   * no spend. Gated `memory.own`, active-person-scoped.
   */
  relationshipsGetSynthesis(input: {
    partnerPersonId: string;
  }): Promise<RelationshipSynthesis | null>;
  /**
   * Generate (explicit-tap) the relationship-insights synthesis about a partner (54 §5) — budget-gated +
   * weekly-capped, metered `relationship.synthesize`, tolerant-parsed. Reads the viewer's own digest + the
   * partner's SHARED facts (never raw answers). Gated `memory.own` + the relationship must be a `partner`.
   */
  relationshipsSynthesize(input: { partnerPersonId: string }): Promise<RelationshipSynthesisResult>;
  /**
   * Challenges / experiments (52-challenge-sessions §6). All gated by `challenges.own` + active-person-scoped
   * in the bridge (the trust boundary — a person only ever starts/reads/acts on their OWN challenges). A
   * sexual/intimacy domain additionally requires the 18+ ack, enforced in the bridge. The metered calls are
   * `challenges:suggest` (and nothing else here); starting + status changes + an inline check-in are free.
   */
  /** Start a challenge-coach session (§3.1), optionally seeded with a domain. Returns the new conversation id. */
  challengesStart(input?: { domain?: ChallengeDomain }): Promise<{ conversationId: string } | null>;
  /** Start a challenge REFLECTION session (§3.5) for a non-adult challenge. Returns the conversation id. */
  challengesStartReflection(input: {
    challengeId: string;
  }): Promise<{ conversationId: string } | null>;
  /** The active person's challenges (own only) — the current active + closed, newest-first. */
  challengesList(): Promise<Challenge[]>;
  /** One of the active person's OWN challenges, or null. */
  challengesGet(input: { challengeId: string }): Promise<Challenge | null>;
  /** Set status on the active person's OWN challenge (the card's "I did it" / "Let it go"). */
  challengesSetStatus(input: {
    challengeId: string;
    status: ChallengeStatus;
  }): Promise<Challenge | null>;
  /** Record an inline check-in (§3.5): writes outcome/reflection, marks `done`, runs the reflection → Insight
   *  bridge (deterministic, no spend). `insightId` is the derived reflection Insight. */
  challengesCheckIn(input: {
    challengeId: string;
    outcome: ChallengeOutcome;
    reflection?: string;
  }): Promise<ChallengeCheckInResult>;
  /** "Not yet" — keep the challenge active and push its check-in out (§3.5), never a nag. */
  challengesSnooze(input: { challengeId: string }): Promise<Challenge | null>;
  /** Offer-to-seed a 39 Goal from a completed challenge (§11 Q6 — confirm-before-create). */
  challengesSeedGoal(input: { challengeId: string }): Promise<Challenge | null>;
  /** Delete one of the active person's OWN challenges (its derived Insight follows the Memory delete). */
  challengesDelete(input: { challengeId: string }): Promise<void>;
  /**
   * Run the proactive suggester (§3.7) — budget-gated, metered `challenge.suggest`, tolerant-parsed. The
   * renderer fires it only on an explicit tap; sexual candidates are withheld until the 18+ ack.
   */
  challengesSuggest(input?: { override?: boolean }): Promise<ChallengeSuggestionResult>;
  /** The cached challenge suggestion (no spend) — for re-display. */
  challengesGetSuggestion(): Promise<ChallengeSuggestion | null>;
  /** Clear the cached suggestion (after the person accepts or dismisses it). */
  challengesClearSuggestion(): Promise<void>;
  /**
   * Together / couples sessions (58-together §6.1). All gated by `together.own` + participant membership + a
   * live `partner` edge, re-checked on every call; every read is **viewer-projected** in the bridge (§5.2) —
   * a private aside (and its coach reply) appears only to its author, a quiet decline never surfaces to the
   * initiator, and status/turn/unread/snippet are all derived over the caller's projection, never stored.
   */
  /** The active person's Together sessions (projection-derived summaries + turn state). */
  togetherList(): Promise<TogetherSessionSummary[]>;
  /** One session, viewer-projected (messages + status). Null if not a participant, un-edged, or declined. */
  togetherGet(id: string): Promise<TogetherSessionView | null>;
  /** Start a session → invited. Returns a typed prerequisite-absent result on failure (§3.13). */
  togetherCreate(input: {
    partnerPersonId: string;
    topic?: string;
    guideId?: string;
  }): Promise<TogetherCreateResult>;
  /** Accept the rules of the room — writes the caller's `rulesAckAt` consent record (§3.4). */
  togetherAccept(id: string): Promise<TogetherSessionView | null>;
  /** Decline quietly — writes the caller's `declinedAt`; the initiator never sees "declined" (§3.5). */
  togetherDecline(id: string): Promise<void>;
  /** Pause for me / un-pause — the caller's own `pausedAt`; the partner's view is unchanged (§8.3). */
  togetherSetPaused(input: {
    sessionId: string;
    paused: boolean;
  }): Promise<TogetherSessionView | null>;
  /** Leave — ends the session for both, neutrally (§8.3). */
  togetherLeave(id: string): Promise<TogetherSessionView | null>;
  /** Withdraw (undo) a pending invitation the recipient hasn't responded to — initiator-only; deletes the
   *  shared session for both, as if never sent (§3.4). Resolves true on success, false if not allowed. */
  togetherWithdraw(id: string): Promise<boolean>;
  /** Mark the caller's read cursor (drives the unread/turn badges). */
  togetherMarkRead(input: { sessionId: string; at: string }): Promise<void>;
  /** Send a message (or a private aside): streams the coach reply via `onTogetherChunk`, resolves with the
   *  refreshed viewer-projected view. Participant + edge; initiator-budget gate (§5.1/§5.2). */
  togetherSendMessage(input: {
    sessionId: string;
    text: string;
    privateAside?: boolean;
    attachments?: AttachmentRef[];
  }): Promise<TogetherTurnResult>;
  /** Reply-only regeneration for a session whose newest message is an unanswered human message (§7). */
  togetherRetry(input: { sessionId: string }): Promise<TogetherTurnResult>;
  /** Subscribe to streamed couples-turn reply chunks (a separate sink from chat — §5.4). */
  onTogetherChunk(listener: (delta: string) => void): () => void;
  /** Open (or return) the caller's OWN private prep thread for a session (§3.7) — an ordinary conversation. */
  togetherPrepOpen(input: { sessionId: string }): Promise<Conversation | null>;
  /** Store an image attachment under the session's own folder (§6.1); a calm reject on mime/size. */
  togetherStoreAttachment(input: {
    sessionId: string;
    base64: string;
    mime: string;
    width?: number;
    height?: number;
  }): Promise<
    | AttachmentRef
    | { ok: false; reason: 'UNSUPPORTED' | 'TOO_LARGE' | 'NOT_FOUND'; message: string }
  >;
  /** Read a session attachment's bytes; an aside's attachment is readable only by its author (§5.2). */
  togetherGetAttachment(input: {
    sessionId: string;
    path: string;
  }): Promise<{ mime: string; dataBase64: string } | null>;
  /** The couples guided catalog cards the active person may start (§3.10) — 18+ group withheld host-side. */
  togetherCatalog(): Promise<TogetherCatalogEntry[]>;
  /** The active person's one-time 18+ acknowledgement (§3.10/§8.3) — their own consent only. */
  togetherAcknowledgeAdult(): Promise<boolean>;
  /** YNM readiness for a partner (§3.10b) — both acks + live edge + who's opted in; never the inventory. */
  togetherYnmStatus(input: { partnerPersonId: string }): Promise<TogetherYnmStatus>;
  /** Opt this pair's YNM in (symmetric consent, §3.10b) — only when eligible; returns the new status. */
  togetherYnmOptIn(input: { partnerPersonId: string }): Promise<TogetherYnmStatus>;
  /** Revoke this pair's YNM opt-in (always honored, §3.10b) — the overlap drops immediately. */
  togetherYnmRevoke(input: { partnerPersonId: string }): Promise<TogetherYnmStatus>;
  /** The mutual YNM overlap (§3.10b) — only when READY (both acks + edge + both opted in); else empty. */
  togetherYnmOverlap(input: { partnerPersonId: string }): Promise<TogetherYnmOverlap>;
  /** The pair Pulse (§3.10a): the viewer's own metric trends + dyad session metrics + dual-consent desire. */
  togetherPulse(input: { partnerPersonId: string }): Promise<TogetherPulseView>;
  /** Log a pulse check-in (§3.10a) — the viewer's own 1–3 ratings; returns the refreshed Pulse view. */
  togetherPulseLog(input: {
    partnerPersonId: string;
    metrics: Record<string, number>;
    shareMetrics?: string[];
  }): Promise<TogetherPulseView>;
  /** The pair's JOINT challenges (§5.6) + cross-partner "both checked in" status. `together.own` + edge. */
  togetherJointChallenges(input: { partnerPersonId: string }): Promise<JointChallengeStatus[]>;
  /** The coach's SUGGESTION cards for a session (§5.6) — never auto-acts. Participant + edge. */
  togetherSuggestions(sessionId: string): Promise<TogetherSuggestion[]>;
  /** Run wrap-up for a session (§3.8): a shared report + per-partner twins; the INITIATOR is billed. */
  togetherWrapUp(input: { sessionId: string }): Promise<TogetherWrapUpResult>;
  /** The session's shared report + derived staleness + the pair's agreements ledger (§3.8/§3.9). */
  togetherGetReport(input: { sessionId: string }): Promise<TogetherReportView>;
  /** Create/edit/retire a pair agreement inline (§11 #2); `id` absent ⇒ create. */
  togetherSaveAgreement(input: {
    sessionId: string;
    id?: string;
    text: string;
    timeframe?: string;
    status: 'standing' | 'done' | 'retired';
  }): Promise<Agreement | null>;
  /**
   * Send a questionnaire to its BOUND household recipient (in-app), freezing an immutable snapshot at send.
   * The recipient is set on the questionnaire at creation (08 §17.3) — it is NOT passed here. Returns the
   * assignment plus, when a relay is connected, a `link` + `pin` so the recipient can answer in their Inbox
   * OR anywhere via the link (08 §17.13, first-submission wins).
   */
  assignmentsCreate(input: {
    questionnaireId: string;
    privacy?: PrivacyMode;
    senderVisibleToRecipient?: boolean;
    expiresAt?: string;
  }): Promise<InAppSendResult>;
  /** The active person's Inbox — questionnaires sent to them, newest first. Requires `questionnaires.answer`. */
  assignmentsInbox(): Promise<InboxItem[]>;
  /**
   * Pin/unpin a received questionnaire (08 §3.3) — a personal, device-local, per-person view preference on
   * someone else's send. Recipient-scoped; requires `questionnaires.answer`.
   */
  assignmentsSetFavorite(input: { assignmentId: string; favorite: boolean }): Promise<void>;
  /**
   * The answering view for one Inbox assignment (frozen snapshot + any saved draft answers). Returns
   * null unless the active person is the recipient. Requires `questionnaires.answer`.
   */
  assignmentsGet(assignmentId: string): Promise<InboxAssignmentDetail | null>;
  /** Mark an assignment opened (sent → opened). Recipient-only; requires `questionnaires.answer`. */
  assignmentsOpen(assignmentId: string): Promise<void>;
  /** Save resumable draft answers without submitting. Recipient-only; requires `questionnaires.answer`. */
  assignmentsSaveProgress(input: { assignmentId: string; answers: Answer[] }): Promise<void>;
  /**
   * Re-open a submitted (in-app) assignment so the recipient can edit + resend (56 §3.1). Keeps the existing
   * answers + revision; rejects a **compatibility** send (a relay-linked in-app send is fine — its mailbox was
   * already revoked at first submit, §17.13). Recipient-only; requires `questionnaires.answer`.
   */
  assignmentsReopen(assignmentId: string): Promise<void>;
  /** Submit the recipient's answers (locks the assignment). Recipient-only; requires `questionnaires.answer`. */
  assignmentsSubmit(input: { assignmentId: string; answers: Answer[] }): Promise<void>;
  /** Decline an assignment, silently or with a short note. Recipient-only; requires `questionnaires.answer`. */
  assignmentsDecline(input: { assignmentId: string; note?: string }): Promise<void>;
  /**
   * The active person's sends of one questionnaire, newest first — the sender's Results view. Raw answers
   * are included only for **Standard, submitted** sends (a Private send carries none). Requires
   * `questionnaires.viewResults`.
   */
  assignmentsResults(questionnaireId: string): Promise<SendResult[]>;
  /**
   * Per-question rating-over-time trends across a questionnaire's submitted sends (Standard + Private —
   * numeric values only). Sender-scoped; requires `questionnaires.viewResults`.
   */
  assignmentsTrends(questionnaireId: string): Promise<QuestionTrend[]>;
  /** The cross-recipient "At a glance" aggregate (08 §20.7) — distributions/averages/counts; no raw
   *  answers. Sender-scoped + gated `questionnaires.viewResults`; numeric-only for Private sends. */
  assignmentsAggregate(questionnaireId: string): Promise<QuestionnaireAggregate>;
  /**
   * Delete one send (its snapshot + assignment + response + any derived Insight). Allowed for the send's
   * sender or the Owner. Requires `questionnaires.viewResults`.
   */
  assignmentsDelete(assignmentId: string): Promise<void>;
  /**
   * Send a **compatibility** questionnaire comparing **the sender + the bound recipient** (08-questionnaires
   * §3.6/§17.12-B) — both derived from the questionnaire, so no participant ids are passed. AI personalizes a
   * variant per participant, freezing a paired per-participant snapshot. Budget-gated + metered; requires AI
   * on and `questionnaires.create`. (External-recipient compatibility, via the relay, is a later slice.)
   */
  assignmentsCreateCompatibility(input: {
    questionnaireId: string;
  }): Promise<CompatibilitySendResult>;
  /**
   * The sender's compatibility sends of one questionnaire — paired members + the alignment report (null
   * until generated). Sender-scoped; requires `questionnaires.viewResults`.
   */
  assignmentsCompatibility(questionnaireId: string): Promise<CompatibilityGroup[]>;
  /**
   * Generate (or regenerate) a compatibility group's alignment report + a draft Insight. Both answerers
   * must have submitted. Budget-gated + metered; requires `questionnaires.viewResults`.
   */
  assignmentsAlign(compatibilityGroupId: string): Promise<AlignmentResult>;
  /**
   * Run a **context-only** compatibility distillation (08-questionnaires §16.2): each participant's own
   * answers become an auto-approved, own-context Insight feeding their own coach — no report, no cross-
   * sharing. Both must have submitted. Budget-gated + metered; sender-scoped; requires
   * `questionnaires.viewResults`.
   */
  assignmentsDistillContextOnly(compatibilityGroupId: string): Promise<ContextOnlyResult>;
  /**
   * Push the generated alignment report back to the EXTERNAL recipient(s) of a compatibility group, sealed
   * under their content key so the relay page shows it (08 §17.12-D). Sender-scoped; needs the report
   * already generated; `INVALID` when the group has no external recipient. Requires `questionnaires.viewResults`.
   */
  assignmentsPublishCompatResult(compatibilityGroupId: string): Promise<CompatResultPublish>;
  /**
   * Reveal a Private send's raw answers (08-questionnaires §8.4). Permitted only for the Owner (full
   * access, any send) or the sender of a `senderSeesAll` compatibility send holding
   * `questionnaires.readRaw`. Returns null if not permitted / absent.
   */
  assignmentsRevealRaw(assignmentId: string): Promise<SendAnswer[] | null>;
  /**
   * Mint an external (relay) send: snapshots the questionnaire, seals it to a new per-send keypair +
   * content key, uploads the ciphertext mailbox, and returns the recipient link (content key in the
   * fragment) + the 6-digit PIN, shown once for delivery. Requires `questionnaires.sendExternal` + a
   * configured relay. The Cloudflare token + drain secret never cross to the renderer.
   */
  assignmentsCreateRelayLink(input: {
    questionnaireId: string;
    // The external recipient is bound to the questionnaire at creation (08 §17.3) — not passed here.
    senderVisibleToRecipient: boolean;
    privacy?: PrivacyMode;
    expiresAt?: string;
  }): Promise<{ assignmentId: string; link: string; pin: string }>;
  /**
   * Drain the active person's external sends: fetch + locally decrypt any responses, persist them, and
   * purge the relay copies. Returns how many were collected. Requires `questionnaires.sendExternal`.
   */
  assignmentsDrain(): Promise<{ drained: number; declined: number }>;
  /** Revoke an external send's relay link (sender or admin). Requires `questionnaires.sendExternal`. */
  assignmentsRevoke(assignmentId: string): Promise<void>;
  /**
   * Re-publish a send's relay link: mint a FRESH link + PIN (the old link is revoked — the PIN is never
   * stored, so the original can't be re-shown), for delivery/resend. Returns null if not applicable (no
   * relay, the sender's own member, an already-answered send). Requires `questionnaires.sendExternal`.
   */
  assignmentsReshare(assignmentId: string): Promise<RelayLinkResult | null>;
  /**
   * Re-send the same questionnaire to the same bound recipient in one action (38 §3.3) — no re-authoring.
   * Auto-revokes the prior open send's relay link so an old emailed link can't double-submit (38 §3.6).
   * Mirrors the original delivery (household in-app + a unified link, or an external relay link). Returns
   * the new send (link/pin set when a relay minted one). Compatibility re-ask isn't supported yet (use
   * Duplicate). Requires `questionnaires.create`; the recipient is re-validated in the bridge.
   */
  assignmentsReAsk(input: { questionnaireId: string }): Promise<InAppSendResult>;
  /**
   * Export a questionnaire's results to a file OUTSIDE the encrypted vault (38 §3.7) — CSV or JSON. Built
   * host-side over the same privacy-filtered SendResult shape Results uses (a Private send contributes only
   * its numeric values, never prose), then written via a save dialog. Returns the written path, or null if
   * the sender cancels. Requires `questionnaires.viewResults`; sender-scoped.
   */
  assignmentsExportResults(input: {
    questionnaireId: string;
    format: 'csv' | 'json';
  }): Promise<string | null>;
  /** The relay connection status (no secrets) for the send panel + admin Relay setup. */
  relayStatus(): Promise<RelayStatus>;
  /** Connect + deploy the household relay to Cloudflare (admin-only). Returns the new status. */
  relayConnect(input: { apiToken: string; accountId: string }): Promise<RelayStatus>;
  /** Re-deploy the latest relay Worker version (admin-only). */
  relayUpdate(): Promise<RelayStatus>;
  /** Tear down + forget the relay (admin-only). */
  relayTeardown(): Promise<RelayStatus>;
  /** The active person's dreams, newest first (12-dreams). Requires `dreams.own`. */
  dreamsList(): Promise<Dream[]>;
  /** Load one of the active person's dreams; null if absent. Requires `dreams.own`. */
  dreamGet(id: string): Promise<Dream | null>;
  /** Create or update one of the active person's dreams; returns the saved record. Requires `dreams.own`. */
  dreamSave(input: DreamInput): Promise<Dream>;
  /** Delete a dream (purges its folder: dream + analysis + transcript). Requires `dreams.own`. */
  dreamDelete(id: string): Promise<void>;
  /**
   * Open (or resume) a dream's guided reflection: the coach speaks first with an AI opener that reflects
   * the dream back (streams via `onDreamChunk`); idempotent on an already-opened reflection. Falls back to
   * a static opener when AI can't run, so it always opens. Requires `dreams.own` (12 §15.4).
   */
  dreamStartReflection(input: { dreamId: string }): Promise<DreamReflectionResult>;
  /**
   * One turn of a dream's guided-analysis chat: streams reply chunks via `onDreamChunk`, resolves with
   * the final turn. The transcript persists under the dream (never in Sessions). Requires `dreams.own`.
   */
  dreamAnalyzeTurn(input: { dreamId: string; userText: string }): Promise<ChatTurnResult>;
  /** Subscribe to streamed dream-analysis reply chunks; returns an unsubscribe function. */
  onDreamChunk(listener: (delta: string) => void): () => void;
  /** Load a dream's synthesized analysis; null if not analyzed yet. Requires `dreams.own`. */
  dreamGetAnalysis(dreamId: string): Promise<DreamAnalysis | null>;
  /** Load a dream's guided-analysis transcript (to resume the chat); null if none. Requires `dreams.own`. */
  dreamGetConversation(dreamId: string): Promise<Conversation | null>;
  /** Synthesize the dream (+ any transcript) into a structured, editable analysis. Requires `dreams.own`. */
  dreamSynthesize(input: { dreamId: string }): Promise<DreamSynthesisResult>;
  /** Save the person's edits to a dream's analysis (marks it edited); null if absent. Requires `dreams.own`. */
  dreamUpdateAnalysis(input: {
    dreamId: string;
    edits: DreamAnalysisEdits;
  }): Promise<DreamAnalysis | null>;
  /** Approve a dream's analysis into the coach's memory (→ Insight). Requires `dreams.own` + memory enabled. */
  dreamApprove(input: { dreamId: string }): Promise<DreamApproveResult>;
  /** Remove a dream's analysis from the coach's memory (delete its Insight, unlink). Requires `dreams.own`. */
  dreamRemoveFromContext(input: { dreamId: string }): Promise<void>;
  /** Deterministic cross-dream stats over the chosen window (no Claude). Requires `dreams.own`. */
  dreamPatternStats(input: { window: DreamPatternWindow }): Promise<DreamPatternStats>;
  /** The cached cross-dream AI narrative; null until first generated. Requires `dreams.own`. */
  dreamGetPatternSummary(): Promise<DreamPatternSummary | null>;
  /** Generate (and cache) the cross-dream AI narrative — a budget-gated `dream.patterns` call. Requires `dreams.own`. */
  dreamPatternNarrative(): Promise<DreamNarrativeResult>;
  /** Approve the cached narrative into the coach's memory (→ a cross-dream Insight). Requires `dreams.own` + memory enabled. */
  dreamApprovePatternNarrative(): Promise<DreamApproveResult>;
  /** Remove the narrative from context (delete its Insight, unlink). Requires `dreams.own`. */
  dreamRemovePatternNarrative(): Promise<void>;
  /** Related people the dreamer can share a dream insight with. Requires `dreams.own`. */
  dreamShareTargets(): Promise<DreamShareTarget[]>;
  /** The approved Insight a dream produced (facts + sharing); null if not approved. Requires `dreams.own`. */
  dreamGetInsight(dreamId: string): Promise<Insight | null>;
  /** Share/unshare a dream-insight fact with a related person. Requires `dreams.shareContext`. */
  dreamSetFactShare(input: {
    dreamId: string;
    factId: string;
    withPersonId: string;
    share: boolean;
  }): Promise<DreamShareResult>;
  /**
   * Generate (or regenerate) an AI image of one of the active dreamer's dreams (13-dream-images §6).
   * Distills a name-free prompt via Claude, renders it via OpenAI, and stores the encrypted bytes; the
   * OpenAI key is read host-side and never crosses to the renderer. Requires `dreams.generateImage`.
   */
  dreamGenerateImage(input: { dreamId: string; style?: string }): Promise<DreamImageResult>;
  /** The active dreamer's stored dream image as base64 for an `<img>` data URL; null if none. Requires `dreams.generateImage`. */
  dreamGetImage(input: { dreamId: string }): Promise<{ mime: string; dataBase64: string } | null>;
  /** Delete a dream's image (removes the bytes + clears the descriptor). Requires `dreams.generateImage`. */
  dreamDeleteImage(input: { dreamId: string }): Promise<void>;
  /**
   * Export a dream's image to a file the dreamer chooses OUTSIDE the encrypted vault (13-dream-images §3.5).
   * Returns the saved path, or null if cancelled. Requires `dreams.generateImage`, dreamer-scoped.
   */
  dreamExportImage(input: { dreamId: string }): Promise<string | null>;
  /**
   * Share/unshare a dream's image with a related household person (13-dream-images §3.6). Requires
   * `dreams.shareContext`; refuses a sensitive-tier dream + a non-related target.
   */
  dreamSetImageShare(input: {
    dreamId: string;
    targetPersonId: string;
    shared: boolean;
  }): Promise<DreamShareResult>;
  /** A recipient reads an image shared with them (re-gated at read); null if not currently shared. */
  dreamGetSharedImage(input: {
    dreamerId: string;
    dreamId: string;
  }): Promise<{ mime: string; dataBase64: string } | null>;
  /** Every dream image currently shared WITH the active person — the "Shared with you" surface (§3.6). */
  dreamListSharedImages(): Promise<DreamSharedImage[]>;
  // --- Personal onboarding (18-personal-onboarding §6) — gated by `intake.own`, active-person-scoped ---
  /** The active person's resumable intake (session + catalog meta + AI/ack availability). Requires `intake.own`. */
  intakeGetState(): Promise<IntakeState>;
  /**
   * One adaptive interview turn: streams the interviewer reply via `onIntakeChunk`, persists the turn +
   * any direct field fills (the transcript lives under the person, never in Sessions). Requires `intake.own`.
   */
  intakeRunTurn(input: { sectionId: string; userText: string }): Promise<IntakeTurnResult>;
  /** Subscribe to streamed intake interview chunks; returns an unsubscribe function. */
  onIntakeChunk(listener: (delta: string) => void): () => void;
  /** Skip a whole intake section (never blocks completion). Requires `intake.own`. */
  intakeSkipSection(input: { sectionId: string }): Promise<IntakeState>;
  /**
   * Submit a structured **form** section's answers (18 §14.6): fills the mapped owner-only `Person` fields,
   * persists the answers, and marks the section complete. No AI spend. Adult sections need the 18+ ack
   * (enforced in main). Requires `intake.own`; active-person-scoped.
   */
  intakeSubmitForm(input: {
    sectionId: string;
    answers: Record<string, IntakeAnswerValue>;
    /**
     * Per-question relationship-type sharing scopes (43 §6). Any answered question not named here defaults to
     * its category preset server-side. Empty array ⇒ Private (own context only).
     */
    sharing?: Record<string, RelationshipType[]>;
    /**
     * Whether to mark the section complete (default true — the Continue/Done button). Auto-save passes `false`
     * to persist a draft (answers + sharing) without completing a section being filled for the first time.
     */
    complete?: boolean;
  }): Promise<IntakeState>;
  /** The one-time 18+ acknowledgement for the intimacy block (shared with guided sessions). Requires `intake.own`. */
  intakeAcknowledgeAdult(): Promise<IntakeState>;
  /**
   * Change the sharing scope of ONE already-answered intake question (44-memory-dashboard §3.5) — powers the
   * "what you share & with whom" surface's per-answer scope control without re-doing onboarding. Empty `types`
   * ⇒ Private (own context only). Requires `intake.own`; active-person-scoped. Returns `true` when applied.
   */
  intakeSetAnswerSharing(input: {
    sectionId: string;
    questionId: string;
    types: RelationshipType[];
  }): Promise<boolean>;
  /**
   * Run a synthesis pass: with a `sectionId` a light per-section reflection; without one the richer final
   * portrait (→ the portrait Insight + inferred field fills + completion). Requires `intake.own`.
   */
  intakeSynthesize(input: { sectionId?: string }): Promise<IntakeSynthesisResult>;
  // --- Self-assessments / "Tests" (50-self-assessments §6) — own-scoped, gated `tests.own` ---
  /**
   * The catalog the active person may take (display metadata only — never the scoring spec). The 18+ group is
   * filtered out unless `adultAcknowledged` (resolved in the bridge, §3.5). Also reports the ack state so the
   * hub can show the "acknowledge to view" affordance. Empty for a person without `tests.own`.
   */
  testsList(): Promise<{ tests: TestSummary[]; adultAcknowledged: boolean }>;
  /** One test's items + metadata for the Take screen; null (withheld) for a sensitive test when not acked. */
  testsGet(input: { testId: string }): Promise<TestForm | null>;
  /**
   * Deterministically score a take (free, no AI/budget), persist a `TestResult`, bridge the Insight (§5.4), and
   * return the result. Validates the answers + testId; withheld for a sensitive test when not acked. Null if
   * not permitted.
   */
  testsTake(input: {
    testId: string;
    answers: Record<string, unknown>;
  }): Promise<TestResult | null>;
  /** All of the active person's dated results for a test, newest first (history + trend series). */
  testsResults(input: { testId: string }): Promise<TestResult[]>;
  /**
   * The OPTIONAL "what this means for you" AI narrative (§3.3) — explicitly user-triggered, metered
   * `test.narrate`, budget-gated. `costUsd` is admin-only (redacted at the bridge). Typed envelopes for
   * AI-off / no-key / budget / error; the deterministic profile renders regardless.
   */
  testsNarrate(input: { testId: string; resultId: string }): Promise<TestNarrateResponse>;
  /** Record the one-time 18+ acknowledgement (shared with guided sessions + intake); returns the new state. */
  testsAcknowledgeAdult(): Promise<{ tests: TestSummary[]; adultAcknowledged: boolean }>;
  /** Delete one result; if it was the last for that test, its derived Insight is removed too. Returns remaining. */
  testsDeleteResult(input: { testId: string; resultId: string }): Promise<TestResult[]>;
  /** Delete ALL results for a test + the derived Insight. */
  testsDeleteAll(input: { testId: string }): Promise<void>;
  // --- Self-maintaining profile (18-personal-onboarding §15) — own-scoped, gated `intake.own` ---
  /** The active person's pending profile-update suggestions (stale answers noticed by analysis, §15). */
  profileSuggestions(): Promise<ProfileUpdateSuggestion[]>;
  /** Accept a suggestion → write the profile field; returns the remaining pending suggestions. */
  profileAcceptSuggestion(id: string): Promise<ProfileUpdateSuggestion[]>;
  /** Dismiss a suggestion (durable, no re-nag); returns the remaining pending suggestions. */
  profileDismissSuggestion(id: string): Promise<ProfileUpdateSuggestion[]>;
  /** Whether the desktop sidebar is collapsed to an icon rail (device-local). */
  getSidebarCollapsed(): Promise<boolean>;
  /** Persist the sidebar collapsed/expanded state (device-local). */
  setSidebarCollapsed(collapsed: boolean): Promise<void>;
  // --- Discovery (41 §4) — one-time orientation/tip dismissals, device-local + per-person ---
  /** The active person's dismissed one-time discovery hint keys (orientation + tips). */
  getDiscoveryDismissals(): Promise<string[]>;
  /** Replace the active person's dismissed discovery hint keys (device-local, per-person). */
  setDiscoveryDismissals(keys: string[]): Promise<void>;
  // --- Notifications (35-notification-system §6) ---
  /** The active person's device-local notification read/dismissed signatures. */
  getNotificationState(): Promise<PersonNotificationState>;
  /** Replace the active person's notification read/dismissed state (device-local, per-person). */
  setNotificationState(state: PersonNotificationState): Promise<void>;
  /**
   * Questionnaires the active person sent that have ≥1 submitted response (the `responses-arrived` source).
   * Local read — no network; gated by `questionnaires.viewResults` + sender-scoped in the bridge.
   */
  notificationsResponsesArrived(): Promise<ResponsesArrivedSummary[]>;
  /**
   * The active sender's analyzed sends whose recipient has since edited + resubmitted — the `answers-updated`
   * source (56 §3.2), nudging a re-analyze. Sender-scoped, gated `questionnaires.viewResults`, local-only;
   * carries no raw answers.
   */
  notificationsAnswersUpdated(): Promise<AnswersUpdatedSummary[]>;
  /**
   * The active sender's sends still unanswered past the 7-day reminder window — the `reminder-due` source
   * (38 §3.3). Sender-scoped, gated `questionnaires.viewResults`, local-only (no network, no scheduler).
   */
  notificationsRemindersDue(): Promise<ReminderDueSummary[]>;
  /** Open a URL in the user's browser via the main-process shell (the renderer never opens URLs directly). */
  openExternal(url: string): Promise<void>;
  /**
   * Check the public GitHub Releases API for a newer version (36-update-awareness §6). Returns the result
   * (incl. "up to date"), or `null` when the check couldn't be made (offline / rate-limited / timeout) so
   * the UI shows a calm "couldn't check right now". `force` is advisory (the renderer schedules cadence).
   */
  updatesCheck(force?: boolean): Promise<UpdateCheckResult | null>;
  /** The last successful update-check result (cached device-local), or null if none yet. */
  updatesGetState(): Promise<UpdateCheckResult | null>;
}

export type {
  AccessView,
  AlignmentResult,
  Answer,
  Assignment,
  AttachmentRef,
  BootState,
  Budget,
  BudgetState,
  ChatTurnResult,
  CompatibilityGroup,
  CompatibilitySendResult,
  CompatibilityVisibility,
  CompatResultPublish,
  ContextOnlyResult,
  Conversation,
  Dream,
  DreamAnalysis,
  DreamAnalysisEdits,
  DreamApproveResult,
  DreamImageResult,
  DreamInput,
  DreamNarrativeResult,
  DreamPatternStats,
  DreamPatternSummary,
  DreamPatternWindow,
  DreamPersonRef,
  DreamReflectionResult,
  DreamSharedImage,
  DreamShareResult,
  DreamShareTarget,
  DreamSynthesisResult,
  GuidanceState,
  GuidedSuggestResult,
  InAppSendResult,
  InboxAssignmentDetail,
  InboxItem,
  IntimacyTopicsView,
  Insight,
  InsightFact,
  IntakeAnswerValue,
  IntakeSection,
  IntakeSectionMeta,
  IntakeSession,
  IntakeState,
  IntakeSynthesisResult,
  IntakeTurnResult,
  InviteSummary,
  Notification,
  NotificationAction,
  NotificationKind,
  NotificationSeverity,
  PersonNotificationState,
  ProfileUpdateSuggestion,
  Person,
  PersonInput,
  PrivacyMode,
  Questionnaire,
  QuestionnaireInput,
  QuestionnaireSendState,
  QuestionnaireSentOverview,
  SentRecipientSummary,
  QuestionTrend,
  QuestionnaireAggregate,
  RelayLinkResult,
  AnswersUpdatedSummary,
  ReminderDueSummary,
  ResponsesArrivedSummary,
  Relationship,
  RelationshipInput,
  RelationshipType,
  Role,
  SendAnswer,
  SendResult,
  SessionCost,
  SessionStatus,
  SessionSummaryResult,
  UpdateCheckResult,
  UsageEvent,
  UsageSummary,
};

// Challenges / experiments (52-challenge-sessions) — re-exported for the renderer (stores, cards, providers).
export type {
  Challenge,
  ChallengeCheckInResult,
  ChallengeDomain,
  ChallengeOutcome,
  ChallengeStatus,
  ChallengeSuggestion,
  ChallengeSuggestionResult,
} from './schemas';

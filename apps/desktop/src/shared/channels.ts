import type {
  AccessView,
  AlignmentResult,
  Answer,
  AnswerType,
  Assignment,
  BootState,
  Budget,
  BudgetState,
  ChatTurnResult,
  CompatibilityGroup,
  CompatibilitySendResult,
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
  DreamSharedImage,
  DreamShareResult,
  DreamShareTarget,
  DreamSynthesisResult,
  GuidanceState,
  GuidedSuggestResult,
  InboxAssignmentDetail,
  InboxItem,
  InviteSummary,
  Insight,
  InsightFact,
  IntakeSection,
  IntakeSectionMeta,
  IntakeSession,
  IntakeState,
  IntakeSynthesisResult,
  IntakeTurnResult,
  Person,
  RawAccessAuditEntry,
  SendAnswer,
  SendResult,
  PersonInput,
  PrivacyMode,
  Questionnaire,
  QuestionnaireAnalyzeResult,
  QuestionnaireGenerateResult,
  QuestionnaireImproveResult,
  QuestionnaireInput,
  QuestionnaireSuggestResult,
  QuestionTrend,
  Relationship,
  RelationshipInput,
  RelayStatus,
  Role,
  SensitivityTier,
  SessionCost,
  SessionStatus,
  SessionSummaryResult,
  UsageEvent,
  UsageSummary,
} from './schemas';

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
  superadminUnlock: 'superadmin:unlock',
  superadminLock: 'superadmin:lock',
  usageSummary: 'usage:summary',
  budgetGet: 'budget:get',
  budgetGetPerson: 'budget:getPerson',
  budgetSetApp: 'budget:setApp',
  budgetSetPerson: 'budget:setPerson',
  budgetStatus: 'budget:status',
  chatStream: 'chat:stream',
  chatChunk: 'chat:chunk', // main → renderer event
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
  questionnairesGet: 'questionnaires:get',
  questionnairesSave: 'questionnaires:save',
  questionnairesDelete: 'questionnaires:delete',
  questionnairesValidate: 'questionnaires:validate',
  questionnairesListTypes: 'questionnaires:listTypes',
  questionnairesAddType: 'questionnaires:addType',
  questionnairesStoreImage: 'questionnaires:storeImage',
  questionnairesGetImage: 'questionnaires:getImage',
  questionnairesDeleteImage: 'questionnaires:deleteImage',
  questionnairesGenerate: 'questionnaires:generate',
  questionnairesImproveQuestion: 'questionnaires:improveQuestion',
  gapfinderSuggest: 'gapfinder:suggest',
  insightsList: 'insights:list',
  insightsAnalyze: 'insights:analyze',
  insightsApprove: 'insights:approve',
  insightsUpdate: 'insights:update',
  insightsDelete: 'insights:delete',
  assignmentsCreate: 'assignments:create',
  assignmentsInbox: 'assignments:inbox',
  assignmentsGet: 'assignments:get',
  assignmentsOpen: 'assignments:open',
  assignmentsSaveProgress: 'assignments:saveProgress',
  assignmentsSubmit: 'assignments:submit',
  assignmentsDecline: 'assignments:decline',
  assignmentsResults: 'assignments:results',
  assignmentsTrends: 'assignments:trends',
  assignmentsDelete: 'assignments:delete',
  assignmentsCreateCompatibility: 'assignments:createCompatibility',
  assignmentsCompatibility: 'assignments:compatibility',
  assignmentsAlign: 'assignments:align',
  assignmentsRevealRaw: 'assignments:revealRaw',
  assignmentsCreateRelayLink: 'assignments:createRelayLink',
  assignmentsDrain: 'assignments:drain',
  assignmentsRevoke: 'assignments:revoke',
  relayStatus: 'relay:status',
  relayConnect: 'relay:connect',
  relayUpdate: 'relay:update',
  relayTeardown: 'relay:teardown',
  auditList: 'audit:list',
  dreamsList: 'dreams:list',
  dreamGet: 'dreams:get',
  dreamSave: 'dreams:save',
  dreamDelete: 'dreams:delete',
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
  intakeAcknowledgeAdult: 'intake:acknowledgeAdult',
  intakeSynthesize: 'intake:synthesize',
  intakeRevealRestricted: 'intake:revealRestricted',
  getSidebarCollapsed: 'ui:getSidebarCollapsed',
  setSidebarCollapsed: 'ui:setSidebarCollapsed',
} as const;

export type SettingScope = 'vault' | 'device';

/** Minimum length of the owner login PIN set at Setup (10-multi-device-vault §3.2). */
export const MIN_OWNER_PIN_LENGTH = 4;

/** The secret id under which the Claude API key is stored. */
export const ANTHROPIC_API_KEY_ID = 'anthropic.apiKey';

/** The secret id for the OpenAI API key — SelfOS's second provider, for dream images (13-dream-images §6.1). */
export const OPENAI_API_KEY_ID = 'openai.apiKey';

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
   * device-local master key + `vaultPath`/`activePersonId`/`pendingJoinPersonId`, reset super-admin
   * inspect, and return the recomputed (onboarding) boot state. Touches **no** bytes inside the vault —
   * the folder stays intact and re-linkable via its recovery phrase. "Unlink" and "switch" are the same
   * operation; the caller re-enters the existing onboarding folder picker afterward.
   */
  unlinkVault(): Promise<BootState>;
  /** Absolute paths of any sync-conflict copies found in the active vault. */
  getConflicts(): Promise<string[]>;
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
  /** Test the Claude connection with the stored key + selected model. */
  claudeTest(): Promise<ClaudeTestResult>;
  /** Whether the household is set up (master key + owner) and who is active. */
  householdStatus(): Promise<HouseholdStatus>;
  /** First-run setup: create the owner (with a login PIN), set the super-admin passphrase, return the recovery phrase. */
  householdSetup(input: {
    ownerName: string;
    passphrase: string;
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
  /** Switch the active person, verifying their PIN if set. */
  sessionSetActive(input: { personId: string; pin?: string }): Promise<SetActiveResult>;
  /** Verify the concealed super-admin passphrase; on success, main enters inspect-everything mode. */
  superadminUnlock(input: { passphrase: string }): Promise<boolean>;
  /** Leave super-admin inspect mode (clears the main-process bypass). */
  superadminLock(): Promise<void>;
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
  /** Send a chat message: streams reply chunks via `onChatChunk`, resolves with the final turn. */
  chatStream(input: { conversationId: string; userText: string }): Promise<ChatTurnResult>;
  /** Subscribe to streamed reply chunks; returns an unsubscribe function. */
  onChatChunk(listener: (delta: string) => void): () => void;
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
  /** Load one questionnaire definition; null if absent. */
  questionnairesGet(id: string): Promise<Questionnaire | null>;
  /** Create or update a questionnaire definition (editing bumps its version); returns the saved record. */
  questionnairesSave(input: QuestionnaireInput): Promise<Questionnaire>;
  /** Delete a questionnaire definition. */
  questionnairesDelete(id: string): Promise<void>;
  /** Structural problems with a draft (empty array = valid) — for live builder feedback. */
  questionnairesValidate(input: QuestionnaireInput): Promise<string[]>;
  /** The user-defined custom types (vault-stored), for the builder's type picker. Requires `questionnaires.create`. */
  questionnairesListTypes(): Promise<string[]>;
  /** Add a custom type (trimmed, de-duped) and return the updated list. Requires `questionnaires.create`. */
  questionnairesAddType(name: string): Promise<string[]>;
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
    targetPersonId?: string;
    // The author's own shareable data is always used (§15.4); only a *target* person's context is optional.
    includeTarget: boolean;
    includeRelationship: boolean;
    existingPrompts: string[];
  }): Promise<QuestionnaireGenerateResult>;
  /** Reword a single question per an instruction ("warmer", "tighter"). Budget-gated + metered. */
  questionnairesImproveQuestion(input: {
    prompt: string;
    type: AnswerType;
    instruction: string;
  }): Promise<QuestionnaireImproveResult>;
  /** Gap-finder: propose the next questionnaires from structured context. Budget-gated + metered. */
  gapfinderSuggest(input: { targetPersonId?: string }): Promise<QuestionnaireSuggestResult>;
  /** Every Insight across all subject people (the "what the coach knows" / Memory surface). */
  insightsList(): Promise<Insight[]>;
  /** Analyze a submitted assignment's answers into an UNapproved Insight. Budget-gated + metered. */
  insightsAnalyze(input: { assignmentId: string }): Promise<QuestionnaireAnalyzeResult>;
  /** Approve an Insight (apply edits + chosen shareable facts) so it enters the coach's context. */
  insightsApprove(input: {
    subjectPersonId: string;
    id: string;
    summary?: string;
    facts?: { id: string; text: string; shareable: boolean }[];
  }): Promise<Insight | null>;
  /** Edit an existing Insight (summary / facts). */
  insightsUpdate(input: {
    subjectPersonId: string;
    id: string;
    summary?: string;
    facts?: { id: string; text: string; shareable: boolean }[];
  }): Promise<Insight | null>;
  /** Delete an Insight. */
  insightsDelete(input: { subjectPersonId: string; id: string }): Promise<void>;
  /** Send a questionnaire to a household person (in-app), freezing an immutable snapshot at send. */
  assignmentsCreate(input: {
    questionnaireId: string;
    recipientPersonId: string;
    privacy?: PrivacyMode;
    senderVisibleToRecipient?: boolean;
    expiresAt?: string;
  }): Promise<Assignment>;
  /** The active person's Inbox — questionnaires sent to them, newest first. Requires `questionnaires.answer`. */
  assignmentsInbox(): Promise<InboxItem[]>;
  /**
   * The answering view for one Inbox assignment (frozen snapshot + any saved draft answers). Returns
   * null unless the active person is the recipient. Requires `questionnaires.answer`.
   */
  assignmentsGet(assignmentId: string): Promise<InboxAssignmentDetail | null>;
  /** Mark an assignment opened (sent → opened). Recipient-only; requires `questionnaires.answer`. */
  assignmentsOpen(assignmentId: string): Promise<void>;
  /** Save resumable draft answers without submitting. Recipient-only; requires `questionnaires.answer`. */
  assignmentsSaveProgress(input: { assignmentId: string; answers: Answer[] }): Promise<void>;
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
  /**
   * Delete one send (its snapshot + assignment + response + any derived Insight). Allowed for the send's
   * sender or an Owner / super-admin. Requires `questionnaires.viewResults`.
   */
  assignmentsDelete(assignmentId: string): Promise<void>;
  /**
   * Send a **compatibility** questionnaire to TWO household people at once: AI personalizes a variant per
   * recipient, freezing a paired per-recipient snapshot (08-questionnaires §3.6). Budget-gated + metered;
   * requires AI to be on. Requires `questionnaires.create`.
   */
  assignmentsCreateCompatibility(input: {
    questionnaireId: string;
    recipientPersonIdA: string;
    recipientPersonIdB: string;
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
   * Break-glass reveal of a Private send's raw answers (08-questionnaires §8.4) — writes an audit entry
   * first. Permitted only for the concealed super-admin (any send) or the sender of a `senderSeesAll`
   * compatibility send holding `questionnaires.readRaw`. Returns null if not permitted / absent.
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
    recipient: { kind: 'external'; displayName?: string; email?: string; phone?: string };
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
  /** The relay connection status (no secrets) for the send panel + admin Relay setup. */
  relayStatus(): Promise<RelayStatus>;
  /** Connect + deploy the household relay to Cloudflare (admin-only). Returns the new status. */
  relayConnect(input: { apiToken: string; accountId: string }): Promise<RelayStatus>;
  /** Re-deploy the latest relay Worker version (admin-only). */
  relayUpdate(): Promise<RelayStatus>;
  /** Tear down + forget the relay (admin-only). */
  relayTeardown(): Promise<RelayStatus>;
  /** The break-glass raw-access audit trail, newest first. Super-admin only. */
  auditList(): Promise<RawAccessAuditEntry[]>;
  /** The active person's dreams, newest first (12-dreams). Requires `dreams.own`. */
  dreamsList(): Promise<Dream[]>;
  /** Load one of the active person's dreams; null if absent. Requires `dreams.own`. */
  dreamGet(id: string): Promise<Dream | null>;
  /** Create or update one of the active person's dreams; returns the saved record. Requires `dreams.own`. */
  dreamSave(input: DreamInput): Promise<Dream>;
  /** Delete a dream (purges its folder: dream + analysis + transcript). Requires `dreams.own`. */
  dreamDelete(id: string): Promise<void>;
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
  /** The one-time 18+ acknowledgement for the intimacy block (shared with guided sessions). Requires `intake.own`. */
  intakeAcknowledgeAdult(): Promise<IntakeState>;
  /**
   * Run a synthesis pass: with a `sectionId` a light per-section reflection; without one the richer final
   * portrait (→ the portrait Insight + inferred field fills + completion). Requires `intake.own`.
   */
  intakeSynthesize(input: { sectionId?: string }): Promise<IntakeSynthesisResult>;
  /**
   * Break-glass: reveal a person's restricted intake facts ("what weighs on you" / intimacy), writing a
   * vault audit entry BEFORE returning (§8.4). Permitted only for `intake.readRestricted` or the concealed
   * super-admin; null otherwise.
   */
  intakeRevealRestricted(input: { subjectPersonId: string }): Promise<InsightFact[] | null>;
  /** Whether the desktop sidebar is collapsed to an icon rail (device-local). */
  getSidebarCollapsed(): Promise<boolean>;
  /** Persist the sidebar collapsed/expanded state (device-local). */
  setSidebarCollapsed(collapsed: boolean): Promise<void>;
}

export type {
  AccessView,
  AlignmentResult,
  Answer,
  Assignment,
  BootState,
  Budget,
  BudgetState,
  ChatTurnResult,
  CompatibilityGroup,
  CompatibilitySendResult,
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
  DreamSharedImage,
  DreamShareResult,
  DreamShareTarget,
  DreamSynthesisResult,
  GuidanceState,
  GuidedSuggestResult,
  InboxAssignmentDetail,
  InboxItem,
  Insight,
  InsightFact,
  IntakeSection,
  IntakeSectionMeta,
  IntakeSession,
  IntakeState,
  IntakeSynthesisResult,
  IntakeTurnResult,
  InviteSummary,
  Person,
  PersonInput,
  PrivacyMode,
  Questionnaire,
  QuestionnaireInput,
  QuestionTrend,
  RawAccessAuditEntry,
  Relationship,
  RelationshipInput,
  Role,
  SendAnswer,
  SendResult,
  SessionCost,
  SessionStatus,
  SessionSummaryResult,
  UsageEvent,
  UsageSummary,
};

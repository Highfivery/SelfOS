import type {
  AccessView,
  Assignment,
  BootState,
  Budget,
  BudgetState,
  ChatTurnResult,
  Conversation,
  Dream,
  DreamAnalysis,
  DreamAnalysisEdits,
  DreamApproveResult,
  DreamInput,
  DreamNarrativeResult,
  DreamPatternStats,
  DreamPatternSummary,
  DreamPatternWindow,
  DreamShareResult,
  DreamShareTarget,
  DreamSynthesisResult,
  Insight,
  InviteSummary,
  Person,
  PersonInput,
  PrivacyMode,
  Questionnaire,
  QuestionnaireInput,
  Relationship,
  RelationshipInput,
  Role,
  UsageEvent,
  UsageSummary,
} from './schemas';

/**
 * IPC channel names + the renderer-facing bridge type. This module is zod-free so it is safe to
 * import from the sandboxed preload (the `BootState` import is type-only and erased at build time).
 */

export const IpcChannels = {
  getBootState: 'app:getBootState',
  refreshBootState: 'app:refreshBootState',
  getAppVersion: 'app:getVersion',
  selectVaultFolder: 'vault:selectFolder',
  useVault: 'vault:use',
  getConflicts: 'vault:getConflicts',
  revealVault: 'vault:reveal',
  vaultChanged: 'vault:changed', // main → renderer event
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
  assignmentsCreate: 'assignments:create',
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
  getSidebarCollapsed: 'ui:getSidebarCollapsed',
  setSidebarCollapsed: 'ui:setSidebarCollapsed',
} as const;

export type SettingScope = 'vault' | 'device';

/** Minimum length of the owner login PIN set at Setup (10-multi-device-vault §3.2). */
export const MIN_OWNER_PIN_LENGTH = 4;

/** The secret id under which the Claude API key is stored. */
export const ANTHROPIC_API_KEY_ID = 'anthropic.apiKey';

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

/** Lightweight conversation list item (05-conversations). */
export interface ConversationMeta {
  id: string;
  title: string;
  updatedAt: string;
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
  /** Absolute paths of any sync-conflict copies found in the active vault. */
  getConflicts(): Promise<string[]>;
  /** Open the active vault folder in the OS file manager. */
  revealVault(): Promise<void>;
  /** Subscribe to external vault changes; returns an unsubscribe function. */
  onVaultChanged(listener: () => void): () => void;
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
  /** Send a questionnaire to a household person (in-app), freezing an immutable snapshot at send. */
  assignmentsCreate(input: {
    questionnaireId: string;
    recipientPersonId: string;
    privacy?: PrivacyMode;
    senderVisibleToRecipient?: boolean;
    expiresAt?: string;
  }): Promise<Assignment>;
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
  /** Whether the desktop sidebar is collapsed to an icon rail (device-local). */
  getSidebarCollapsed(): Promise<boolean>;
  /** Persist the sidebar collapsed/expanded state (device-local). */
  setSidebarCollapsed(collapsed: boolean): Promise<void>;
}

export type {
  AccessView,
  Assignment,
  BootState,
  Budget,
  BudgetState,
  ChatTurnResult,
  Conversation,
  Dream,
  DreamAnalysis,
  DreamAnalysisEdits,
  DreamApproveResult,
  DreamInput,
  DreamNarrativeResult,
  DreamPatternStats,
  DreamPatternSummary,
  DreamPatternWindow,
  DreamShareResult,
  DreamShareTarget,
  DreamSynthesisResult,
  Insight,
  InviteSummary,
  Person,
  PersonInput,
  PrivacyMode,
  Questionnaire,
  QuestionnaireInput,
  Relationship,
  RelationshipInput,
  Role,
  UsageEvent,
  UsageSummary,
};

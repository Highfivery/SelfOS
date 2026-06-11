import type {
  AccessView,
  BootState,
  Budget,
  BudgetState,
  ChatTurnResult,
  Conversation,
  InviteSummary,
  Person,
  PersonInput,
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
  /** Whether the desktop sidebar is collapsed to an icon rail (device-local). */
  getSidebarCollapsed(): Promise<boolean>;
  /** Persist the sidebar collapsed/expanded state (device-local). */
  setSidebarCollapsed(collapsed: boolean): Promise<void>;
}

export type {
  AccessView,
  BootState,
  Budget,
  BudgetState,
  ChatTurnResult,
  Conversation,
  InviteSummary,
  Person,
  PersonInput,
  Relationship,
  RelationshipInput,
  Role,
  UsageEvent,
  UsageSummary,
};

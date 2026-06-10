import type { BootState, Person } from './schemas';

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
  getActivePerson: 'session:getActivePerson',
} as const;

export type SettingScope = 'vault' | 'device';

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

/** Drives the post-boot household gate (setup vs. the app). */
export interface HouseholdStatus {
  hasMasterKey: boolean;
  hasOwner: boolean;
  activePersonId: string | null;
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
  /** First-run setup: create the owner, set the super-admin passphrase, return the recovery phrase. */
  householdSetup(input: {
    ownerName: string;
    passphrase: string;
  }): Promise<{ recoveryPhrase: string; ownerId: string }>;
  /** The currently active person (decrypted), or null. */
  getActivePerson(): Promise<Person | null>;
}

export type { BootState, Person };

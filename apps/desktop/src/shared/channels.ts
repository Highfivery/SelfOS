import type { BootState } from './schemas';

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
} as const;

export type SettingScope = 'vault' | 'device';

export interface SettingsValues {
  vault: Record<string, unknown>;
  device: Record<string, unknown>;
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
}

export type { BootState };

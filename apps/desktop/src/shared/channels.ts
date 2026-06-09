import type { BootState } from './schemas';

/**
 * IPC channel names + the renderer-facing bridge type. This module is zod-free so it is safe to
 * import from the sandboxed preload (the `BootState` import is type-only and erased at build time).
 */

export const IpcChannels = {
  getBootState: 'app:getBootState',
  refreshBootState: 'app:refreshBootState',
  selectVaultFolder: 'vault:selectFolder',
  useVault: 'vault:use',
  getConflicts: 'vault:getConflicts',
  vaultChanged: 'vault:changed', // main → renderer event
} as const;

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
  /** Subscribe to external vault changes; returns an unsubscribe function. */
  onVaultChanged(listener: () => void): () => void;
}

export type { BootState };

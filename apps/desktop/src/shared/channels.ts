import type { BootState } from './schemas';

/**
 * IPC channel names + the renderer-facing bridge type. This module is zod-free so it is safe to
 * import from the sandboxed preload (the `BootState` import is type-only and erased at build time).
 */

export const IpcChannels = {
  getBootState: 'app:getBootState',
  selectVaultFolder: 'vault:selectFolder',
  useVault: 'vault:use',
  refreshBootState: 'app:refreshBootState',
} as const;

export interface SelfosBridge {
  /** Current boot state (computed from device-local state + vault status). */
  getBootState(): Promise<BootState>;
  /** Open the native folder picker; resolves to the chosen path or null if cancelled. */
  selectVaultFolder(): Promise<string | null>;
  /** Initialize + activate the vault at `path`, then return the recomputed boot state. */
  useVault(path: string): Promise<BootState>;
  /** Recompute the boot state (e.g. after a vault-error retry). */
  refreshBootState(): Promise<BootState>;
}

export type { BootState };

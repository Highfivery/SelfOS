import type { WebContents } from 'electron';
import { IpcChannels } from '../shared/channels';
import { watchVault, type VaultWatcher } from './vault/watcher';

/**
 * Owns the single active vault watcher across its lifetime so it can be (re)started whenever the
 * active vault changes — at a ready boot and again right after onboarding activates a vault.
 */
let current: VaultWatcher | undefined;

export function startVaultWatcher(vaultPath: string, sender: WebContents): void {
  void current?.close();
  current = watchVault(vaultPath, () => {
    if (!sender.isDestroyed()) sender.send(IpcChannels.vaultChanged);
  });
}

export async function stopVaultWatcher(): Promise<void> {
  await current?.close();
  current = undefined;
}

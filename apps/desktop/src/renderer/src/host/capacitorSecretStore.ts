import { registerPlugin } from '@capacitor/core';
import type { SecretStore } from '@selfos/core/host';

/**
 * TS side of the native iOS **`Keychain`** plugin (07-mobile-platform §5.1/§5.3, slice iii-c1): the iOS
 * `SecretStore` host backing the vault master key + Claude API key, replacing the iii-b2 `localStorage`
 * stub. Items live in the iOS Keychain (accessible after first unlock, this device only, not synced); the
 * value never reaches the renderer except through these calls (00-architecture §6.2).
 */
export interface KeychainPlugin {
  get(options: { id: string }): Promise<{ value: string | null }>;
  set(options: { id: string; value: string }): Promise<void>;
  has(options: { id: string }): Promise<{ value: boolean }>;
  remove(options: { id: string }): Promise<void>;
}

export const Keychain = registerPlugin<KeychainPlugin>('Keychain');

/** A core `SecretStore` over the native `Keychain` plugin. `plugin` is injectable for tests. */
export function capacitorSecretStore(plugin: KeychainPlugin = Keychain): SecretStore {
  return {
    async get(id) {
      return (await plugin.get({ id })).value;
    },
    async set(id, value) {
      await plugin.set({ id, value });
    },
    async has(id) {
      return (await plugin.has({ id })).value;
    },
    async clear(id) {
      await plugin.remove({ id });
    },
  };
}

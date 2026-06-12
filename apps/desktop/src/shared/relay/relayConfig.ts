import type { FileSystem } from '@selfos/core/host';
import { RelayConfigSchema, type RelayConfig, type RelayStatus } from '@selfos/core/schemas';
import { readEncryptedJson, writeEncryptedJson } from '@selfos/core/vault';

/**
 * The encrypted per-household relay config (`config/relay.enc`, §4.1) — endpoint + drain secret +
 * Cloudflare token. Lives in the vault so every install pointing at the same folder sends/collects with
 * zero setup, and any admin device manages without re-entering the token. The secrets here are read
 * host-side only; the renderer never sees them (the IPC bridge returns the secret-free `RelayStatus`).
 */
const RELAY_CONFIG_PATH = 'config/relay.enc';

export async function readRelayConfig(
  fs: FileSystem,
  key: Uint8Array,
): Promise<RelayConfig | null> {
  const raw = await readEncryptedJson(fs, RELAY_CONFIG_PATH, key);
  return raw ? RelayConfigSchema.parse(raw) : null;
}

export async function writeRelayConfig(
  fs: FileSystem,
  key: Uint8Array,
  config: RelayConfig,
): Promise<void> {
  await writeEncryptedJson(fs, RELAY_CONFIG_PATH, config, key);
}

export async function clearRelayConfig(fs: FileSystem): Promise<void> {
  await fs.remove(RELAY_CONFIG_PATH);
}

/** The renderer-safe status (no token / drain secret) for the admin Settings → Relay panel. */
export function relayStatusOf(config: RelayConfig | null, currentVersion: string): RelayStatus {
  if (!config) return { configured: false, updateAvailable: false };
  return {
    configured: true,
    endpointUrl: config.endpointUrl,
    relayVersion: config.cloudflare.relayVersion,
    updateAvailable: config.cloudflare.relayVersion !== currentVersion,
  };
}

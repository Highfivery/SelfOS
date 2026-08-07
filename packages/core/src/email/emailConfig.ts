import type { FileSystem, SecretStore } from '../host';
import {
  EmailConfigSchema,
  RESEND_API_KEY_ID,
  type EmailConfig,
  type EmailStatus,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * Household email config (67 §4.1) — `config/email.enc`, encrypted under the master key (the
 * `config/ai-credentials.enc` posture). The Resend key lives INSIDE the encrypted envelope; a device-local
 * `resend.apiKey` override always wins. Read host-side only; the renderer sees the secret-free `EmailStatus`.
 */
const EMAIL_CONFIG_PATH = 'config/email.enc';

export type EmailKeySource = 'device' | 'shared' | 'none';

export interface ResolvedResendKey {
  /** The resolved key, or undefined. Host-side only — never sent to the renderer. */
  key: string | undefined;
  source: EmailKeySource;
}

/** Decrypt + validate `config/email.enc`; null when absent/corrupt (fail-closed, never throws — 67 §7). */
export async function readEmailConfig(
  fs: FileSystem,
  key: Uint8Array,
): Promise<EmailConfig | null> {
  try {
    const raw = await readEncryptedJson(fs, EMAIL_CONFIG_PATH, key);
    return raw ? EmailConfigSchema.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Merge a partial config update (domain / from-address / from-name), stamping `updatedAt`. */
export async function updateEmailConfig(
  fs: FileSystem,
  key: Uint8Array,
  patch: Partial<
    Pick<EmailConfig, 'sendingDomain' | 'fromAddress' | 'fromName' | 'domainVerified'>
  >,
  now: Date,
): Promise<EmailConfig> {
  const existing = (await readEmailConfig(fs, key)) ?? {
    schemaVersion: 1 as const,
    domainVerified: false,
  };
  const next: EmailConfig = {
    ...existing,
    ...patch,
    schemaVersion: 1,
    updatedAt: now.toISOString(),
  };
  await writeEncryptedJson(fs, EMAIL_CONFIG_PATH, next, key);
  return next;
}

/** Set the household-shared Resend key (owner-gated at the bridge). */
export async function writeSharedResendKey(
  fs: FileSystem,
  key: Uint8Array,
  value: string,
  now: Date,
): Promise<void> {
  const existing = (await readEmailConfig(fs, key)) ?? {
    schemaVersion: 1 as const,
    domainVerified: false,
  };
  await writeEncryptedJson(
    fs,
    EMAIL_CONFIG_PATH,
    { ...existing, schemaVersion: 1, resendApiKey: value, updatedAt: now.toISOString() },
    key,
  );
}

/** Drop the shared Resend key (leaves the rest of the config). */
export async function clearSharedResendKey(
  fs: FileSystem,
  key: Uint8Array,
  now: Date,
): Promise<void> {
  const existing = await readEmailConfig(fs, key);
  if (!existing) return;
  const next: EmailConfig = { ...existing, updatedAt: now.toISOString() };
  delete next.resendApiKey;
  await writeEncryptedJson(fs, EMAIL_CONFIG_PATH, next, key);
}

/**
 * Resolve the Resend key host-side (67 §4.1): a device-local override wins, else the vault-shared key, else
 * none. The single key source every send routes through; never returned to the renderer.
 */
export async function resolveResendKey(
  secrets: SecretStore,
  fs: FileSystem,
  key: Uint8Array,
): Promise<ResolvedResendKey> {
  const override = await secrets.get(RESEND_API_KEY_ID);
  if (override) return { key: override, source: 'device' };
  const shared = (await readEmailConfig(fs, key))?.resendApiKey;
  if (shared) return { key: shared, source: 'shared' };
  return { key: undefined, source: 'none' };
}

/** The renderer-safe status (67 §4.1) — booleans + enums, never a key value. */
export async function emailStatusOf(
  secrets: SecretStore,
  fs: FileSystem,
  key: Uint8Array,
  opts?: { intimacyEligible?: boolean },
): Promise<EmailStatus> {
  const config = await readEmailConfig(fs, key);
  const hasDeviceOverride = await secrets.has(RESEND_API_KEY_ID);
  const hasSharedKey = config?.resendApiKey !== undefined;
  const source: EmailKeySource = hasDeviceOverride ? 'device' : hasSharedKey ? 'shared' : 'none';
  return {
    configured: config !== null,
    domainVerified: config?.domainVerified ?? false,
    ...(config?.sendingDomain ? { sendingDomain: config.sendingDomain } : {}),
    ...(config?.fromAddress ? { fromAddress: config.fromAddress } : {}),
    ...(config?.fromName ? { fromName: config.fromName } : {}),
    hasSharedKey,
    hasDeviceOverride,
    // "Ready" needs BOTH a resolvable key AND a from-address — a key with no from-line can't send (the send
    // would fail NOT_CONFIGURED), so don't overstate readiness (it would enable the toggles + retry-loop).
    resolvedReady: source !== 'none' && Boolean(config?.fromAddress),
    source,
    intimacyEligible: opts?.intimacyEligible ?? false,
  };
}

/** The `From:` header line ("Name <addr>") from config, or null when no from-address is set. */
export function fromLineOf(config: EmailConfig | null): string | null {
  if (!config?.fromAddress) return null;
  const name = config.fromName?.trim();
  return name ? `${name} <${config.fromAddress}>` : config.fromAddress;
}

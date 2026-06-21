import type { FileSystem, SecretStore } from '../host';
import {
  AiCredentialsSchema,
  ANTHROPIC_API_KEY_ID,
  OPENAI_API_KEY_ID,
  type AiCredentials,
  type AiProvider,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * Household-shared AI credentials (25-household-ai-credentials). The shared Claude/OpenAI keys live in the
 * vault at `config/ai-credentials.enc`, encrypted under the master key, so member devices inherit them. A
 * device-local override (`secrets.json`) always wins, preserving single-device behaviour. The resolved key
 * value is read host-side and never crosses to the renderer (00-architecture §6.2).
 */

const AI_CREDENTIALS_PATH = 'config/ai-credentials.enc';

/** Where a resolved key came from. */
export type KeySource = 'device' | 'shared' | 'none';

export interface ResolvedKey {
  /** The resolved key value, or undefined when none is available. Host-side only — never sent to the renderer. */
  key: string | undefined;
  source: KeySource;
}

const secretIdFor = (provider: AiProvider): string =>
  provider === 'anthropic' ? ANTHROPIC_API_KEY_ID : OPENAI_API_KEY_ID;

const sharedKeyOf = (creds: AiCredentials | null, provider: AiProvider): string | undefined =>
  provider === 'anthropic' ? creds?.anthropicApiKey : creds?.openaiApiKey;

/**
 * Decrypt + validate `config/ai-credentials.enc`. Returns null when the file is absent, empty, corrupt, or
 * fails to decrypt/validate — resolution then falls through (25 §7), never throwing (the file is treated
 * like any other potentially-corrupt vault file, 00 §7).
 */
export async function readAiCredentials(
  fs: FileSystem,
  key: Uint8Array,
): Promise<AiCredentials | null> {
  try {
    const raw = await readEncryptedJson(fs, AI_CREDENTIALS_PATH, key);
    return raw ? AiCredentialsSchema.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Set one provider's shared key, stamping `updatedAt`/`sharedByPersonId`. Owner-gated at the bridge (§6.2). */
export async function writeSharedKey(
  fs: FileSystem,
  key: Uint8Array,
  input: { provider: AiProvider; value: string; sharedByPersonId?: string; now: Date },
): Promise<void> {
  const existing = (await readAiCredentials(fs, key)) ?? { schemaVersion: 1 };
  const next: AiCredentials = {
    ...existing,
    schemaVersion: 1,
    updatedAt: input.now.toISOString(),
    ...(input.sharedByPersonId ? { sharedByPersonId: input.sharedByPersonId } : {}),
    ...(input.provider === 'anthropic'
      ? { anthropicApiKey: input.value }
      : { openaiApiKey: input.value }),
  };
  await writeEncryptedJson(fs, AI_CREDENTIALS_PATH, next, key);
}

/**
 * Drop one provider's shared key. When neither provider's key remains, the file is deleted so "stop sharing
 * everything" leaves no orphan ciphertext (25 §5.1).
 */
export async function clearSharedKey(
  fs: FileSystem,
  key: Uint8Array,
  input: { provider: AiProvider; now: Date },
): Promise<void> {
  const existing = await readAiCredentials(fs, key);
  if (!existing) return;
  const next: AiCredentials = { ...existing, updatedAt: input.now.toISOString() };
  if (input.provider === 'anthropic') delete next.anthropicApiKey;
  else delete next.openaiApiKey;
  if (next.anthropicApiKey === undefined && next.openaiApiKey === undefined) {
    await fs.remove(AI_CREDENTIALS_PATH);
    return;
  }
  await writeEncryptedJson(fs, AI_CREDENTIALS_PATH, next, key);
}

/**
 * Resolve a provider's key host-side (25 §4.4): a device-local override wins, else the vault-shared key,
 * else none. The single key source used by every AI call site.
 */
export async function resolveKey(
  secrets: SecretStore,
  fs: FileSystem,
  key: Uint8Array,
  provider: AiProvider,
): Promise<ResolvedKey> {
  const override = await secrets.get(secretIdFor(provider));
  if (override) return { key: override, source: 'device' };
  const shared = sharedKeyOf(await readAiCredentials(fs, key), provider);
  if (shared) return { key: shared, source: 'shared' };
  return { key: undefined, source: 'none' };
}

export const resolveAiKey = (
  secrets: SecretStore,
  fs: FileSystem,
  key: Uint8Array,
): Promise<ResolvedKey> => resolveKey(secrets, fs, key, 'anthropic');

export const resolveOpenAiKey = (
  secrets: SecretStore,
  fs: FileSystem,
  key: Uint8Array,
): Promise<ResolvedKey> => resolveKey(secrets, fs, key, 'openai');

/**
 * The renderer-safe readiness for a provider (25 §5.3) — presence booleans + the resolved `source` only,
 * never a key value.
 */
export async function aiKeyStatus(
  secrets: SecretStore,
  fs: FileSystem,
  key: Uint8Array,
  provider: AiProvider,
): Promise<{
  hasSharedKey: boolean;
  hasDeviceOverride: boolean;
  resolvedReady: boolean;
  source: KeySource;
}> {
  const hasDeviceOverride = await secrets.has(secretIdFor(provider));
  const hasSharedKey = sharedKeyOf(await readAiCredentials(fs, key), provider) !== undefined;
  const source: KeySource = hasDeviceOverride ? 'device' : hasSharedKey ? 'shared' : 'none';
  return { hasSharedKey, hasDeviceOverride, resolvedReady: source !== 'none', source };
}

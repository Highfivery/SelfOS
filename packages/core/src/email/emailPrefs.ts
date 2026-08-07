import type { FileSystem } from '../host';
import { uuid } from '../id';
import { EmailPrefsSchema, type EmailFamily, type EmailPrefs } from '../schemas';

/** The mutable subset of prefs the bridge may patch (67 §6). `| undefined` per exactOptionalPropertyTypes. */
export interface EmailPrefsPatch {
  address?: string | undefined;
  families?: Partial<Record<EmailFamily, boolean>> | undefined;
  richness?: 'brief' | 'full' | undefined;
  intimacyEmailOptIn?: boolean | undefined;
  paused?: boolean | undefined;
}
import { readEncryptedJson, writeEncryptedJson } from '../vault';

const prefsPath = (personId: string): string => `people/${personId}/email/prefs.enc`;

/**
 * The effective per-family default (67 §4.2) — one source of truth, applied here rather than in the schema.
 * Conservative + fail-closed: intimacy families OFF by default; everything else ON (a person still receives
 * nothing until they set their engagement `address` and the household connects Resend, §7).
 */
export function defaultFamilyEnabled(family: EmailFamily): boolean {
  return family !== 'ai-suggestion-intimacy';
}

/** Whether a family is enabled for a person: their explicit toggle if set, else the family default. */
export function effectiveFamilyEnabled(prefs: EmailPrefs, family: EmailFamily): boolean {
  return prefs.families[family] ?? defaultFamilyEnabled(family);
}

/** Read a person's email prefs; null when absent/corrupt (fail-closed — no send on a parse error, 67 §7). */
export async function readEmailPrefs(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<EmailPrefs | null> {
  try {
    const raw = await readEncryptedJson(fs, prefsPath(personId), key);
    return raw ? EmailPrefsSchema.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Read the person's prefs, creating a default record (with a freshly-minted unsubscribe token) if absent so
 * the token is minted exactly once. The default record has NO `address`, so it still sends nothing until the
 * person opts in (fail-closed).
 */
export async function ensureEmailPrefs(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  now: Date,
): Promise<EmailPrefs> {
  const existing = await readEmailPrefs(fs, key, personId);
  if (existing) return existing;
  const prefs: EmailPrefs = {
    schemaVersion: 1,
    families: {},
    richness: 'brief',
    intimacyEmailOptIn: false,
    paused: false,
    unsubscribeToken: uuid(),
    updatedAt: now.toISOString(),
  };
  await writeEncryptedJson(fs, prefsPath(personId), prefs, key);
  return prefs;
}

/**
 * Apply a partial prefs update. `intimacyOptIn` is coerced OFF when `eligibleForIntimacy` is false (§8.2 —
 * enforced here so the bridge can pass the eligibility it computed). The unsubscribe token is preserved
 * (minted once). Returns the persisted prefs.
 */
export async function setEmailPrefs(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  patch: EmailPrefsPatch,
  eligibleForIntimacy: boolean,
  now: Date,
): Promise<EmailPrefs> {
  const base = await ensureEmailPrefs(fs, key, personId, now);
  // Only apply keys the caller actually set (a `key: undefined` from a partial parse must not overwrite).
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  const next: EmailPrefs = {
    ...base,
    ...defined,
    ...(patch.families ? { families: { ...base.families, ...patch.families } } : {}),
    schemaVersion: 1,
    updatedAt: now.toISOString(),
  };
  if (!eligibleForIntimacy) next.intimacyEmailOptIn = false;
  // An explicitly-cleared address (empty string) becomes absent → fail-closed.
  if (next.address !== undefined && next.address.trim() === '') delete next.address;
  await writeEncryptedJson(fs, prefsPath(personId), next, key);
  return next;
}

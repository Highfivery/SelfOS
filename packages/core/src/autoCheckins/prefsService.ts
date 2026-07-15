import type { FileSystem } from '../host';
import { uuid } from '../id';
import {
  AutoCheckinConfigSchema,
  type AutoCheckinConfig,
  type AutoCheckinTarget,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * Auto check-ins configuration (63-auto-checkins §4.1/§5.1) — a per-person prefs file (the `CoachingPrefs`
 * precedent). Reads fail CLOSED (absent OR corrupt ⇒ the empty, off config) so a bad file never
 * auto-generates. The on-by-default behaviour is a write-once seed at onboarding completion (`seedDefault…`),
 * not a schema default — so an explicit off (which writes a file) is never re-enabled.
 */

const SCHEMA_VERSION = 1;

const configPath = (authorId: string): string =>
  `people/${authorId}/questionnaires/autoCheckins.enc`;

const EMPTY_CONFIG: AutoCheckinConfig = {
  schemaVersion: SCHEMA_VERSION,
  enabled: false,
  targets: [],
};

/** Read an author's config — fail-closed to the empty/off config on absent or corrupt. */
export async function getAutoCheckinConfig(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
): Promise<AutoCheckinConfig> {
  const raw = await readEncryptedJson(fs, configPath(authorId), key);
  if (!raw) return { ...EMPTY_CONFIG, targets: [] };
  const parsed = AutoCheckinConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...EMPTY_CONFIG, targets: [] };
}

/**
 * Merge a config patch (the master toggle and/or the whole target list) and persist it. The bridge is the
 * trust boundary — it enforces owner-only other-targeting + eligibility coercion (§3.6/§6.2) BEFORE calling
 * this; here we validate the shape and write.
 */
export async function setAutoCheckinConfig(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
  patch: { enabled?: boolean; targets?: AutoCheckinTarget[] },
): Promise<AutoCheckinConfig> {
  const current = await getAutoCheckinConfig(fs, key, authorId);
  const next = AutoCheckinConfigSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    enabled: patch.enabled ?? current.enabled,
    targets: patch.targets ?? current.targets,
  });
  await writeEncryptedJson(fs, configPath(authorId), next, key);
  return next;
}

/** Whether a config file exists at all (any state) — the write-once seed guard. */
export async function hasAutoCheckinConfig(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
): Promise<boolean> {
  return (await readEncryptedJson(fs, configPath(authorId), key)) !== null;
}

/**
 * The onboarding-completion seed (§5.1). If the author has NO config yet AND onboarding is complete, write the
 * default-ON config: enabled, with an enabled SELF stream whose `includeIntimacy` is on (still runtime-gated on
 * the 18+ ack, §3.5). Write-once + idempotent — an existing config (incl. an explicit off) is never
 * overwritten, and a pre-onboarding person is never seeded. Returns whether it seeded (so the caller fires the
 * one-time "Auto check-ins is now on" notice) + the resulting config. Other-target streams are NEVER seeded.
 */
export async function seedDefaultConfigIfAbsent(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
  opts: { onboardingComplete: boolean },
): Promise<{ seeded: boolean; config: AutoCheckinConfig }> {
  const raw = await readEncryptedJson(fs, configPath(authorId), key);
  if (raw) {
    const parsed = AutoCheckinConfigSchema.safeParse(raw);
    return {
      seeded: false,
      config: parsed.success ? parsed.data : { ...EMPTY_CONFIG, targets: [] },
    };
  }
  if (!opts.onboardingComplete) return { seeded: false, config: { ...EMPTY_CONFIG, targets: [] } };
  const config: AutoCheckinConfig = {
    schemaVersion: SCHEMA_VERSION,
    enabled: true,
    targets: [
      {
        id: uuid(),
        target: { kind: 'self' },
        enabled: true,
        includeIntimacy: true,
        explorationFocus: '',
        cadence: 'daily',
      },
    ],
  };
  await writeEncryptedJson(fs, configPath(authorId), config, key);
  return { seeded: true, config };
}

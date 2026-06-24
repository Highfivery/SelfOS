import type { FileSystem } from '../host';
import {
  CoachingPrefsSchema,
  DEFAULT_PROACTIVITY,
  type CoachingPrefs,
  type ProactivityLevel,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * Per-person coaching preferences (40-proactive-coaching §4.1a). The proactivity level lives here — NOT in
 * the household-wide schema-driven settings registry (whose `vault`/`device` scopes can't express
 * per-active-person), mirroring the per-person `GuidancePrefs` (16 §8.3). Read in the bridge with `personId`
 * wherever proactivity gates a behaviour (in-session raise §3.1, synthesis cadence §3.4, goal-followup §3.2).
 *
 * Privacy: per-subject only — the bridge scopes the `coaching:*` channels to the active person (the trust
 * boundary). Absent ⇒ DEFAULT_PROACTIVITY ('gentle').
 */

const SCHEMA_VERSION = 1;

const prefsPath = (personId: string): string => `people/${personId}/coaching/prefs.enc`;

export async function getCoachingPrefs(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<CoachingPrefs> {
  const raw = await readEncryptedJson(fs, prefsPath(personId), key);
  return raw ? CoachingPrefsSchema.parse(raw) : { schemaVersion: SCHEMA_VERSION };
}

/** The effective proactivity level for a person (absent ⇒ the default). */
export async function getProactivity(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<ProactivityLevel> {
  const prefs = await getCoachingPrefs(fs, key, personId);
  return prefs.proactivity ?? DEFAULT_PROACTIVITY;
}

export async function setCoachingPrefs(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  patch: { proactivity: ProactivityLevel },
): Promise<CoachingPrefs> {
  const prefs: CoachingPrefs = { schemaVersion: SCHEMA_VERSION, proactivity: patch.proactivity };
  await writeEncryptedJson(fs, prefsPath(personId), prefs, key);
  return prefs;
}

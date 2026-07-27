import type { FileSystem } from '../host';
import {
  ImagePrefsSchema,
  type FeatureImagePrefs,
  type ImageFeature,
  type ImagePrefs,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * Per-person image preferences (spec 08 image-settings amendment / 13 §16): style, style direction, and the
 * on/off toggle, split PER USE-TYPE (dreams vs your story). One encrypted doc per person at
 * `people/<personId>/imagePrefs.enc` (the per-person `guidance/prefs.enc` precedent).
 *
 * Per-person isolation is the whole point: one household member changing their style must NEVER overwrite
 * another's (the reported bug — image style used to be a single household vault value). The image MODEL and
 * the OpenAI key stay owner-managed (a vault setting + a device secret), read separately by the bridge.
 */

const SCHEMA_VERSION = 1;

const docPath = (personId: string): string => `people/${personId}/imagePrefs.enc`;

/** Sensible per-feature defaults for someone who hasn't personalized theirs yet (generation off by default). */
export const DEFAULT_IMAGE_PREFS: ImagePrefs = {
  schemaVersion: SCHEMA_VERSION,
  dreams: { enabled: false, style: 'dreamlike', styleNotes: '' },
  story: { enabled: false, style: 'oil painting', styleNotes: '' },
};

/** Read a person's image prefs, falling back to the defaults for anything unset (never throws). */
export async function readImagePrefs(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<ImagePrefs> {
  const raw = await readEncryptedJson(fs, docPath(personId), key);
  if (!raw) return DEFAULT_IMAGE_PREFS;
  const parsed = ImagePrefsSchema.safeParse(raw);
  // A corrupt/partial doc degrades to defaults rather than throwing out of a read generation depends on;
  // merge each feature so a doc missing one feature still resolves the other.
  if (!parsed.success) {
    const loose = (raw ?? {}) as Partial<Record<ImageFeature, Partial<FeatureImagePrefs>>>;
    return {
      schemaVersion: SCHEMA_VERSION,
      dreams: { ...DEFAULT_IMAGE_PREFS.dreams, ...(loose.dreams ?? {}) },
      story: { ...DEFAULT_IMAGE_PREFS.story, ...(loose.story ?? {}) },
    };
  }
  return parsed.data;
}

/** A single feature's resolved prefs (defaults filled in). */
export async function readFeatureImagePrefs(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  feature: ImageFeature,
): Promise<FeatureImagePrefs> {
  return (await readImagePrefs(fs, key, personId))[feature];
}

/** Patch one feature's prefs for a person and persist; returns the full updated prefs. */
export async function setFeatureImagePrefs(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  feature: ImageFeature,
  patch: Partial<FeatureImagePrefs>,
): Promise<ImagePrefs> {
  const current = await readImagePrefs(fs, key, personId);
  const next: ImagePrefs = {
    ...current,
    schemaVersion: SCHEMA_VERSION,
    [feature]: {
      ...current[feature],
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.style !== undefined && patch.style.trim() ? { style: patch.style.trim() } : {}),
      ...(patch.styleNotes !== undefined ? { styleNotes: patch.styleNotes.slice(0, 300) } : {}),
    },
  };
  await writeEncryptedJson(fs, docPath(personId), next, key);
  return next;
}

import type { FileSystem } from '../host';
import { QuestionnairePrefsSchema, type QuestionnairePrefs } from '../schemas';
import { PREFS_PATH } from './paths';

/**
 * The user-defined **custom questionnaire types** (08-questionnaires §4.1/§4.2). These persist in the
 * vault's plain-JSON prefs file (`config/questionnaires.json`) so a type the user names reappears in
 * the builder's type picker on every future questionnaire — and, being in the vault, is shared across
 * every device pointing at the same folder. The starter taxonomy lives in the renderer; only the
 * custom additions are stored here.
 *
 * Stored plain (not encrypted), mirroring `config/settings.json`: these are non-secret prefs, not
 * coaching content. (Default message templates will join this file with the relay slice.)
 */

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const EMPTY_PREFS: QuestionnairePrefs = { schemaVersion: 1, customTypes: [] };

/**
 * Keys this file used to hold and no longer reads. Owner decision 2026-08-14: the retired custom intimacy
 * topics are DELETED from the vault rather than left to sit there invisibly. `writePrefs` preserves unknown
 * keys on purpose (never erase authored content as a side effect of an unrelated save), so retiring a field
 * has to be an explicit, named act — this list is that act, and the reader below performs it once.
 */
const RETIRED_PREFS_KEYS = ['customIntimacyActivities', 'customIntimacyFantasies'] as const;

/** Strip the retired keys, once, the first time the file is read after this shipped. Idempotent: after the
 *  rewrite the keys are gone, the guard never fires again, and a file that never had them is untouched. */
async function cleanupRetiredKeys(fs: FileSystem, raw: Record<string, unknown>): Promise<void> {
  if (!RETIRED_PREFS_KEYS.some((k) => k in raw)) return;
  const cleaned = { ...raw };
  for (const k of RETIRED_PREFS_KEYS) delete cleaned[k];
  await fs.writeAtomic(PREFS_PATH, encoder.encode(`${JSON.stringify(cleaned, null, 2)}\n`));
}

async function readPrefs(fs: FileSystem): Promise<QuestionnairePrefs> {
  const bytes = await fs.read(PREFS_PATH);
  if (!bytes) return EMPTY_PREFS;
  try {
    const raw: unknown = JSON.parse(decoder.decode(bytes));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      await cleanupRetiredKeys(fs, raw as Record<string, unknown>);
    }
    return QuestionnairePrefsSchema.parse(raw);
  } catch {
    // A corrupt or hand-edited file must never break authoring — fall back to no custom types.
    return EMPTY_PREFS;
  }
}

/**
 * Write the prefs, PRESERVING any keys the current schema doesn't know about.
 *
 * Zod strips unknown keys, so a plain `parse` → write round-trip would silently delete them on the next
 * unrelated save. That matters for retired fields: the Owner's curated `customIntimacyActivities` /
 * `customIntimacyFantasies` stopped being read on 2026-08-13, and quietly erasing content someone authored —
 * as a side effect of adding a custom TYPE, with no prompt and no way back — is not ours to do. Merging over
 * the raw file leaves them untouched and inert.
 */
async function writePrefs(fs: FileSystem, prefs: QuestionnairePrefs): Promise<void> {
  let existing: Record<string, unknown> = {};
  const bytes = await fs.read(PREFS_PATH);
  if (bytes) {
    try {
      const raw: unknown = JSON.parse(decoder.decode(bytes));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        existing = raw as Record<string, unknown>;
      }
    } catch {
      // A corrupt file is replaced wholesale — there is nothing to preserve.
    }
  }
  const merged = { ...existing, ...prefs };
  await fs.writeAtomic(PREFS_PATH, encoder.encode(`${JSON.stringify(merged, null, 2)}\n`));
}

/** List the user-defined custom types, sorted case-insensitively for a stable picker order. */
export async function listCustomTypes(fs: FileSystem): Promise<string[]> {
  const { customTypes } = await readPrefs(fs);
  return [...customTypes].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * Add a custom type and return the updated list. The name is trimmed; blank names are rejected and a
 * case-insensitive duplicate (of a custom OR — via `reserved` — a starter type) is a no-op, so the
 * picker never shows the same type twice.
 */
export async function addCustomType(
  fs: FileSystem,
  name: string,
  reserved: readonly string[] = [],
): Promise<string[]> {
  const trimmed = name.trim();
  if (trimmed === '') throw new Error('A custom type needs a name.');
  const prefs = await readPrefs(fs);
  const taken = new Set([...prefs.customTypes, ...reserved].map((t) => t.toLocaleLowerCase()));
  if (!taken.has(trimmed.toLocaleLowerCase())) {
    await writePrefs(fs, { ...prefs, customTypes: [...prefs.customTypes, trimmed] });
  }
  return listCustomTypes(fs);
}

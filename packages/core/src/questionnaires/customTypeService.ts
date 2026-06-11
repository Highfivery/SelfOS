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

async function readPrefs(fs: FileSystem): Promise<QuestionnairePrefs> {
  const bytes = await fs.read(PREFS_PATH);
  if (!bytes) return EMPTY_PREFS;
  try {
    return QuestionnairePrefsSchema.parse(JSON.parse(decoder.decode(bytes)));
  } catch {
    // A corrupt or hand-edited file must never break authoring — fall back to no custom types.
    return EMPTY_PREFS;
  }
}

async function writePrefs(fs: FileSystem, prefs: QuestionnairePrefs): Promise<void> {
  await fs.writeAtomic(PREFS_PATH, encoder.encode(`${JSON.stringify(prefs, null, 2)}\n`));
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

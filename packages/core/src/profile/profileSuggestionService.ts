import type { FileSystem } from '../host';
import { uuid } from '../id';
import {
  PERSON_FIELD_KEYS,
  ProfileUpdateSuggestionSchema,
  type PersonFieldKey,
  type ProfileUpdateSuggestion,
  type RawProfileSuggestion,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { getPerson, savePerson } from '../people/peopleService';

/**
 * The self-maintaining-profile service (18-personal-onboarding §15). Profile-update **suggestions** are a
 * by-product of the analysis passes that already run (no extra AI spend, §15.1): a producer hands the raw
 * suggestions its analysis emitted to `recordSuggestionsFromAnalysis`, which validates them against the real
 * `Person` field keys, dedups against existing pending/dismissed ones (no nagging), and persists them
 * per-subject. They are **proposals, never edits** — `acceptSuggestion` is the only path that writes a field,
 * and only on the person's explicit confirmation; `dismissSuggestion` is durable.
 */

export const SCHEMA_VERSION = 1;
/** The per-subject profile-suggestions directory (shared by the §15 freshness + §29 depth records). */
export const suggestionsDir = (personId: string): string =>
  `people/${personId}/profile-suggestions`;
/** A single suggestion's encrypted file path (reused by the §29 depth-invitation recorder). */
export const suggestionPath = (personId: string, id: string): string =>
  `${suggestionsDir(personId)}/${id}.enc`;
const dir = suggestionsDir;
const path = suggestionPath;

const FIELD_KEYS = new Set<string>(PERSON_FIELD_KEYS);
// List-valued Person fields — an accepted value for one is split on commas (others are scalar strings).
const LIST_FIELDS = new Set<PersonFieldKey>(['interests', 'values', 'languages']);

/** All of a subject's suggestions, newest first. */
export async function listProfileSuggestions(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<ProfileUpdateSuggestion[]> {
  const out: ProfileUpdateSuggestion[] = [];
  for (const name of await fs.list(dir(personId))) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(fs, `${dir(personId)}/${name}`, key);
    if (raw) out.push(ProfileUpdateSuggestionSchema.parse(raw));
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** The pending suggestions only (what the nudge + review surface show). */
export async function listPendingSuggestions(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<ProfileUpdateSuggestion[]> {
  return (await listProfileSuggestions(fs, key, personId)).filter((s) => s.status === 'pending');
}

/**
 * Record the profile-update suggestions an analysis pass emitted (§15.1/§15.2). Only deltas that target a
 * real `Person` field are kept. Dedup: a delta whose (field, observed) already exists as **pending** is a
 * no-op; one that matches a prior **dismissed** delta is dropped (no re-nagging); a new observed value for a
 * field **supersedes** that field's prior pending suggestion (don't stack three "update occupation" cards).
 */
export async function recordSuggestionsFromAnalysis(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  raw: RawProfileSuggestion[],
  sourceKind: ProfileUpdateSuggestion['sourceKind'],
  sourceInsightId: string,
  restricted: boolean,
  now: Date,
): Promise<void> {
  if (raw.length === 0) return;
  const at = now.toISOString();
  const existing = await listProfileSuggestions(fs, key, personId);
  const sameDelta = (s: ProfileUpdateSuggestion, field: string, observed: string): boolean =>
    s.field === field && s.observed.trim().toLowerCase() === observed.trim().toLowerCase();

  for (const r of raw) {
    const field = r.field.trim();
    const observed = r.observed.trim();
    if (!observed || !FIELD_KEYS.has(field)) continue; // ignore non-field / empty deltas (trust boundary)
    // No re-nag: skip if this exact delta was already dismissed or is already pending.
    if (existing.some((s) => sameDelta(s, field, observed) && s.status !== 'accepted')) continue;
    // Supersede this field's prior PENDING suggestion (a newer reading wins).
    for (const stale of existing.filter((s) => s.field === field && s.status === 'pending')) {
      await fs.remove(path(personId, stale.id));
    }
    const suggestion: ProfileUpdateSuggestion = {
      id: uuid(),
      schemaVersion: SCHEMA_VERSION,
      subjectPersonId: personId,
      kind: 'field',
      field: field as PersonFieldKey,
      observed,
      ...(r.current?.trim() ? { current: r.current.trim() } : {}),
      rationale: r.rationale.trim(),
      sourceInsightId,
      sourceKind,
      restricted,
      status: 'pending',
      createdAt: at,
      updatedAt: at,
    };
    await writeEncryptedJson(fs, path(personId, suggestion.id), suggestion, key);
  }
}

/**
 * Accept a suggestion — the ONLY path that writes a profile field (§15.3), on the person's explicit
 * confirmation. Fills the mapped `Person` field with the observed value (list fields split on commas) and
 * marks the suggestion accepted. Returns the updated suggestion, or null if absent.
 */
export async function acceptSuggestion(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  id: string,
  now: Date,
): Promise<ProfileUpdateSuggestion | null> {
  const raw = await readEncryptedJson(fs, path(personId, id), key);
  if (!raw) return null;
  const suggestion = ProfileUpdateSuggestionSchema.parse(raw);
  const at = now.toISOString();

  if (suggestion.kind === 'field' && suggestion.field) {
    const person = await getPerson(fs, key, personId);
    if (person) {
      const k = suggestion.field;
      if (LIST_FIELDS.has(k)) {
        const items = suggestion.observed
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        (person as Record<string, unknown>)[k] = items;
      } else {
        (person as Record<string, unknown>)[k] = suggestion.observed;
      }
      await savePerson(fs, key, { ...person, updatedAt: at });
    }
  }

  const accepted: ProfileUpdateSuggestion = { ...suggestion, status: 'accepted', updatedAt: at };
  await writeEncryptedJson(fs, path(personId, id), accepted, key);
  return accepted;
}

/** Dismiss a suggestion — durable (the same delta won't re-nag, §15.3). Returns the updated one, or null. */
export async function dismissSuggestion(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  id: string,
  now: Date,
): Promise<ProfileUpdateSuggestion | null> {
  const raw = await readEncryptedJson(fs, path(personId, id), key);
  if (!raw) return null;
  const suggestion = ProfileUpdateSuggestionSchema.parse(raw);
  const dismissed: ProfileUpdateSuggestion = {
    ...suggestion,
    status: 'dismissed',
    updatedAt: now.toISOString(),
  };
  await writeEncryptedJson(fs, path(personId, id), dismissed, key);
  return dismissed;
}

/**
 * Read-time migrations for Person + Relationship records (15-shareability §4.3). The single behavioural
 * change is the **notes merge**: `publicNotes` + `privateNotes` collapse into one `notes` field. Because
 * that changes a persisted shape, it bumps `schemaVersion` to 2 and runs a one-time, idempotent transform
 * on read — applied here (in core) rather than the desktop migration runner, since the people/relationship
 * services read encrypted records directly. The purely-additive `privateFields` / `notesShared` /
 * `informsContext` flags need no migration (absent ⇒ the shared default).
 */

export const PERSON_SCHEMA_VERSION = 2;
export const RELATIONSHIP_SCHEMA_VERSION = 2;

/** Combine two optional note strings into the merged `notes` value — trimmed, blank-dropped, blank ⇒ ''. */
function mergeNotes(pub: unknown, priv: unknown): string {
  return [pub, priv]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Migrate a raw Person record up to v2 before Zod validation. Idempotent: a v2 record (no legacy notes
 * keys) is returned unchanged. A v1 record merges its `publicNotes`/`privateNotes` into `notes`, drops the
 * two old keys, and stamps `schemaVersion: 2`. The default-share flip is implicit — `privateFields` stays
 * absent, so every field reads as shared (15-shareability §4.3).
 */
export function migratePersonRaw(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const data = { ...(raw as Record<string, unknown>) };
  const version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 1;
  if (version >= PERSON_SCHEMA_VERSION) return data;

  if (data.notes === undefined) {
    const merged = mergeNotes(data.publicNotes, data.privateNotes);
    if (merged) data.notes = merged;
  }
  delete data.publicNotes;
  delete data.privateNotes;
  data.schemaVersion = PERSON_SCHEMA_VERSION;
  return data;
}

/** Migrate a raw Relationship record up to v2 (the same notes merge as Person, 15-shareability §4.3b). */
export function migrateRelationshipRaw(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const data = { ...(raw as Record<string, unknown>) };
  const version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 1;
  if (version >= RELATIONSHIP_SCHEMA_VERSION) return data;

  if (data.notes === undefined) {
    const merged = mergeNotes(data.publicNotes, data.privateNotes);
    if (merged) data.notes = merged;
  }
  delete data.publicNotes;
  delete data.privateNotes;
  data.schemaVersion = RELATIONSHIP_SCHEMA_VERSION;
  return data;
}

import { describe, expect, it } from 'vitest';
import {
  PERSON_SCHEMA_VERSION,
  RELATIONSHIP_SCHEMA_VERSION,
  migratePersonRaw,
  migrateRelationshipRaw,
} from './migrations';

describe('migratePersonRaw (notes merge, 15-shareability §4.3)', () => {
  it('combines publicNotes + privateNotes into notes and drops the old keys', () => {
    const out = migratePersonRaw({
      id: 'p1',
      schemaVersion: 1,
      displayName: 'Alex',
      publicNotes: 'likes hiking',
      privateNotes: 'anxious about work',
    }) as Record<string, unknown>;
    expect(out.notes).toBe('likes hiking\n\nanxious about work');
    expect(out.publicNotes).toBeUndefined();
    expect(out.privateNotes).toBeUndefined();
    expect(out.schemaVersion).toBe(PERSON_SCHEMA_VERSION);
  });

  it('handles only one of the two notes (no leading/trailing blank join)', () => {
    expect(
      (migratePersonRaw({ schemaVersion: 1, publicNotes: 'only public' }) as { notes: string })
        .notes,
    ).toBe('only public');
    expect(
      (migratePersonRaw({ schemaVersion: 1, privateNotes: 'only private' }) as { notes: string })
        .notes,
    ).toBe('only private');
  });

  it('leaves notes absent when both are empty/whitespace', () => {
    const out = migratePersonRaw({
      schemaVersion: 1,
      publicNotes: '  ',
      privateNotes: '',
    }) as Record<string, unknown>;
    expect(out.notes).toBeUndefined();
    expect(out.schemaVersion).toBe(PERSON_SCHEMA_VERSION);
  });

  it('is idempotent — a v2 record passes through unchanged', () => {
    const v2 = { id: 'p1', schemaVersion: 2, displayName: 'Alex', notes: 'already merged' };
    expect(migratePersonRaw(v2)).toEqual(v2);
  });

  it('does not grandfather: the default-share flip is implicit (no privateFields stamped)', () => {
    const out = migratePersonRaw({ schemaVersion: 1, privateNotes: 'was private' }) as Record<
      string,
      unknown
    >;
    expect(out.privateFields).toBeUndefined(); // absent ⇒ shared (the literal flip)
    expect(out.notes).toBe('was private');
  });
});

describe('migrateRelationshipRaw (notes merge, 15-shareability §4.3b)', () => {
  it('merges relationship publicNotes + privateNotes and bumps the version', () => {
    const out = migrateRelationshipRaw({
      id: 'r1',
      schemaVersion: 1,
      publicNotes: 'married five years',
      privateNotes: 'it has been rocky',
    }) as Record<string, unknown>;
    expect(out.notes).toBe('married five years\n\nit has been rocky');
    expect(out.publicNotes).toBeUndefined();
    expect(out.privateNotes).toBeUndefined();
    expect(out.notesShared).toBeUndefined(); // absent ⇒ shared
    expect(out.schemaVersion).toBe(RELATIONSHIP_SCHEMA_VERSION);
  });
});

import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { Insight, Person, Relationship } from '../schemas';
import { saveInsight } from '../insights';
import { savePerson } from './peopleService';
import { saveRelationship } from './relationshipService';
import {
  ageFromBirthday,
  buildContext,
  buildDepictionNote,
  buildLinkedPeopleContext,
} from './buildContext';

const key = generateMasterKey();

function person(id: string, displayName: string, extra: Partial<Person> = {}): Person {
  return {
    id,
    schemaVersion: 1,
    displayName,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
    ...extra,
  };
}

function insight(id: string, subjectPersonId: string, over: Partial<Insight> = {}): Insight {
  return {
    id,
    schemaVersion: 1,
    source: 'questionnaire',
    subjectPersonId,
    summary: `summary-${id}`,
    facts: [],
    confidence: 'medium',
    approved: true,
    provenance: { at: 'now' },
    createdAt: 'now',
    updatedAt: 'now',
    ...over,
  };
}

describe('buildContext', () => {
  it("includes own notes and others' shareable notes, but never others' private notes", async () => {
    const fs = memFileSystem();
    await savePerson(
      fs,
      key,
      person('a', 'Alex', { publicNotes: 'likes hiking', privateNotes: 'anxious about work' }),
    );
    await savePerson(
      fs,
      key,
      person('b', 'Sam', { publicNotes: 'a nurse', privateNotes: 'SECRET-SAM' }),
    );
    const rel: Relationship = {
      id: 'r1',
      schemaVersion: 1,
      fromPersonId: 'a',
      toPersonId: 'b',
      type: 'partner',
      createdAt: 'now',
      updatedAt: 'now',
    };
    await saveRelationship(fs, key, rel);

    const ctx = await buildContext(fs, key, 'a');
    expect(ctx).toContain('Alex');
    expect(ctx).toContain('likes hiking'); // own shareable
    expect(ctx).toContain('anxious about work'); // own private — it's their own session
    expect(ctx).toContain('Sam'); // related person
    expect(ctx).toContain('a nurse'); // related person's shareable
    expect(ctx).not.toContain('SECRET-SAM'); // related person's private — excluded
  });

  it("appends own approved insights and related people's shareable facts (not their private)", async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('a', 'Alex'));
    await savePerson(fs, key, person('b', 'Sam'));
    const rel: Relationship = {
      id: 'r1',
      schemaVersion: 1,
      fromPersonId: 'a',
      toPersonId: 'b',
      type: 'partner',
      createdAt: 'now',
      updatedAt: 'now',
    };
    await saveRelationship(fs, key, rel);

    await saveInsight(fs, key, insight('i1', 'a', { summary: 'Alex values clear communication' }));
    await saveInsight(
      fs,
      key,
      insight('i2', 'b', {
        facts: [
          { id: 'f1', text: 'Sam just got promoted', shareable: true },
          { id: 'f2', text: 'SAM-PRIVATE', shareable: false },
        ],
      }),
    );

    const ctx = await buildContext(fs, key, 'a');
    expect(ctx).toContain('Alex values clear communication'); // own approved insight
    expect(ctx).toContain('Sam just got promoted'); // shareable fact about a related person
    expect(ctx).not.toContain('SAM-PRIVATE'); // never a related person's private fact
  });

  it('surfaces shareable descriptive fields (own + related) but private ones only for the person themself', async () => {
    const fs = memFileSystem();
    await savePerson(
      fs,
      key,
      person('a', 'Alex', {
        occupation: 'nurse',
        interests: ['hiking', 'pottery'],
        healthNotes: 'ALEX-HEALTH-SECRET',
        faith: 'ALEX-FAITH-SECRET',
      }),
    );
    await savePerson(
      fs,
      key,
      person('b', 'Sam', {
        appearanceDescription: 'tall with curly hair',
        ethnicity: 'Korean',
        healthNotes: 'SAM-HEALTH-SECRET',
        faith: 'SAM-FAITH-SECRET',
      }),
    );
    const rel: Relationship = {
      id: 'r1',
      schemaVersion: 1,
      fromPersonId: 'a',
      toPersonId: 'b',
      type: 'partner',
      createdAt: 'now',
      updatedAt: 'now',
    };
    await saveRelationship(fs, key, rel);

    const ctx = await buildContext(fs, key, 'a');
    // Own shareable + own private descriptive fields both appear (their own session).
    expect(ctx).toContain('Occupation: nurse');
    expect(ctx).toContain('Interests: hiking, pottery');
    expect(ctx).toContain('ALEX-HEALTH-SECRET'); // own private — allowed in their own block
    expect(ctx).toContain('ALEX-FAITH-SECRET');
    // A related person's shareable descriptive fields appear...
    expect(ctx).toContain('tall with curly hair');
    expect(ctx).toContain('Ethnicity: Korean');
    // ...but a related person's PRIVATE descriptive fields never do.
    expect(ctx).not.toContain('SAM-HEALTH-SECRET');
    expect(ctx).not.toContain('SAM-FAITH-SECRET');
  });

  it('returns empty for an unknown person', async () => {
    expect(await buildContext(memFileSystem(), key, 'nope')).toBe('');
  });
});

describe('buildLinkedPeopleContext', () => {
  it("includes a linked person's shareable data and relationship, never their private notes/facts", async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('a', 'Alex'));
    await savePerson(
      fs,
      key,
      person('b', 'Sam', { publicNotes: 'a nurse', privateNotes: 'SAM-PRIVATE-NOTE' }),
    );
    const rel: Relationship = {
      id: 'r1',
      schemaVersion: 1,
      fromPersonId: 'a',
      toPersonId: 'b',
      type: 'partner',
      publicNotes: 'married five years',
      createdAt: 'now',
      updatedAt: 'now',
    };
    await saveRelationship(fs, key, rel);
    await saveInsight(
      fs,
      key,
      insight('i2', 'b', {
        facts: [
          { id: 'f1', text: 'Sam just got promoted', shareable: true },
          { id: 'f2', text: 'SAM-PRIVATE-FACT', shareable: false },
        ],
      }),
    );

    const ctx = await buildLinkedPeopleContext(fs, key, 'a', ['b']);
    expect(ctx).toContain('appeared in this dream');
    expect(ctx).toContain('Sam');
    expect(ctx).toContain('(partner)'); // the relationship type
    expect(ctx).toContain('married five years'); // relationship public notes
    expect(ctx).toContain('a nurse'); // their public notes
    expect(ctx).toContain('Sam just got promoted'); // their shareable fact
    expect(ctx).not.toContain('SAM-PRIVATE-NOTE'); // their private notes — excluded
    expect(ctx).not.toContain('SAM-PRIVATE-FACT'); // their non-shareable fact — excluded
  });

  it('surfaces a linked NON-relation (public notes only), still excluding private data', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('a', 'Alex'));
    await savePerson(
      fs,
      key,
      person('c', 'Casey', { publicNotes: 'an old colleague', privateNotes: 'CASEY-PRIVATE' }),
    );
    // No relationship between a and c — but "all household people" are linkable (12 §3.1 decision).
    const ctx = await buildLinkedPeopleContext(fs, key, 'a', ['c']);
    expect(ctx).toContain('Casey');
    expect(ctx).toContain('an old colleague');
    expect(ctx).not.toContain('('); // no relationship type parenthetical when there's no relationship
    expect(ctx).not.toContain('CASEY-PRIVATE');
  });

  it("surfaces a linked person's shareable descriptive fields, never their private health/faith", async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('a', 'Alex'));
    await savePerson(
      fs,
      key,
      person('b', 'Sam', {
        appearanceDescription: 'tall with curly hair',
        ethnicity: 'Korean',
        healthNotes: 'SAM-HEALTH-SECRET',
        faith: 'SAM-FAITH-SECRET',
      }),
    );
    const ctx = await buildLinkedPeopleContext(fs, key, 'a', ['b']);
    expect(ctx).toContain('tall with curly hair'); // shareable depiction field
    expect(ctx).toContain('Ethnicity: Korean');
    expect(ctx).not.toContain('SAM-HEALTH-SECRET'); // private — never about a linked person
    expect(ctx).not.toContain('SAM-FAITH-SECRET');
  });

  it('honors per-person targeted (shareableWith) facts and skips unknown ids', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('a', 'Alex'));
    await savePerson(fs, key, person('b', 'Sam'));
    await saveInsight(
      fs,
      key,
      insight('i3', 'b', {
        facts: [{ id: 'f1', text: 'Sam confided in Alex', shareable: false, shareableWith: ['a'] }],
      }),
    );

    const ctx = await buildLinkedPeopleContext(fs, key, 'a', ['b', 'ghost']);
    expect(ctx).toContain('Sam confided in Alex'); // targeted at the viewer
  });

  it('returns empty for no linked people, only free names, the viewer themself, or unknowns', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('a', 'Alex'));
    expect(await buildLinkedPeopleContext(fs, key, 'a', [])).toBe('');
    expect(await buildLinkedPeopleContext(fs, key, 'a', ['a'])).toBe(''); // the viewer is not a dream person
    expect(await buildLinkedPeopleContext(fs, key, 'a', ['nobody'])).toBe('');
  });
});

describe('ageFromBirthday', () => {
  const now = new Date('2026-06-12T00:00:00.000Z');
  it('computes exact whole-year age, accounting for whether the birthday has passed', () => {
    expect(ageFromBirthday('1990-01-01', now)).toBe(36); // birthday already passed this year
    expect(ageFromBirthday('1990-12-31', now)).toBe(35); // birthday still ahead this year
  });
  it('returns null for an unparseable or future or absurd birthday', () => {
    expect(ageFromBirthday('not-a-date', now)).toBeNull();
    expect(ageFromBirthday('2030-01-01', now)).toBeNull(); // future
  });
});

describe('buildDepictionNote', () => {
  const now = new Date('2026-06-12T00:00:00.000Z');

  it('assembles appearance + gender + exact age + ethnicity, name-free; never name/private', async () => {
    const fs = memFileSystem();
    await savePerson(
      fs,
      key,
      person('b', 'Alexandra', {
        appearanceDescription: 'tall with curly hair',
        gender: 'female',
        ethnicity: 'Korean',
        birthday: '1990-01-01',
        privateNotes: 'PRIV',
        healthNotes: 'HEALTH',
        faith: 'FAITH',
      }),
    );
    const note = await buildDepictionNote(fs, key, 'b', now);
    expect(note).toContain('tall with curly hair');
    expect(note).toContain('female');
    expect(note).toContain('age 36');
    expect(note).toContain('Korean');
    expect(note).not.toContain('Alexandra'); // never the name
    expect(note).not.toContain('PRIV');
    expect(note).not.toContain('HEALTH');
    expect(note).not.toContain('FAITH');
  });

  it("returns '' when there is nothing depictable, or the person is unknown", async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('c', 'Casey', { occupation: 'nurse' })); // no depiction fields
    expect(await buildDepictionNote(fs, key, 'c', now)).toBe('');
    expect(await buildDepictionNote(fs, key, 'ghost', now)).toBe('');
  });
});

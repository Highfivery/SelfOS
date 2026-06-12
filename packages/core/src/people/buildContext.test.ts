import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { Insight, Person, Relationship } from '../schemas';
import { saveInsight } from '../insights';
import { savePerson } from './peopleService';
import { saveRelationship } from './relationshipService';
import { buildContext, buildLinkedPeopleContext } from './buildContext';

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

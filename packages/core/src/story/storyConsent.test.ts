import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { savePerson, saveRelationship } from '../people';
import type { Insight, Person, Relationship } from '../schemas';
import { applyPseudonyms } from './storyText';
import {
  getConsentRegister,
  pseudonymMap,
  setConsentEntry,
  unconsentedNames,
} from './storyConsent';
import { createBook } from './storyService';

const key = generateMasterKey();
const now = new Date('2026-07-22T00:00:00.000Z');

function person(id: string, displayName: string): Person {
  return {
    id,
    schemaVersion: 2,
    displayName,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
}
function relationship(from: string, to: string, type: Relationship['type']): Relationship {
  return {
    id: `r-${from}-${to}`,
    schemaVersion: 2,
    fromPersonId: from,
    toPersonId: to,
    type,
    createdAt: 'now',
    updatedAt: 'now',
  };
}
function insight(id: string, summary: string): Insight {
  return {
    id,
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'me',
    summary,
    facts: [],
    confidence: 'high',
    categories: [],
    approved: true,
    provenance: { at: '2026-05-01T00:00:00.000Z' },
    createdAt: 'now',
    updatedAt: 'now',
  };
}

async function seed(fs: ReturnType<typeof memFileSystem>): Promise<string> {
  await savePerson(fs, key, person('me', 'Ben'));
  await savePerson(fs, key, person('angel', 'Angel'));
  await saveRelationship(fs, key, relationship('me', 'angel', 'partner'));
  await saveInsight(fs, key, insight('i1', 'A day with Angel'));
  const book = await createBook(fs, key, {
    personId: 'me',
    type: 'biography',
    title: 'Book',
    config: {
      voice: 'third',
      style: 'warm',
      length: 'standard',
      autoRefresh: true,
      typeOptions: {},
      sourceIds: [],
    },
    now,
  });
  return book.id;
}

describe('applyPseudonyms (64 §17.5)', () => {
  it('replaces a name whole-word, case-insensitively, longest-first, never mid-word', () => {
    expect(applyPseudonyms('Angel and Ana walked on.', { Angel: 'A.', Ana: 'the girl' })).toBe(
      'A. and the girl walked on.',
    );
    // Whole-word only: "Ana" does not touch "Banana".
    expect(applyPseudonyms('a Banana for Ana', { Ana: 'her' })).toBe('a Banana for her');
    // Empty map is a no-op.
    expect(applyPseudonyms('Angel', {})).toBe('Angel');
  });
});

describe('consent center (64 §17.5)', () => {
  it('enumerates the people the book names, defaulting to unknown consent', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    const register = await getConsentRegister(fs, key, 'me', bookId);
    const angel = register.find((p) => p.name === 'Angel');
    expect(angel).toMatchObject({ consent: 'unknown', relationship: 'partner' });
    expect(angel?.pseudonym).toBeUndefined();
  });

  it('sets consent + a pseudonym, and the map + unconsented list reflect it', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await setConsentEntry(fs, key, 'me', {
      bookId,
      name: 'Angel',
      consent: 'declined',
      pseudonym: 'A.',
      now,
    });
    const register = await getConsentRegister(fs, key, 'me', bookId);
    expect(register.find((p) => p.name === 'Angel')).toMatchObject({
      consent: 'declined',
      pseudonym: 'A.',
    });
    // Angel has a pseudonym → NOT in the "would appear under their real name" list.
    expect(unconsentedNames(register)).not.toContain('Angel');
    expect(await pseudonymMap(fs, key, 'me', bookId)).toEqual({ Angel: 'A.' });

    // An empty pseudonym clears it; declined-without-pseudonym now warns.
    await setConsentEntry(fs, key, 'me', {
      bookId,
      name: 'Angel',
      consent: 'declined',
      pseudonym: '',
      now,
    });
    const cleared = await getConsentRegister(fs, key, 'me', bookId);
    expect(cleared.find((p) => p.name === 'Angel')?.pseudonym).toBeUndefined();
    expect(unconsentedNames(cleared)).toContain('Angel');
    expect(await pseudonymMap(fs, key, 'me', bookId)).toEqual({});
  });

  it('unconsentedNames excludes granted people and people with a pseudonym', () => {
    const register = [
      { name: 'A', mentions: 1, consent: 'granted' as const },
      { name: 'B', mentions: 1, consent: 'declined' as const, pseudonym: 'B.' },
      { name: 'C', mentions: 1, consent: 'unknown' as const },
    ];
    expect(unconsentedNames(register)).toEqual(['C']);
  });
});

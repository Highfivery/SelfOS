import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { savePerson, saveRelationship } from '../people';
import type { Insight, Person, Relationship } from '../schemas';
import { castForPublication, getCastRegister } from './castRegister';
import { addExclusion } from './storyExclusionService';
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

function insight(id: string, summary: string, facts: string[]): Insight {
  return {
    id,
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'me',
    summary,
    facts: facts.map((text, i) => ({ id: `${id}-f${i}`, text, shareable: false })),
    confidence: 'high',
    categories: [],
    approved: true,
    provenance: { at: '2026-05-01T00:00:00.000Z' },
    createdAt: 'now',
    updatedAt: 'now',
  };
}

function relationship(
  from: string,
  to: string,
  type: Relationship['type'],
  label?: string,
): Relationship {
  return {
    id: `r-${from}-${to}`,
    schemaVersion: 2,
    fromPersonId: from,
    toPersonId: to,
    type,
    ...(label ? { label } : {}),
    createdAt: 'now',
    updatedAt: 'now',
  };
}

async function seed(fs: ReturnType<typeof memFileSystem>): Promise<string> {
  await savePerson(fs, key, person('me', 'Ben'));
  const book = await createBook(fs, key, {
    personId: 'me',
    type: 'biography',
    title: 'Book',
    config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    now,
  });
  return book.id;
}

describe('cast register (64 §17.2)', () => {
  it('builds from the People graph with a relationship label, and counts mentions', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await savePerson(fs, key, person('angel', 'Angel'));
    await saveRelationship(fs, key, relationship('me', 'angel', 'partner'));
    // Own insights that name Angel twice → mention count 2.
    await saveInsight(fs, key, insight('i1', 'A talk about Angel', ['Angel steadied him.']));

    const cast = await getCastRegister(fs, key, 'me', bookId);
    const angel = cast.find((c) => c.name === 'Angel');
    expect(angel).toBeTruthy();
    expect(angel!.relationship).toBe('partner');
    expect(angel!.sources).toContain('graph');
    expect(angel!.mentions).toBeGreaterThanOrEqual(1); // named in the summary + the fact
    expect(angel!.personId).toBe('angel');
  });

  it('a custom relationship label wins over the type', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await savePerson(fs, key, person('mom', 'Mary'));
    await saveRelationship(fs, key, relationship('me', 'mom', 'parent', 'my mother'));
    const cast = await getCastRegister(fs, key, 'me', bookId);
    expect(cast.find((c) => c.name === 'Mary')?.relationship).toBe('my mother');
  });

  it('a person EXCLUDED from the book never appears in the register', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await savePerson(fs, key, person('ex', 'Robin'));
    await saveRelationship(fs, key, relationship('me', 'ex', 'other'));
    await saveInsight(fs, key, insight('i1', 'A note', ['Robin was there too.']));
    await addExclusion(fs, key, 'me', bookId, { kind: 'person', value: 'ex' }, now);

    const cast = await getCastRegister(fs, key, 'me', bookId);
    expect(cast.find((c) => c.name === 'Robin')).toBeUndefined();
  });

  it('a short name never phantom-matches an ordinary word (whole-word mentions only) (§17.2)', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    // "Ed" is a household person but never actually named; the corpus says "edited" and "credited".
    await savePerson(fs, key, person('ed', 'Ed'));
    await saveInsight(fs, key, insight('i1', 'He edited the tape', ['He credited no one for it.']));

    const cast = await getCastRegister(fs, key, 'me', bookId);
    // No substring hit → Ed never enters the register, so he can't leak into an opt-in published cast.
    expect(cast.find((c) => c.name === 'Ed')).toBeUndefined();

    // A whole-word mention IS counted.
    await saveInsight(fs, key, insight('i2', 'Then Ed arrived', ['Ed stayed the night.']));
    const cast2 = await getCastRegister(fs, key, 'me', bookId);
    expect(cast2.find((c) => c.name === 'Ed')?.mentions).toBeGreaterThanOrEqual(1);
  });

  it('castForPublication keeps graph/memory/mentioned people and drops a zero-signal name', async () => {
    const entries = [
      { name: 'Angel', relationship: 'partner', mentions: 3, sources: ['graph' as const] },
      { name: 'A Stranger', mentions: 0, sources: ['mention' as const] }, // zero-signal → dropped
      { name: 'Pat', mentions: 2, sources: ['mention' as const] },
    ];
    const published = castForPublication(entries);
    expect(published.map((m) => m.name)).toEqual(['Angel', 'Pat']);
    expect(published[0]).toEqual({ name: 'Angel', relationship: 'partner' });
    expect(published[1]).toEqual({ name: 'Pat' }); // no relationship → omitted
  });

  it('is total: a lone subject with no people yields an empty register', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    expect(await getCastRegister(fs, key, 'me', bookId)).toEqual([]);
  });
});

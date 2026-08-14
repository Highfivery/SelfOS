import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { savePerson } from '../people';
import type { BookChapter, Person } from '../schemas';
import { chaptersWithNewMaterial } from './storyMaterial';
import { getNewMaterial } from './storyService';
import { addExclusion, removeExclusion } from './storyExclusionService';
import { getChapter, getExclusions, saveChapter } from './storyService';

const key = generateMasterKey();
const now = new Date('2026-07-16T00:00:00.000Z');

function chapter(over: Partial<BookChapter> & { id: string }): BookChapter {
  return {
    schemaVersion: 1,
    partId: 'p1',
    order: 0,
    title: 'A chapter',
    markdown: '',
    revision: 1,
    status: 'reviewed',
    sourceSignature: '',
    provenance: [],
    protectedBlocks: [],
    pinnedQuotes: [],
    imagePlacements: [],
    ...over,
  };
}

const partner: Person = {
  id: 'angel',
  schemaVersion: 2,
  displayName: 'Angel',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

describe('storyExclusionService (64 §3.3/§5.1)', () => {
  it('adds a topic exclusion and marks chapters that mention it stale (option 1)', async () => {
    const fs = memFileSystem();
    await saveChapter(
      fs,
      key,
      'me',
      'b1',
      chapter({ id: 'c1', markdown: 'The divorce was quiet.' }),
    );
    await saveChapter(
      fs,
      key,
      'me',
      'b1',
      chapter({ id: 'c2', markdown: 'The garage smelled of pine.' }),
    );

    const res = await addExclusion(
      fs,
      key,
      'me',
      'b1',
      { kind: 'topic', value: 'the divorce' },
      now,
    );
    expect(res.staled).toBe(1);
    expect(res.exclusions[0]).toMatchObject({ kind: 'topic', value: 'the divorce' });
    // Only the mentioning chapter is flagged — and as a PROPOSAL (72 §4.4), not a status: excluding
    // something is an instruction about the future, and taking it out of written prose costs a metered
    // pass, so the author decides when.
    expect(await chaptersWithNewMaterial(fs, key, 'me', 'b1')).toEqual(['c1']);
    expect((await getChapter(fs, key, 'me', 'b1', 'c1'))?.status).toBe('reviewed'); // prose untouched
    expect((await getChapter(fs, key, 'me', 'b1', 'c2'))?.status).toBe('reviewed');
  });

  it('resolves a person exclusion to their display name to scan existing prose', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, partner);
    await saveChapter(
      fs,
      key,
      'me',
      'b1',
      chapter({ id: 'c1', markdown: 'Angel laughed in the kitchen.' }),
    );

    const res = await addExclusion(fs, key, 'me', 'b1', { kind: 'person', value: 'angel' }, now);
    expect(res.staled).toBe(1);
    expect(await chaptersWithNewMaterial(fs, key, 'me', 'b1')).toEqual(['c1']);
  });

  it('flags a chapter by a source exclusion via its provenance', async () => {
    const fs = memFileSystem();
    await saveChapter(
      fs,
      key,
      'me',
      'b1',
      chapter({
        id: 'c1',
        markdown: 'Something drawn from a dream.',
        provenance: [{ anchor: 'p0', refs: [{ kind: 'dream', id: 'd7' }] }],
      }),
    );
    const res = await addExclusion(fs, key, 'me', 'b1', { kind: 'source', value: 'd7' }, now);
    expect(res.staled).toBe(1);
    expect(await chaptersWithNewMaterial(fs, key, 'me', 'b1')).toEqual(['c1']);
  });

  it('never disturbs a chapter mid-generation, and never files the same proposal twice', async () => {
    const fs = memFileSystem();
    await saveChapter(fs, key, 'me', 'b1', chapter({ id: 'c1', markdown: 'the topic' }));
    await saveChapter(
      fs,
      key,
      'me',
      'b1',
      chapter({ id: 'c2', markdown: 'the topic', status: 'generating' }),
    );
    await addExclusion(fs, key, 'me', 'b1', { kind: 'topic', value: 'the topic' }, now);
    expect((await getChapter(fs, key, 'me', 'b1', 'c2'))?.status).toBe('generating'); // untouched

    // Excluding something else that c1 also contains refreshes its one entry rather than stacking a second.
    await addExclusion(fs, key, 'me', 'b1', { kind: 'topic', value: 'topic' }, now);
    const entries = (await getNewMaterial(fs, key, 'me', 'b1')).entries;
    expect(entries.filter((e) => e.chapterId === 'c1')).toHaveLength(1);
  });

  it('matches on word boundaries — a short topic does not falsely stale a superstring', async () => {
    const fs = memFileSystem();
    await saveChapter(
      fs,
      key,
      'me',
      'b1',
      chapter({ id: 'c1', markdown: 'The warm oil smelled sweet.' }),
    );
    const res = await addExclusion(fs, key, 'me', 'b1', { kind: 'topic', value: 'war' }, now);
    expect(res.staled).toBe(0); // "war" must not match inside "warm"
    expect((await getChapter(fs, key, 'me', 'b1', 'c1'))?.status).toBe('reviewed');
  });

  it('ignores a duplicate exclusion (same kind + value) and a blank value', async () => {
    const fs = memFileSystem();
    await addExclusion(fs, key, 'me', 'b1', { kind: 'topic', value: 'the divorce' }, now);
    const dup = await addExclusion(
      fs,
      key,
      'me',
      'b1',
      { kind: 'topic', value: 'the divorce' },
      now,
    );
    expect(dup.exclusions).toHaveLength(1); // not stacked
    const blank = await addExclusion(fs, key, 'me', 'b1', { kind: 'topic', value: '   ' }, now);
    expect(blank.exclusions).toHaveLength(1); // blank not persisted
  });

  it('removes an exclusion without rewriting any chapter', async () => {
    const fs = memFileSystem();
    await saveChapter(
      fs,
      key,
      'me',
      'b1',
      chapter({ id: 'c1', markdown: 'the divorce', status: 'reviewed' }),
    );
    const added = await addExclusion(
      fs,
      key,
      'me',
      'b1',
      { kind: 'topic', value: 'the divorce' },
      now,
    );
    const id = added.exclusions[0]!.id;
    const after = await removeExclusion(fs, key, 'me', 'b1', id);
    expect(after).toEqual([]);
    expect(await getExclusions(fs, key, 'me', 'b1')).toEqual([]);
    // The proposal it filed stands — removing the rule doesn't retroactively rewrite anything, and the
    // author may still want the passage out.
    expect(await chaptersWithNewMaterial(fs, key, 'me', 'b1')).toEqual(['c1']);
  });
});

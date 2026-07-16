import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { savePerson } from '../people';
import type { BookChapter, Insight, Person } from '../schemas';
import { buildStoryCorpus, type StoryCorpus } from './storyCorpus';
import { citedSourceIds, computeSourceSignature, markStaleChapters } from './storyFreshness';
import { getChapter, saveChapter } from './storyService';

const key = generateMasterKey();

function chapter(over: Partial<BookChapter> & { id: string }): BookChapter {
  return {
    schemaVersion: 1,
    partId: 'p1',
    order: 0,
    title: 'A chapter',
    markdown: 'Prose.',
    revision: 1,
    status: 'reviewed',
    sourceSignature: '',
    provenance: [{ anchor: 'p0', refs: [{ kind: 'insight', id: 'i1' }] }],
    protectedBlocks: [],
    pinnedQuotes: [],
    imagePlacements: [],
    ...over,
  };
}

const corpus = (text: string): StoryCorpus => ({
  personName: 'Ben',
  profile: [],
  items: [{ sourceRef: { kind: 'insight', id: 'i1' }, label: 'From a session', text }],
});

describe('computeSourceSignature (64 §5.4)', () => {
  it('is deterministic and changes only when a cited source’s content changes', () => {
    const c = chapter({ id: 'c1' });
    const a = computeSourceSignature(corpus('the winter was cold'), c);
    expect(a).toBe(computeSourceSignature(corpus('the winter was cold'), c)); // stable
    expect(a).not.toBe(computeSourceSignature(corpus('the winter was mild'), c)); // content changed
  });

  it('marks a cited source that is gone from the corpus', () => {
    const c = chapter({ id: 'c1' });
    const present = computeSourceSignature(corpus('x'), c);
    const gone = computeSourceSignature({ personName: 'Ben', profile: [], items: [] }, c);
    expect(gone).not.toBe(present);
    expect(gone).toContain('∅'); // the missing marker
  });

  it('a chapter that cited nothing has an empty signature', () => {
    expect(computeSourceSignature(corpus('x'), { provenance: [] })).toBe('');
  });

  it('citedSourceIds dedupes across paragraphs', () => {
    const c = chapter({
      id: 'c1',
      provenance: [
        { anchor: 'p0', refs: [{ kind: 'insight', id: 'i1' }] },
        {
          anchor: 'p1',
          refs: [
            { kind: 'insight', id: 'i1' },
            { kind: 'dream', id: 'd2' },
          ],
        },
      ],
    });
    expect(citedSourceIds(c).sort()).toEqual(['d2', 'i1']);
  });
});

const person: Person = {
  id: 'me',
  schemaVersion: 2,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};
function insight(factText: string): Insight {
  return {
    id: 'i1',
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'me',
    summary: 'A winter.',
    facts: [{ id: 'f1', text: factText, shareable: false }],
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { at: '2026-05-01T00:00:00.000Z' },
    createdAt: 'now',
    updatedAt: 'now',
  };
}

describe('markStaleChapters (64 §3.4)', () => {
  async function seed(fs: ReturnType<typeof memFileSystem>, factText: string): Promise<void> {
    await savePerson(fs, key, person);
    await saveInsight(fs, key, insight(factText));
    // Stamp the chapter's signature against the current corpus (as generation would).
    const cur = await buildStoryCorpus(fs, key, 'me', []);
    await saveChapter(
      fs,
      key,
      'me',
      'b1',
      chapter({ id: 'c1', sourceSignature: computeSourceSignature(cur, chapter({ id: 'c1' })) }),
    );
  }

  it('stales a chapter whose cited insight changed, and leaves an unchanged one alone', async () => {
    const fs = memFileSystem();
    await seed(fs, 'the winter was cold');
    // No change yet → nothing stales.
    expect(await markStaleChapters(fs, key, 'me', 'b1')).toBe(0);
    expect((await getChapter(fs, key, 'me', 'b1', 'c1'))?.status).toBe('reviewed');
    // Edit the cited insight → the chapter goes stale.
    await saveInsight(fs, key, insight('the winter was brutal'));
    expect(await markStaleChapters(fs, key, 'me', 'b1')).toBe(1);
    expect((await getChapter(fs, key, 'me', 'b1', 'c1'))?.status).toBe('stale');
  });

  it('never re-flags a stale/generating chapter or one with no stored signature', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person);
    await saveInsight(fs, key, insight('x'));
    await saveChapter(
      fs,
      key,
      'me',
      'b1',
      chapter({ id: 'c1', status: 'stale', sourceSignature: 'old' }),
    );
    await saveChapter(
      fs,
      key,
      'me',
      'b1',
      chapter({ id: 'c2', status: 'generating', sourceSignature: 'old' }),
    );
    await saveChapter(
      fs,
      key,
      'me',
      'b1',
      chapter({ id: 'c3', status: 'reviewed', sourceSignature: '' }),
    );
    expect(await markStaleChapters(fs, key, 'me', 'b1')).toBe(0);
    expect((await getChapter(fs, key, 'me', 'b1', 'c2'))?.status).toBe('generating');
    expect((await getChapter(fs, key, 'me', 'b1', 'c3'))?.status).toBe('reviewed');
  });
});

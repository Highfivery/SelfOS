import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { savePerson } from '../people';
import type { BookChapter, Insight, Person } from '../schemas';
import { buildStoryCorpus, type StoryCorpus } from './storyCorpus';
import { citedSourceIds, computeSourceSignature, detectNewMaterial } from './storyFreshness';
import { declineNewMaterial } from './storyMaterial';
import { getChapter, getNewMaterial, saveChapter } from './storyService';

const key = generateMasterKey();
const now = new Date('2026-08-13T00:00:00.000Z');

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

describe('detectNewMaterial (72 §5.4)', () => {
  async function seed(fs: ReturnType<typeof memFileSystem>, factText: string): Promise<void> {
    await savePerson(fs, key, person);
    await saveInsight(fs, key, insight(factText));
    // Stamp the chapter's signature against the current corpus (as generation would).
    const cur = await buildStoryCorpus(fs, key, 'me', 'book-1', []);
    await saveChapter(
      fs,
      key,
      'me',
      'b1',
      chapter({ id: 'c1', sourceSignature: computeSourceSignature(cur, chapter({ id: 'c1' })) }),
    );
  }

  it('names what changed and quotes it, and leaves an unchanged chapter alone', async () => {
    const fs = memFileSystem();
    await seed(fs, 'the winter was cold');
    // No change yet → nothing to propose.
    expect(await detectNewMaterial(fs, key, 'me', 'b1', now)).toBe(0);
    expect((await getNewMaterial(fs, key, 'me', 'b1')).entries).toEqual([]);

    await saveInsight(fs, key, insight('the winter was brutal'));
    expect(await detectNewMaterial(fs, key, 'me', 'b1', now)).toBe(1);

    const entries = (await getNewMaterial(fs, key, 'me', 'b1')).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.chapterId).toBe('c1');
    expect(entries[0]?.reason).toBe('newMaterial');
    // It says WHAT changed, not just that something did — that is the whole point of a proposal.
    expect(entries[0]?.items[0]?.excerpt).toContain('brutal');
    expect(entries[0]?.items[0]?.label.length).toBeGreaterThan(0);
  });

  it('never touches a chapter’s STATUS — drift is a proposal, not a state', async () => {
    const fs = memFileSystem();
    await seed(fs, 'the winter was cold');
    await saveInsight(fs, key, insight('the winter was brutal'));
    await detectNewMaterial(fs, key, 'me', 'b1', now);
    // The reviewed chapter stays reviewed: nothing about it changed, only what could go in.
    expect((await getChapter(fs, key, 'me', 'b1', 'c1'))?.status).toBe('reviewed');
  });

  it('re-detecting the same drift refreshes the one entry rather than piling up duplicates', async () => {
    const fs = memFileSystem();
    await seed(fs, 'the winter was cold');
    await saveInsight(fs, key, insight('the winter was brutal'));
    await detectNewMaterial(fs, key, 'me', 'b1', now);
    await detectNewMaterial(fs, key, 'me', 'b1', now);
    expect((await getNewMaterial(fs, key, 'me', 'b1')).entries).toHaveLength(1);
  });

  it('skips a generating chapter and one with no stored signature', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person);
    await saveInsight(fs, key, insight('x'));
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
    expect(await detectNewMaterial(fs, key, 'me', 'b1', now)).toBe(0);
    expect((await getChapter(fs, key, 'me', 'b1', 'c2'))?.status).toBe('generating');
  });

  /**
   * "Not now" has to MEAN something. The signature diff is stateless, so without re-stamping, the very next
   * free scan would raise the identical proposal again and the button would be decorative.
   */
  it('declining re-stamps the signature, so it stays quiet until something ELSE changes', async () => {
    const fs = memFileSystem();
    await seed(fs, 'the winter was cold');
    await saveInsight(fs, key, insight('the winter was brutal'));
    await detectNewMaterial(fs, key, 'me', 'b1', now);

    await declineNewMaterial(fs, key, 'me', 'b1', { chapterId: 'c1' });
    expect((await getNewMaterial(fs, key, 'me', 'b1')).entries).toEqual([]);
    expect(await detectNewMaterial(fs, key, 'me', 'b1', now)).toBe(0); // does not come straight back

    // But a LATER change does raise it again.
    await saveInsight(fs, key, insight('the winter nearly finished him'));
    expect(await detectNewMaterial(fs, key, 'me', 'b1', now)).toBe(1);
  });
});

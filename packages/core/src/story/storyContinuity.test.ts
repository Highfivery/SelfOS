import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { savePerson } from '../people';
import type { AiDeps } from '../questionnaires';
import type { BookOutline, Insight, LifeTimeline, Person } from '../schemas';
import {
  checkContinuity,
  lineEditChapter,
  listContinuityFindings,
  resolveContinuityFinding,
} from './storyContinuity';
import { generateChapter } from './storyGenerationService';
import {
  applyFoundations,
  approveOutline,
  createBook,
  getChapter,
  getChapterHistory,
} from './storyService';

const key = generateMasterKey();
const now = new Date('2026-07-22T00:00:00.000Z');
const USAGE: ClaudeUsage = {
  inputTokens: 100,
  outputTokens: 80,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};
function fakeClient(text: string): ClaudeClient {
  return { send: async () => text, stream: async () => ({ text, usage: USAGE }) };
}
function deps(fs: ReturnType<typeof memFileSystem>, client: ClaudeClient): AiDeps {
  return { fs, key, client, apiKey: 'sk', model: 'claude-sonnet-4-6', personId: 'me', now };
}

const person: Person = {
  id: 'me',
  schemaVersion: 2,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};
const insight: Insight = {
  id: 'i1',
  schemaVersion: 1,
  source: 'session',
  subjectPersonId: 'me',
  summary: 'A life.',
  facts: [{ id: 'f1', text: 'many things happened', shareable: false }],
  confidence: 'medium',
  categories: [],
  approved: true,
  provenance: { at: '2026-05-01T00:00:00.000Z' },
  createdAt: 'now',
  updatedAt: 'now',
};
const outline: BookOutline = {
  schemaVersion: 1,
  approved: true,
  parts: [
    {
      id: 'p1',
      title: 'Roots',
      chapters: [
        { id: 'c1', title: 'The Garage', brief: 'A machine obeys.', lifeAreas: [], order: 0 },
        { id: 'c2', title: 'The Road', brief: 'Leaving home.', lifeAreas: [], order: 1 },
      ],
    },
  ],
};
const timeline: LifeTimeline = { schemaVersion: 1, events: [] };

async function seedBook(fs: ReturnType<typeof memFileSystem>, written = 2): Promise<string> {
  await savePerson(fs, key, person);
  await saveInsight(fs, key, insight);
  const book = await createBook(fs, key, {
    personId: 'me',
    type: 'biography',
    title: 'The Story of Ben',
    config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    now,
  });
  await applyFoundations(fs, key, 'me', book.id, { essence: 'x', outline, timeline }, now);
  await approveOutline(fs, key, 'me', book.id, outline, now);
  await generateChapter(deps(fs, fakeClient('Her name was Ana. [[SRC:s0]]')), {
    bookId: book.id,
    chapterId: 'c1',
  });
  if (written >= 2) {
    await generateChapter(deps(fs, fakeClient('Anna waved from the porch. [[SRC:s0]]')), {
      bookId: book.id,
      chapterId: 'c2',
    });
  }
  return book.id;
}

const findingsJson = (findings: unknown[]): string => JSON.stringify({ findings });

describe('checkContinuity (64 §17.3)', () => {
  it('stores findings as pending review items, de-duped across runs', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const finding = {
      kind: 'name',
      summary: "Her name is 'Ana' in The Garage but 'Anna' in The Road",
      chapters: ['The Garage', 'The Road'],
    };
    const res = await checkContinuity(deps(fs, fakeClient(findingsJson([finding]))), bookId);
    expect(res.ok).toBe(true);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0]).toMatchObject({ kind: 'name', status: 'pending' });

    // A second run returning the SAME finding adds nothing (de-duped).
    const again = await checkContinuity(deps(fs, fakeClient(findingsJson([finding]))), bookId);
    expect(again.findings).toHaveLength(1);
  });

  it('an empty findings array is a healthy, valid result (no error)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const res = await checkContinuity(deps(fs, fakeClient(findingsJson([]))), bookId);
    expect(res).toMatchObject({ ok: true, findings: [] });
  });

  it('does not spend on a book with fewer than two written chapters', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs, 1);
    let called = false;
    const client: ClaudeClient = {
      send: async () => '',
      stream: async () => {
        called = true;
        return { text: '{}', usage: USAGE };
      },
    };
    const res = await checkContinuity(deps(fs, client), bookId);
    expect(res.ok).toBe(true);
    expect(res.findings).toEqual([]);
    expect(called).toBe(false); // nothing to be inconsistent ACROSS → no model call
  });

  it('resolve/dismiss removes a finding from the pending list and it never re-surfaces', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const finding = { kind: 'date', summary: 'Born 1985 in ch.1 but 1987 in ch.3', chapters: [] };
    await checkContinuity(deps(fs, fakeClient(findingsJson([finding]))), bookId);
    const pending = await listContinuityFindings(fs, key, 'me', bookId);
    expect(pending).toHaveLength(1);

    const remaining = await resolveContinuityFinding(fs, key, 'me', {
      bookId,
      findingId: pending[0]!.id,
      action: 'resolve',
    });
    expect(remaining).toHaveLength(0);
    // Re-running with the same finding does NOT re-add it (de-dup includes resolved).
    const rerun = await checkContinuity(deps(fs, fakeClient(findingsJson([finding]))), bookId);
    expect(rerun.findings).toHaveLength(0);
  });
});

describe('lineEditChapter (64 §17.3)', () => {
  it('polishes a chapter, archives the pre-edit text to History (reversible), and marks it updated', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const before = await getChapter(fs, key, 'me', bookId, 'c1');
    const res = await lineEditChapter(
      deps(fs, fakeClient('Her name was Ana, and the shop was quiet.')),
      {
        bookId,
        chapterId: 'c1',
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.chapter.markdown).toContain('and the shop was quiet');
    expect(res.chapter.status).toBe('updated');
    expect(res.chapter.revision).toBe(before!.revision + 1);
    // Same paragraph structure (one paragraph in, one out) → provenance stays aligned, carried forward.
    expect(res.chapter.provenance).toEqual(before!.provenance);
    // The pre-edit text is archived under History with reason 'lineEdit' — undoable.
    const history = await getChapterHistory(fs, key, 'me', bookId, 'c1');
    expect(
      history.versions.some((v) => v.reason === 'lineEdit' && v.markdown === before!.markdown),
    ).toBe(true);
  });

  it('drops stale provenance + out-of-range placements when the polish reflows paragraphs', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    // c1 was written as one paragraph ("Her name was Ana.") with provenance for p0. Polish it into TWO
    // paragraphs — the carried-forward p0 provenance would now describe the wrong layout, so it's dropped.
    const before = await getChapter(fs, key, 'me', bookId, 'c1');
    expect(before!.provenance.length).toBeGreaterThan(0);
    const res = await lineEditChapter(
      deps(fs, fakeClient('Her name was Ana.\n\nThe shop was quiet that morning.')),
      { bookId, chapterId: 'c1' },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.chapter.provenance).toEqual([]); // reflowed → wrong-source risk removed
    // A same-structure polish (below) keeps provenance — proven by the happy-path test above.
  });

  it('refuses when there is nothing to polish', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs, 1); // c2 never written
    const res = await lineEditChapter(deps(fs, fakeClient('x')), { bookId, chapterId: 'c2' });
    expect(res.ok).toBe(false);
  });
});

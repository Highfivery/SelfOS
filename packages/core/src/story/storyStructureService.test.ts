import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeUsage } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { savePerson } from '../people';
import type { AiDeps } from '../questionnaires';
import type { BookOutline, Insight, LifeTimeline, Person } from '../schemas';
import { generateChapter } from './storyGenerationService';
import {
  generateStructuralProposals,
  listStructuralProposals,
  resolveProposal,
} from './storyStructureService';
import {
  applyFoundations,
  approveOutline,
  createBook,
  getChapter,
  getOutline,
  listChapters,
} from './storyService';

const key = generateMasterKey();
const now = new Date('2026-07-16T00:00:00.000Z');

const USAGE: ClaudeUsage = {
  inputTokens: 500,
  outputTokens: 400,
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

/** Seed a book with a two-chapter part, both chapters written. */
async function seedBook(fs: ReturnType<typeof memFileSystem>): Promise<string> {
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
  await generateChapter(deps(fs, fakeClient('The garage. [[SRC:s0]]')), {
    bookId: book.id,
    chapterId: 'c1',
  });
  await generateChapter(deps(fs, fakeClient('The road. [[SRC:s0]]')), {
    bookId: book.id,
    chapterId: 'c2',
  });
  return book.id;
}

const proposalsJson = (proposals: unknown[]): string => JSON.stringify({ proposals });

describe('generateStructuralProposals (64 §3.4/§5.4)', () => {
  it('accepts valid proposals, normalizes life-areas, and returns them pending', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const res = await generateStructuralProposals(
      deps(
        fs,
        fakeClient(
          proposalsJson([
            {
              kind: 'newChapter',
              rationale: 'A new era.',
              partId: 'p1',
              afterChapterId: 'c1',
              title: 'The Middle Years',
              brief: 'Settling in.',
              lifeAreas: ['Work & purpose', 'NotAReal Area'],
            },
            {
              kind: 'splitChapter',
              rationale: 'It grew too big.',
              chapterId: 'c2',
              firstTitle: 'The Road, part one',
              firstBrief: 'Departure.',
              secondTitle: 'The Road, part two',
              secondBrief: 'Arrival.',
            },
          ]),
        ),
      ),
      { bookId },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.added).toBe(2);
    expect(res.proposals).toHaveLength(2);
    const nc = res.proposals.find((p) => p.kind === 'newChapter');
    expect(nc?.kind === 'newChapter' && nc.lifeAreas).toEqual(['Work & purpose']); // invalid area dropped
  });

  it('drops proposals whose referenced ids do not exist', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const res = await generateStructuralProposals(
      deps(
        fs,
        fakeClient(
          proposalsJson([
            { kind: 'newChapter', partId: 'NOPE', title: 'Ghost', rationale: 'x' },
            {
              kind: 'splitChapter',
              chapterId: 'NOPE',
              firstTitle: 'a',
              secondTitle: 'b',
              rationale: 'x',
            },
            { kind: 'prologueRewrite', chapterId: 'NOPE', rationale: 'x' },
          ]),
        ),
      ),
      { bookId },
    );
    expect(res.ok && res.added).toBe(0);
  });

  it('dedupes against existing pending AND dismissed proposals', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const client = deps(
      fs,
      fakeClient(
        proposalsJson([
          {
            kind: 'newChapter',
            partId: 'p1',
            title: 'The Middle Years',
            brief: 'x',
            rationale: 'y',
          },
        ]),
      ),
    );
    const first = await generateStructuralProposals(client, { bookId });
    expect(first.ok && first.added).toBe(1);
    // Same idea again → deduped (0 added), still one pending.
    const second = await generateStructuralProposals(client, { bookId });
    expect(second.ok && second.added).toBe(0);
    expect(second.ok && second.proposals).toHaveLength(1);
    // Dismiss it, then propose the same again → still not re-added (dismissed kept for dedup).
    const pid = first.ok ? first.proposals[0]!.id : '';
    await resolveProposal(fs, key, 'me', { bookId, proposalId: pid, action: 'dismiss' });
    const third = await generateStructuralProposals(client, { bookId });
    expect(third.ok && third.added).toBe(0);
    expect(third.ok && third.proposals).toHaveLength(0); // dismissed → not shown
  });

  it('an empty proposals array is a valid no-op; a non-JSON reply is an honest failure', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const empty = await generateStructuralProposals(deps(fs, fakeClient('{"proposals":[]}')), {
      bookId,
    });
    expect(empty.ok && empty.added).toBe(0);
    const junk = await generateStructuralProposals(deps(fs, fakeClient('I could not do that.')), {
      bookId,
    });
    expect(junk.ok).toBe(false);
  });
});

describe('resolveProposal — approve applies the restructure (no prose written)', () => {
  it('newChapter: inserts an un-written stale shell in the right position', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const gen = await generateStructuralProposals(
      deps(
        fs,
        fakeClient(
          proposalsJson([
            {
              kind: 'newChapter',
              partId: 'p1',
              afterChapterId: 'c1',
              title: 'The Middle Years',
              brief: 'Settling.',
              rationale: 'y',
            },
          ]),
        ),
      ),
      { bookId },
    );
    const pid = gen.ok ? gen.proposals[0]!.id : '';
    const res = await resolveProposal(fs, key, 'me', {
      bookId,
      proposalId: pid,
      action: 'approve',
    });
    expect(res.ok).toBe(true);
    expect(res.proposals).toHaveLength(0); // applied → gone from pending
    const chapters = await listChapters(fs, key, 'me', bookId);
    expect(chapters.map((c) => c.title)).toEqual(['The Garage', 'The Middle Years', 'The Road']);
    const shell = chapters.find((c) => c.title === 'The Middle Years')!;
    expect(shell.status).toBe('stale'); // un-written → written on the next refresh
    expect(shell.markdown).toBe('');
  });

  it('splitChapter: narrows the original (stale) and adds a stale sibling after it', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const gen = await generateStructuralProposals(
      deps(
        fs,
        fakeClient(
          proposalsJson([
            {
              kind: 'splitChapter',
              chapterId: 'c1',
              firstTitle: 'The Garage, part one',
              firstBrief: 'The machine.',
              secondTitle: 'The Garage, part two',
              secondBrief: 'The mentor.',
              rationale: 'y',
            },
          ]),
        ),
      ),
      { bookId },
    );
    const pid = gen.ok ? gen.proposals[0]!.id : '';
    await resolveProposal(fs, key, 'me', { bookId, proposalId: pid, action: 'approve' });
    const chapters = await listChapters(fs, key, 'me', bookId);
    expect(chapters.map((c) => c.title)).toEqual([
      'The Garage, part one',
      'The Garage, part two',
      'The Road',
    ]);
    const original = chapters.find((c) => c.id === 'c1')!;
    expect(original.status).toBe('stale'); // rewritten to the narrower brief next pass
    expect(chapters.find((c) => c.title === 'The Garage, part two')!.status).toBe('stale');
  });

  it('reorder: reorders the outline and syncs the chapter display order', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const gen = await generateStructuralProposals(
      deps(
        fs,
        fakeClient(
          proposalsJson([{ kind: 'reorder', partId: 'p1', order: ['c2', 'c1'], rationale: 'y' }]),
        ),
      ),
      { bookId },
    );
    const pid = gen.ok ? gen.proposals[0]!.id : '';
    await resolveProposal(fs, key, 'me', { bookId, proposalId: pid, action: 'approve' });
    const outlineNow = await getOutline(fs, key, 'me', bookId);
    expect(outlineNow!.parts[0]!.chapters.map((c) => c.id)).toEqual(['c2', 'c1']);
    const chapters = await listChapters(fs, key, 'me', bookId);
    expect(chapters.map((c) => c.id)).toEqual(['c2', 'c1']); // display order follows
  });

  it('prologueRewrite: marks the opening chapter stale without touching prose', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const before = await getChapter(fs, key, 'me', bookId, 'c1');
    const gen = await generateStructuralProposals(
      deps(
        fs,
        fakeClient(proposalsJson([{ kind: 'prologueRewrite', chapterId: 'c1', rationale: 'y' }])),
      ),
      { bookId },
    );
    const pid = gen.ok ? gen.proposals[0]!.id : '';
    await resolveProposal(fs, key, 'me', { bookId, proposalId: pid, action: 'approve' });
    const after = await getChapter(fs, key, 'me', bookId, 'c1');
    expect(after!.status).toBe('stale');
    expect(after!.markdown).toBe(before!.markdown); // prose untouched
  });

  it('dismiss removes it from pending but keeps it (not re-proposed); a gone proposal is a no-op', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const gen = await generateStructuralProposals(
      deps(
        fs,
        fakeClient(proposalsJson([{ kind: 'prologueRewrite', chapterId: 'c1', rationale: 'y' }])),
      ),
      { bookId },
    );
    const pid = gen.ok ? gen.proposals[0]!.id : '';
    const dismissed = await resolveProposal(fs, key, 'me', {
      bookId,
      proposalId: pid,
      action: 'dismiss',
    });
    expect(dismissed.ok).toBe(true);
    expect(await listStructuralProposals(fs, key, 'me', bookId)).toHaveLength(0);
    // Resolving the same id again → honest no-op.
    const again = await resolveProposal(fs, key, 'me', {
      bookId,
      proposalId: pid,
      action: 'approve',
    });
    expect(again.ok).toBe(false);
    expect(again.message).toBeTruthy();
  });

  it('no outline / no chapters → no spend, no proposals', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person);
    const book = await createBook(fs, key, {
      personId: 'me',
      type: 'biography',
      title: 'Empty',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
      now,
    });
    let streamed = false;
    const client: ClaudeClient = {
      send: async () => '',
      stream: async () => {
        streamed = true;
        return { text: '', usage: USAGE };
      },
    };
    const res = await generateStructuralProposals(deps(fs, client), { bookId: book.id });
    expect(res.ok && res.added).toBe(0);
    expect(streamed).toBe(false); // never called the model
  });
});

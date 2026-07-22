import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { savePerson } from '../people';
import type { BookOutline, LifeTimeline, Person } from '../schemas';
import {
  addChapter,
  addPart,
  chapterShell,
  deleteChapter,
  deletePart,
  mergeChapters,
  moveChapter,
  renameChapter,
  renamePart,
  splitChapter,
} from './storyOutline';
import {
  applyFoundations,
  approveOutline,
  createBook,
  getChapter,
  getMarkup,
  getOutline,
  getTodos,
  listChapters,
  saveChapter,
} from './storyService';
import { addMark } from './storyMarkupService';

/** Every draft-head chapter the outline no longer knows about — the leak `assertConsistent` watches for. */
async function orphanedChapters(
  fs: ReturnType<typeof memFileSystem>,
  bookId: string,
): Promise<string[]> {
  const outline = await getOutline(fs, key, 'me', bookId);
  const known = new Set((outline?.parts ?? []).flatMap((p) => p.chapters.map((c) => c.id)));
  return (await listChapters(fs, key, 'me', bookId))
    .filter((c) => !known.has(c.id))
    .map((c) => c.id);
}

const key = generateMasterKey();
const now = new Date('2026-07-22T00:00:00.000Z');

const person: Person = {
  id: 'me',
  schemaVersion: 2,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

/** Two parts, three chapters — enough to exercise within-part and cross-part moves. */
const outline: BookOutline = {
  schemaVersion: 1,
  approved: true,
  parts: [
    {
      id: 'p1',
      title: 'Roots',
      chapters: [
        { id: 'c1', title: 'The Garage', brief: 'A machine obeys.', lifeAreas: ['Work'], order: 0 },
        { id: 'c2', title: 'The House', brief: 'The quiet after dark.', lifeAreas: [], order: 1 },
      ],
    },
    {
      id: 'p2',
      title: 'Leaving',
      chapters: [
        { id: 'c3', title: 'The Move West', brief: 'A new city.', lifeAreas: [], order: 0 },
      ],
    },
  ],
};
const timeline: LifeTimeline = { schemaVersion: 1, events: [] };

async function seedBook(fs: ReturnType<typeof memFileSystem>): Promise<string> {
  await savePerson(fs, key, person);
  const book = await createBook(fs, key, {
    personId: 'me',
    type: 'biography',
    title: 'The Story of Ben',
    config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    now,
  });
  // A deep clone per test — these mutations edit the outline in place.
  const fresh = JSON.parse(JSON.stringify(outline)) as BookOutline;
  await applyFoundations(
    fs,
    key,
    'me',
    book.id,
    { essence: 'A quiet man.', outline: fresh, timeline },
    now,
  );
  await approveOutline(fs, key, 'me', book.id, fresh, now);
  return book.id;
}

/** Give a chapter drafted prose (+ the person's own investments) so the lossy paths are observable. */
async function writeChapter(
  fs: ReturnType<typeof memFileSystem>,
  bookId: string,
  chapterId: string,
  markdown: string,
): Promise<void> {
  // An outlined-but-never-drafted chapter has no record yet (they're minted at drafting), so start from a
  // shell when there isn't one.
  const chapter =
    (await getChapter(fs, key, 'me', bookId, chapterId)) ??
    chapterShell(chapterId, 'p1', 0, chapterId);
  await saveChapter(fs, key, 'me', bookId, {
    ...chapter,
    markdown,
    status: 'reviewed',
    protectedBlocks: [{ anchor: { paragraphId: 'p-1', quote: markdown }, text: markdown }],
    pinnedQuotes: [{ anchor: { paragraphId: 'p-1' }, text: markdown }],
    imagePlacements: [{ imageId: `img-${chapterId}`, afterAnchor: 'p-1', caption: '' }],
  });
}

/** Every chapter id in outline order, flattened — the shape most assertions care about. */
async function outlineIds(
  fs: ReturnType<typeof memFileSystem>,
  bookId: string,
): Promise<{ part: string; chapters: string[] }[]> {
  const o = await getOutline(fs, key, 'me', bookId);
  return (o?.parts ?? []).map((p) => ({ part: p.id, chapters: p.chapters.map((c) => c.id) }));
}

/** The invariant every mutation must preserve: the draft-head records agree with the outline (§16.1). */
async function assertConsistent(
  fs: ReturnType<typeof memFileSystem>,
  bookId: string,
): Promise<void> {
  const o = await getOutline(fs, key, 'me', bookId);
  for (const part of o?.parts ?? []) {
    part.chapters.forEach((c, i) => expect(c.order).toBe(i));
    for (const [i, oc] of part.chapters.entries()) {
      const bc = await getChapter(fs, key, 'me', bookId, oc.id);
      if (bc) {
        expect(bc.order).toBe(i);
        expect(bc.partId).toBe(part.id);
      }
    }
  }
  // Nothing is left pointing at a chapter the outline no longer has.
  expect(await orphanedChapters(fs, bookId)).toEqual([]);
}

describe('manual outline control (64 §16.1)', () => {
  it('adds a part and a chapter, keeping order + the draft record consistent', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);

    expect((await addPart(fs, key, 'me', bookId, { title: 'Now' })).ok).toBe(true);
    const parts = await outlineIds(fs, bookId);
    const newPart = parts[2]!.part;

    expect(
      (await addChapter(fs, key, 'me', bookId, { partId: newPart, title: 'The Return' })).ok,
    ).toBe(true);
    const after = await outlineIds(fs, bookId);
    expect(after[2]!.chapters).toHaveLength(1);
    // A new chapter gets a real, unwritten draft record — not just an outline entry.
    const shell = await getChapter(fs, key, 'me', bookId, after[2]!.chapters[0]!);
    expect(shell?.markdown).toBe('');
    expect(shell?.status).toBe('stale');
    await assertConsistent(fs, bookId);
  });

  it('inserts a chapter directly after another rather than always at the end', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await addChapter(fs, key, 'me', bookId, {
      partId: 'p1',
      title: 'Between',
      afterChapterId: 'c1',
    });
    const [first] = await outlineIds(fs, bookId);
    expect(first!.chapters[0]).toBe('c1');
    expect(first!.chapters[2]).toBe('c2');
    await assertConsistent(fs, bookId);
  });

  it('renames without staling — the prose is still the prose', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await writeChapter(fs, bookId, 'c1', 'He learned the engine.');

    expect(
      (await renameChapter(fs, key, 'me', bookId, { chapterId: 'c1', title: 'The Shed' })).ok,
    ).toBe(true);
    const bc = await getChapter(fs, key, 'me', bookId, 'c1');
    expect(bc?.title).toBe('The Shed'); // mirrored onto the draft record
    expect(bc?.status).toBe('reviewed'); // NOT staled — a retitle provokes no metered rewrite
    expect(bc?.markdown).toBe('He learned the engine.');
    expect(
      (await renamePart(fs, key, 'me', bookId, { partId: 'p1', title: 'Beginnings' })).ok,
    ).toBe(true);
  });

  it('stales on a re-worded brief — that IS what the next write is measured against', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await writeChapter(fs, bookId, 'c1', 'He learned the engine.');

    await renameChapter(fs, key, 'me', bookId, {
      chapterId: 'c1',
      title: 'The Garage',
      brief: 'Actually, it is about his father.',
    });
    expect((await getChapter(fs, key, 'me', bookId, 'c1'))?.status).toBe('stale');
  });

  it('moves a chapter across parts without staling it', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await writeChapter(fs, bookId, 'c1', 'He learned the engine.');

    expect(
      (await moveChapter(fs, key, 'me', bookId, { chapterId: 'c1', toPartId: 'p2', toIndex: 0 }))
        .ok,
    ).toBe(true);
    const parts = await outlineIds(fs, bookId);
    expect(parts[0]!.chapters).toEqual(['c2']);
    expect(parts[1]!.chapters).toEqual(['c1', 'c3']);
    const bc = await getChapter(fs, key, 'me', bookId, 'c1');
    expect(bc?.partId).toBe('p2');
    expect(bc?.order).toBe(0);
    expect(bc?.status).toBe('reviewed'); // moved, not rewritten
    await assertConsistent(fs, bookId);
  });

  it('clamps an out-of-range move instead of tearing the outline', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await moveChapter(fs, key, 'me', bookId, { chapterId: 'c3', toPartId: 'p1', toIndex: 99 });
    const parts = await outlineIds(fs, bookId);
    expect(parts[0]!.chapters).toEqual(['c1', 'c2', 'c3']);
    expect(parts[1]!.chapters).toEqual([]);
    await assertConsistent(fs, bookId);
  });

  it('splits into two: the original keeps its prose, the sibling is an unwritten shell', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await writeChapter(fs, bookId, 'c1', 'Both halves of the story live here.');

    expect(
      (
        await splitChapter(fs, key, 'me', bookId, {
          chapterId: 'c1',
          firstTitle: 'The Garage',
          secondTitle: 'The Engine',
          firstBrief: 'Only the machine.',
          secondBrief: 'Only the engine.',
        })
      ).ok,
    ).toBe(true);
    const [first] = await outlineIds(fs, bookId);
    expect(first!.chapters[0]).toBe('c1');
    const original = await getChapter(fs, key, 'me', bookId, 'c1');
    // The prose is NOT destroyed — it's kept, and marked for narrowing because the brief narrowed.
    expect(original?.markdown).toBe('Both halves of the story live here.');
    expect(original?.status).toBe('stale');
    const sibling = await getChapter(fs, key, 'me', bookId, first!.chapters[1]!);
    expect(sibling?.markdown).toBe('');
    await assertConsistent(fs, bookId);
  });

  it('a title-only split does NOT stale — there is nothing new to rewrite against (§16.1)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await writeChapter(fs, bookId, 'c1', 'Both halves of the story live here.');

    await splitChapter(fs, key, 'me', bookId, {
      chapterId: 'c1',
      firstTitle: 'The Garage',
      secondTitle: 'The Engine',
    });
    // Staling here would provoke a metered rewrite that reproduces the same chapter, since the brief still
    // asks for everything the prose already says.
    expect((await getChapter(fs, key, 'me', bookId, 'c1'))?.status).toBe('reviewed');
  });

  it('MERGES by concatenating prose — never discarding the second chapter’s writing (§13.9)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await writeChapter(fs, bookId, 'c1', 'The garage smelled of oil.');
    await writeChapter(fs, bookId, 'c2', 'The house was quiet after dark.');

    expect(
      (await mergeChapters(fs, key, 'me', bookId, { chapterId: 'c2', intoChapterId: 'c1' })).ok,
    ).toBe(true);

    const merged = await getChapter(fs, key, 'me', bookId, 'c1');
    // BOTH texts survive — the whole point.
    expect(merged?.markdown).toContain('The garage smelled of oil.');
    expect(merged?.markdown).toContain('The house was quiet after dark.');
    expect(merged?.status).toBe('stale');
    // The person's own investments come across with the prose they anchor to.
    expect(merged?.protectedBlocks).toHaveLength(2);
    expect(merged?.pinnedQuotes).toHaveLength(2);
    expect(merged?.imagePlacements.map((p) => p.imageId)).toEqual(['img-c1', 'img-c2']);
    // The source is gone from both the outline and the chapter store.
    expect((await outlineIds(fs, bookId))[0]!.chapters).toEqual(['c1']);
    expect(await getChapter(fs, key, 'me', bookId, 'c2')).toBeNull();
    await assertConsistent(fs, bookId);
  });

  it('merges INTO an outlined-but-undrafted chapter without losing the writing (§13.9)', async () => {
    // The realistic state this guards: a budget-stopped draft pass leaves later chapters outlined with NO
    // record at all. Merging a written chapter into one of those must not delete the source's prose.
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await writeChapter(fs, bookId, 'c1', 'The garage smelled of oil.');
    expect(await getChapter(fs, key, 'me', bookId, 'c2')).toBeNull(); // never drafted

    const res = await mergeChapters(fs, key, 'me', bookId, {
      chapterId: 'c1',
      intoChapterId: 'c2',
    });
    expect(res.ok).toBe(true);
    const survivor = await getChapter(fs, key, 'me', bookId, 'c2');
    expect(survivor?.markdown).toContain('The garage smelled of oil.');
    expect(survivor?.protectedBlocks).toHaveLength(1); // the person's own words came across too
    await assertConsistent(fs, bookId);
  });

  it('carries the merged-away chapter’s marks + to-dos onto the survivor (§16.1)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await writeChapter(fs, bookId, 'c1', 'The garage smelled of oil.');
    await writeChapter(fs, bookId, 'c2', 'The house was quiet.');
    await addMark(fs, key, 'me', bookId, 'c1', {
      id: 'm1',
      kind: 'todo',
      todoKind: 'ask',
      text: 'Ask about the garage',
      status: 'open',
      anchor: { paragraphId: 'p-1' },
      createdAt: '2026-07-22T00:00:00.000Z',
    });

    await mergeChapters(fs, key, 'me', bookId, { chapterId: 'c1', intoChapterId: 'c2' });

    // The mark anchors to prose that survived verbatim, so deleting it would discard the person's own note.
    expect((await getMarkup(fs, key, 'me', bookId, 'c2'))?.marks.map((m) => m.id)).toContain('m1');
    const todos = await getTodos(fs, key, 'me', bookId);
    expect(todos.todos.map((t) => ({ id: t.id, chapterId: t.chapterId }))).toEqual([
      { id: 'm1', chapterId: 'c2' },
    ]);
  });

  it('deleting a chapter clears its to-dos — no phantom "Needs you" entry survives (§16.1)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await writeChapter(fs, bookId, 'c1', 'Gone soon.');
    await addMark(fs, key, 'me', bookId, 'c1', {
      id: 'm1',
      kind: 'todo',
      todoKind: 'ask',
      text: 'Ask about the garage',
      status: 'open',
      anchor: { paragraphId: 'p-1' },
      createdAt: '2026-07-22T00:00:00.000Z',
    });
    expect((await getTodos(fs, key, 'me', bookId)).todos).toHaveLength(1);

    await deleteChapter(fs, key, 'me', bookId, { chapterId: 'c1' });

    // The markup file is gone, so nothing could ever re-sync this away — it has to be cleared here.
    expect((await getTodos(fs, key, 'me', bookId)).todos).toEqual([]);
  });

  it('refuses to merge a chapter into itself', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    const res = await mergeChapters(fs, key, 'me', bookId, {
      chapterId: 'c1',
      intoChapterId: 'c1',
    });
    expect(res.ok).toBe(false);
    expect((await outlineIds(fs, bookId))[0]!.chapters).toEqual(['c1', 'c2']);
  });

  it('deletes a chapter and its record, renumbering what remains', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    await writeChapter(fs, bookId, 'c1', 'Gone.');

    expect((await deleteChapter(fs, key, 'me', bookId, { chapterId: 'c1' })).ok).toBe(true);
    expect((await outlineIds(fs, bookId))[0]!.chapters).toEqual(['c2']);
    expect(await getChapter(fs, key, 'me', bookId, 'c1')).toBeNull();
    await assertConsistent(fs, bookId);
  });

  it('deletes a part with its chapters, but never the last part', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);

    expect((await deletePart(fs, key, 'me', bookId, { partId: 'p2' })).ok).toBe(true);
    expect(await getChapter(fs, key, 'me', bookId, 'c3')).toBeNull();
    await assertConsistent(fs, bookId);

    // A book with no parts has nowhere to put a chapter.
    const last = await deletePart(fs, key, 'me', bookId, { partId: 'p1' });
    expect(last.ok).toBe(false);
    expect((await getOutline(fs, key, 'me', bookId))?.parts).toHaveLength(1);
  });

  it('degrades honestly on a vanished id instead of throwing (a stale UI)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    for (const res of [
      await renameChapter(fs, key, 'me', bookId, { chapterId: 'ghost', title: 'X' }),
      await moveChapter(fs, key, 'me', bookId, { chapterId: 'ghost', toPartId: 'p1', toIndex: 0 }),
      await moveChapter(fs, key, 'me', bookId, { chapterId: 'c1', toPartId: 'ghost', toIndex: 0 }),
      await splitChapter(fs, key, 'me', bookId, {
        chapterId: 'ghost',
        firstTitle: 'A',
        secondTitle: 'B',
      }),
      await mergeChapters(fs, key, 'me', bookId, { chapterId: 'ghost', intoChapterId: 'c1' }),
      await deleteChapter(fs, key, 'me', bookId, { chapterId: 'ghost' }),
      await deletePart(fs, key, 'me', bookId, { partId: 'ghost' }),
      await addChapter(fs, key, 'me', bookId, { partId: 'ghost', title: 'X' }),
    ]) {
      expect(res.ok).toBe(false);
      expect(res.message).toBeTruthy();
    }
    // Nothing was half-applied.
    expect(await outlineIds(fs, bookId)).toEqual([
      { part: 'p1', chapters: ['c1', 'c2'] },
      { part: 'p2', chapters: ['c3'] },
    ]);
  });

  it('rejects a blank title rather than writing an untitled chapter', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    expect((await addChapter(fs, key, 'me', bookId, { partId: 'p1', title: '  ' })).ok).toBe(false);
    expect((await addPart(fs, key, 'me', bookId, { title: '' })).ok).toBe(false);
    expect((await renameChapter(fs, key, 'me', bookId, { chapterId: 'c1', title: ' ' })).ok).toBe(
      false,
    );
    expect((await listChapters(fs, key, 'me', bookId)).every((c) => c.title.trim())).toBe(true);
  });
});

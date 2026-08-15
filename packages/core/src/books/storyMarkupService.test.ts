import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { BookChapter, CommentMark, DeleteMark, TodoMark } from '../schemas';
import { addMark, editPassage, pinPassage, removeMark, updateMark } from './storyMarkupService';
import { getMarkup, getTodos, saveChapter } from './storyService';

const key = generateMasterKey();

function chapter(id: string): BookChapter {
  return {
    id,
    schemaVersion: 1,
    partId: 'p1',
    order: 0,
    title: 'The Garage',
    markdown: 'The garage smelled of cut pine.\n\nHe watched, and said nothing.',
    revision: 1,
    status: 'new',
    sourceSignature: '',
    provenance: [],
    protectedBlocks: [],
    pinnedQuotes: [],
    imagePlacements: [],
  };
}

const todo = (id: string, text: string): TodoMark => ({
  id,
  kind: 'todo',
  text,
  todoKind: 'remind',
  status: 'open',
  createdAt: 'now',
});
const del = (id: string): DeleteMark => ({
  id,
  kind: 'delete',
  anchor: { paragraphId: 'p0', quote: 'cut pine' },
  status: 'pending',
  createdAt: 'now',
});
const comment = (id: string): CommentMark => ({
  id,
  kind: 'comment',
  anchor: { paragraphId: 'p0', quote: 'cut pine' },
  intent: 'addContext',
  text: 'the lathe was three generations old',
  status: 'open',
  createdAt: 'now',
});

describe('storyMarkupService — mark CRUD + to-do roll-up (64 §3.3)', () => {
  it('adds a to-do and mirrors it into the book-level roll-up', async () => {
    const fs = memFileSystem();
    await addMark(fs, key, 'me', 'b1', 'c1', todo('t1', 'upload the shop photo'));
    expect((await getMarkup(fs, key, 'me', 'b1', 'c1')).marks[0]?.id).toBe('t1');
    const roll = await getTodos(fs, key, 'me', 'b1');
    expect(roll.todos).toEqual([
      {
        id: 't1',
        chapterId: 'c1',
        kind: 'remind',
        text: 'upload the shop photo',
        status: 'open',
        createdAt: 'now',
      },
    ]);
  });

  it('a non-to-do mark (delete/comment) leaves the roll-up empty', async () => {
    const fs = memFileSystem();
    await addMark(fs, key, 'me', 'b1', 'c1', del('d1'));
    await addMark(fs, key, 'me', 'b1', 'c1', comment('m1'));
    expect((await getTodos(fs, key, 'me', 'b1')).todos).toEqual([]);
    expect((await getMarkup(fs, key, 'me', 'b1', 'c1')).marks).toHaveLength(2);
  });

  it('updates a to-do’s status and the roll-up reflects it', async () => {
    const fs = memFileSystem();
    await addMark(fs, key, 'me', 'b1', 'c1', todo('t1', 'call my sister'));
    const updated = await updateMark(fs, key, 'me', 'b1', 'c1', 't1', { status: 'done' });
    expect(updated?.marks[0]?.status).toBe('done');
    expect((await getTodos(fs, key, 'me', 'b1')).todos[0]?.status).toBe('done');
    expect(await updateMark(fs, key, 'me', 'b1', 'c1', 'missing', { status: 'done' })).toBeNull();
  });

  it('edits a comment’s text without touching a delete’s (which has none)', async () => {
    const fs = memFileSystem();
    await addMark(fs, key, 'me', 'b1', 'c1', comment('m1'));
    const res = await updateMark(fs, key, 'me', 'b1', 'c1', 'm1', {
      text: 'it was my cousin, not my sister',
    });
    const mark = res?.marks[0];
    expect(mark?.kind).toBe('comment');
    if (mark?.kind === 'comment') expect(mark.text).toBe('it was my cousin, not my sister');
  });

  it('returns null (never throws) for a patch invalid for the mark’s kind', async () => {
    const fs = memFileSystem();
    await addMark(fs, key, 'me', 'b1', 'c1', del('d1')); // a delete: statuses are pending|applied|undone
    // 'done' is a to-do status — invalid for a delete. Degrades to null, not an unhandled Zod throw.
    expect(await updateMark(fs, key, 'me', 'b1', 'c1', 'd1', { status: 'done' })).toBeNull();
    // The mark is untouched.
    expect((await getMarkup(fs, key, 'me', 'b1', 'c1')).marks[0]?.status).toBe('pending');
    // A valid status change still works.
    const ok = await updateMark(fs, key, 'me', 'b1', 'c1', 'd1', { status: 'undone' });
    expect(ok?.marks[0]?.status).toBe('undone');
  });

  it('removes a mark from the chapter AND the roll-up', async () => {
    const fs = memFileSystem();
    await addMark(fs, key, 'me', 'b1', 'c1', todo('t1', 'a'));
    await addMark(fs, key, 'me', 'b1', 'c1', todo('t2', 'b'));
    await removeMark(fs, key, 'me', 'b1', 'c1', 't1');
    expect((await getMarkup(fs, key, 'me', 'b1', 'c1')).marks.map((m) => m.id)).toEqual(['t2']);
    expect((await getTodos(fs, key, 'me', 'b1')).todos.map((t) => t.id)).toEqual(['t2']);
  });

  it('keeps each chapter’s to-dos separate in the roll-up', async () => {
    const fs = memFileSystem();
    await addMark(fs, key, 'me', 'b1', 'c1', todo('t1', 'c1 thing'));
    await addMark(fs, key, 'me', 'b1', 'c2', todo('t2', 'c2 thing'));
    expect((await getTodos(fs, key, 'me', 'b1')).todos.map((t) => t.id).sort()).toEqual([
      't1',
      't2',
    ]);
    await removeMark(fs, key, 'me', 'b1', 'c1', 't1'); // removing c1's leaves c2's
    expect((await getTodos(fs, key, 'me', 'b1')).todos.map((t) => t.id)).toEqual(['t2']);
  });
});

describe('storyMarkupService — instant edit + pin (64 §3.3)', () => {
  it('inline-edits a span and records it as a protected block', async () => {
    const fs = memFileSystem();
    await saveChapter(fs, key, 'me', 'b1', chapter('c1'));
    const edited = await editPassage(
      fs,
      key,
      'me',
      'b1',
      'c1',
      { paragraphId: 'p0', quote: 'cut pine' },
      'cold steel',
    );
    expect(edited?.markdown).toContain('cold steel');
    expect(edited?.protectedBlocks[0]?.text).toBe('cold steel');
    // Refuses an orphaned span.
    expect(
      await editPassage(fs, key, 'me', 'b1', 'c1', { paragraphId: 'p0', quote: 'nope' }, 'x'),
    ).toBeNull();
  });

  it('pins a passage', async () => {
    const fs = memFileSystem();
    await saveChapter(fs, key, 'me', 'b1', chapter('c1'));
    const pinned = await pinPassage(
      fs,
      key,
      'me',
      'b1',
      'c1',
      { paragraphId: 'p1', quote: 'said nothing' },
      'said nothing',
    );
    expect(pinned?.pinnedQuotes[0]?.text).toBe('said nothing');
  });
});

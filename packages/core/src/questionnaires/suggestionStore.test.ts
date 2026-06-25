import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { FileSystem } from '../host';
import { SUGGESTION_CAP, type QuestionnaireSuggestion } from '../schemas';
import {
  accumulateSavedSuggestions,
  deleteSavedSuggestion,
  listSavedSuggestions,
} from './suggestionStore';

const key = generateMasterKey();
const now = new Date('2026-06-25T12:00:00.000Z');

const proposal = (title: string): QuestionnaireSuggestion => ({
  title,
  type: 'general',
  rationale: `why ${title}`,
  questions: [{ type: 'yesNo', prompt: `${title}?` }],
});

// A counter id generator so accumulated suggestions have stable, distinct ids in tests.
function counter(): () => string {
  let n = 0;
  return () => `s${++n}`;
}

describe('suggestionStore', () => {
  it('returns [] for a recipient with nothing saved', async () => {
    const fs: FileSystem = memFileSystem();
    expect(await listSavedSuggestions(fs, key, 'author-1', 'rcpt-1')).toEqual([]);
  });

  it('accumulates batches newest-first and persists per recipient', async () => {
    const fs: FileSystem = memFileSystem();
    const mint = counter();
    await accumulateSavedSuggestions(fs, key, 'author-1', 'rcpt-1', [proposal('A')], now, mint);
    const after = await accumulateSavedSuggestions(
      fs,
      key,
      'author-1',
      'rcpt-1',
      [proposal('B'), proposal('C')],
      now,
      mint,
    );
    // Newest batch prepended.
    expect(after.map((s) => s.title)).toEqual(['B', 'C', 'A']);
    expect(after.every((s) => s.id && s.createdAt === now.toISOString())).toBe(true);
    // A fresh read sees the same persisted set.
    expect((await listSavedSuggestions(fs, key, 'author-1', 'rcpt-1')).map((s) => s.title)).toEqual(
      ['B', 'C', 'A'],
    );
  });

  it('caps the set at SUGGESTION_CAP, dropping the oldest', async () => {
    const fs: FileSystem = memFileSystem();
    const mint = counter();
    // Accumulate CAP+2 one at a time (each prepended) — the realistic "Suggest more" cadence.
    let after = await listSavedSuggestions(fs, key, 'author-1', 'rcpt-1');
    for (let i = 0; i < SUGGESTION_CAP + 2; i++) {
      after = await accumulateSavedSuggestions(
        fs,
        key,
        'author-1',
        'rcpt-1',
        [proposal(`t${i}`)],
        now,
        mint,
      );
    }
    expect(after).toHaveLength(SUGGESTION_CAP);
    // Newest-first, capped: the last CAP titles kept (t10..t2), the two oldest (t0, t1) dropped.
    expect(after[0]?.title).toBe(`t${SUGGESTION_CAP + 1}`); // newest at the front
    expect(after.some((s) => s.title === 't0')).toBe(false);
    expect(after.some((s) => s.title === 't1')).toBe(false);
    expect(after.some((s) => s.title === 't2')).toBe(true); // the oldest still kept
  });

  it('keeps recipients isolated within one author doc', async () => {
    const fs: FileSystem = memFileSystem();
    const mint = counter();
    await accumulateSavedSuggestions(
      fs,
      key,
      'author-1',
      'rcpt-1',
      [proposal('forOne')],
      now,
      mint,
    );
    await accumulateSavedSuggestions(
      fs,
      key,
      'author-1',
      'rcpt-2',
      [proposal('forTwo')],
      now,
      mint,
    );
    expect((await listSavedSuggestions(fs, key, 'author-1', 'rcpt-1')).map((s) => s.title)).toEqual(
      ['forOne'],
    );
    expect((await listSavedSuggestions(fs, key, 'author-1', 'rcpt-2')).map((s) => s.title)).toEqual(
      ['forTwo'],
    );
  });

  it('keeps authors isolated (a different author has nothing)', async () => {
    const fs: FileSystem = memFileSystem();
    await accumulateSavedSuggestions(
      fs,
      key,
      'author-1',
      'rcpt-1',
      [proposal('A')],
      now,
      counter(),
    );
    expect(await listSavedSuggestions(fs, key, 'author-2', 'rcpt-1')).toEqual([]);
  });

  it('deletes a single suggestion by id, leaving the rest', async () => {
    const fs: FileSystem = memFileSystem();
    const saved = await accumulateSavedSuggestions(
      fs,
      key,
      'author-1',
      'rcpt-1',
      [proposal('A'), proposal('B')],
      now,
      counter(),
    );
    const target = saved.find((s) => s.title === 'A');
    const remaining = await deleteSavedSuggestion(
      fs,
      key,
      'author-1',
      'rcpt-1',
      target?.id ?? 'missing',
      now,
    );
    expect(remaining.map((s) => s.title)).toEqual(['B']);
    expect((await listSavedSuggestions(fs, key, 'author-1', 'rcpt-1')).map((s) => s.title)).toEqual(
      ['B'],
    );
  });

  it('a delete for an unknown recipient/id is a harmless no-op', async () => {
    const fs: FileSystem = memFileSystem();
    expect(await deleteSavedSuggestion(fs, key, 'author-1', 'rcpt-x', 'nope', now)).toEqual([]);
  });
});

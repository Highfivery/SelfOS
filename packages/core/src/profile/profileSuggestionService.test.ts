import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { Person, RawProfileSuggestion } from '../schemas';
import { getPerson, savePerson } from '../people';
import {
  acceptSuggestion,
  dismissSuggestion,
  listPendingSuggestions,
  recordSuggestionsFromAnalysis,
} from './profileSuggestionService';

const key = generateMasterKey();
const NOW = new Date('2026-06-15T10:00:00.000Z');
const later = (mins: number): Date => new Date(NOW.getTime() + mins * 60_000);

function person(over: Partial<Person> = {}): Person {
  return {
    id: 'p1',
    schemaVersion: 4,
    displayName: 'Sam',
    isSubject: true,
    tags: [],
    occupation: 'nurse',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  };
}

async function setup() {
  const fs = memFileSystem();
  await savePerson(fs, key, person());
  return fs;
}

const sugg = (over: Partial<RawProfileSuggestion> = {}): RawProfileSuggestion => ({
  field: 'occupation',
  observed: 'teacher',
  current: 'nurse',
  rationale: 'mentioned starting a teaching job',
  ...over,
});

describe('profileSuggestionService', () => {
  it('records a valid field suggestion and ignores non-field / empty deltas (trust boundary)', async () => {
    const fs = await setup();
    await recordSuggestionsFromAnalysis(
      fs,
      key,
      'p1',
      [
        sugg(),
        sugg({ field: 'notAField', observed: 'x' }),
        sugg({ field: 'location', observed: '' }),
      ],
      'session',
      'insight-1',
      false,
      NOW,
    );
    const pending = await listPendingSuggestions(fs, key, 'p1');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      field: 'occupation',
      observed: 'teacher',
      status: 'pending',
    });
  });

  it('accept writes the Person field (and a list field splits on commas); marks accepted', async () => {
    const fs = await setup();
    await recordSuggestionsFromAnalysis(fs, key, 'p1', [sugg()], 'session', 'i1', false, NOW);
    await recordSuggestionsFromAnalysis(
      fs,
      key,
      'p1',
      [sugg({ field: 'languages', observed: 'English, Spanish', current: undefined })],
      'session',
      'i1',
      false,
      NOW,
    );
    const pending = await listPendingSuggestions(fs, key, 'p1');
    const occ = pending.find((s) => s.field === 'occupation')!;
    const langs = pending.find((s) => s.field === 'languages')!;
    await acceptSuggestion(fs, key, 'p1', occ.id, later(1));
    await acceptSuggestion(fs, key, 'p1', langs.id, later(1));
    const p = await getPerson(fs, key, 'p1');
    expect(p?.occupation).toBe('teacher');
    expect(p?.languages).toEqual(['English', 'Spanish']);
    expect(await listPendingSuggestions(fs, key, 'p1')).toHaveLength(0); // both no longer pending
  });

  it('a newer reading supersedes a field’s prior pending suggestion (no stacking)', async () => {
    const fs = await setup();
    await recordSuggestionsFromAnalysis(
      fs,
      key,
      'p1',
      [sugg({ observed: 'teacher' })],
      'session',
      'i1',
      false,
      NOW,
    );
    await recordSuggestionsFromAnalysis(
      fs,
      key,
      'p1',
      [sugg({ observed: 'professor' })],
      'session',
      'i2',
      false,
      later(5),
    );
    const pending = await listPendingSuggestions(fs, key, 'p1');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.observed).toBe('professor');
  });

  it('does not re-nag a dismissed delta', async () => {
    const fs = await setup();
    await recordSuggestionsFromAnalysis(fs, key, 'p1', [sugg()], 'session', 'i1', false, NOW);
    const s = (await listPendingSuggestions(fs, key, 'p1'))[0]!;
    await dismissSuggestion(fs, key, 'p1', s.id, later(1));
    // The same delta surfaces again later → it must NOT create a new pending suggestion.
    await recordSuggestionsFromAnalysis(fs, key, 'p1', [sugg()], 'session', 'i2', false, later(10));
    expect(await listPendingSuggestions(fs, key, 'p1')).toHaveLength(0);
  });

  it('carries the restricted flag through (own-context-only, §8.4)', async () => {
    const fs = await setup();
    await recordSuggestionsFromAnalysis(
      fs,
      key,
      'p1',
      [sugg({ field: 'sexualOrientation', observed: 'Bisexual', current: undefined })],
      'intake',
      'i1',
      true,
      NOW,
    );
    expect((await listPendingSuggestions(fs, key, 'p1'))[0]?.restricted).toBe(true);
  });
});

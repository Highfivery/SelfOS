import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { savePerson } from '../people';
import type { BookOutline, LifeTimeline, Person, TimelineEvent } from '../schemas';
import { buildStoryCorpus, corpusText } from './storyCorpus';
import {
  addTimelineEvent,
  generatedEventId,
  mergeGeneratedTimeline,
  normalizeMoment,
  removeTimelineEvent,
  sortTimeline,
  timelineLines,
  updateTimelineEvent,
} from './storyTimeline';
import {
  applyFoundations,
  createBook,
  getTimeline,
  rewriteBookFromScratch,
  saveTimeline,
} from './storyService';

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

const outline: BookOutline = {
  schemaVersion: 1,
  approved: false,
  parts: [
    {
      id: 'p1',
      title: 'Roots',
      chapters: [{ id: 'c1', title: 'The Garage', brief: '', lifeAreas: [], order: 0 }],
    },
  ],
};

function event(over: Partial<TimelineEvent> & { label: string }): TimelineEvent {
  return { id: `e-${over.label}`, userEdited: false, ...over };
}

async function seedBook(fs: ReturnType<typeof memFileSystem>, events: TimelineEvent[] = []) {
  await savePerson(fs, key, person);
  const book = await createBook(fs, key, {
    personId: 'me',
    type: 'biography',
    title: 'The Story of Ben',
    config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    now,
  });
  const timeline: LifeTimeline = { schemaVersion: 1, events };
  await applyFoundations(
    fs,
    key,
    'me',
    book.id,
    { essence: 'A quiet man.', outline, timeline },
    now,
  );
  return book.id;
}

describe('the timeline studio (64 §16.2)', () => {
  it('sorts dated moments first, then approximate, then undated', () => {
    const sorted = sortTimeline([
      event({ label: 'Someday' }),
      event({ label: 'Moved west', approx: 'mid-90s' }),
      event({ label: 'Born', date: '1985' }),
      event({ label: 'Married', date: '2011-06' }),
    ]).map((e) => e.label);
    expect(sorted).toEqual(['Born', 'Married', 'Moved west', 'Someday']);
  });

  it('adds, corrects and removes a moment — every hand edit stamps userEdited', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);

    expect(
      (await addTimelineEvent(fs, key, 'me', bookId, { label: 'Born', date: '1985' })).ok,
    ).toBe(true);
    const added = (await getTimeline(fs, key, 'me', bookId))!.events[0]!;
    expect(added).toMatchObject({ label: 'Born', date: '1985', userEdited: true });

    expect(
      (await updateTimelineEvent(fs, key, 'me', bookId, { eventId: added.id, date: '1987' })).ok,
    ).toBe(true);
    expect((await getTimeline(fs, key, 'me', bookId))!.events[0]!.date).toBe('1987');

    // Clearing a date is expressible — "actually I don't know the year".
    await updateTimelineEvent(fs, key, 'me', bookId, { eventId: added.id, date: '' });
    expect((await getTimeline(fs, key, 'me', bookId))!.events[0]!.date).toBeUndefined();

    expect((await removeTimelineEvent(fs, key, 'me', bookId, { eventId: added.id })).ok).toBe(true);
    expect((await getTimeline(fs, key, 'me', bookId))!.events).toEqual([]);
  });

  it('degrades honestly on a vanished moment, and refuses a blank name', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs);
    for (const res of [
      await updateTimelineEvent(fs, key, 'me', bookId, { eventId: 'ghost', label: 'X' }),
      await removeTimelineEvent(fs, key, 'me', bookId, { eventId: 'ghost' }),
      await addTimelineEvent(fs, key, 'me', bookId, { label: '   ' }),
    ]) {
      expect(res.ok).toBe(false);
      expect(res.message).toBeTruthy();
    }
  });

  it('lets a person lay out a chronology BEFORE the biographer has run', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person);
    const book = await createBook(fs, key, {
      personId: 'me',
      type: 'biography',
      title: 'Unwritten',
      config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
      now,
    });
    // No foundations pass yet → no timeline file at all.
    expect(await getTimeline(fs, key, 'me', book.id)).toBeNull();
    expect(
      (await addTimelineEvent(fs, key, 'me', book.id, { label: 'Born', date: '1985' })).ok,
    ).toBe(true);
    expect((await getTimeline(fs, key, 'me', book.id))!.events).toHaveLength(1);
  });

  // --- The promise `userEdited` has always encoded, and nothing honoured until now -------------------

  it('mergeGeneratedTimeline keeps a hand-corrected moment and drops the model’s version of it', () => {
    const stored: LifeTimeline = {
      schemaVersion: 1,
      events: [
        event({ id: 'mine', label: 'Born in Ohio', date: '1987', userEdited: true }),
        event({ id: 'theirs', label: 'Moved west', date: '1995' }),
      ],
    };
    const merged = mergeGeneratedTimeline(stored, [
      event({ id: 'gen-1', label: 'born in ohio', date: '1985' }), // the model's wrong year, again
      event({ id: 'gen-2', label: 'Started the shop', date: '2001' }),
    ]);
    const labels = merged.events.map((e) => e.label);
    expect(labels).toContain('Born in Ohio');
    expect(labels).not.toContain('born in ohio'); // the correction stands, case-insensitively
    expect(merged.events.find((e) => e.label === 'Born in Ohio')?.date).toBe('1987');
    // A generated event the person never touched is replaced by the fresh pass; new ones come in.
    expect(labels).toContain('Started the shop');
    expect(labels).not.toContain('Moved west');
  });

  it('a later foundations pass does NOT revert a corrected date (§16.2)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs, [event({ id: 'e1', label: 'Born in Ohio', date: '1985' })]);

    // The person fixes the year…
    const stored = (await getTimeline(fs, key, 'me', bookId))!.events[0]!;
    await updateTimelineEvent(fs, key, 'me', bookId, { eventId: stored.id, date: '1987' });

    // …and a later pass re-proposes its original (wrong) version.
    await applyFoundations(
      fs,
      key,
      'me',
      bookId,
      {
        essence: 'A quiet man.',
        outline,
        timeline: {
          schemaVersion: 1,
          events: [event({ id: 'regen', label: 'Born in Ohio', date: '1985' })],
        },
      },
      now,
    );

    const after = (await getTimeline(fs, key, 'me', bookId))!.events;
    expect(after.filter((e) => e.label === 'Born in Ohio')).toHaveLength(1);
    expect(after[0]!.date).toBe('1987');
  });

  it('a RENAMED moment absorbs the model’s re-proposal instead of duplicating it (§16.2)', () => {
    // The person fixed the city AND the year. A label-only match would let "Born in Ohio" come back beside
    // their version — with the wording and date they corrected away, presented as authoritative.
    const stored: LifeTimeline = {
      schemaVersion: 1,
      events: [
        {
          id: generatedEventId('Born in Ohio'),
          label: 'Born in Columbus',
          date: '1987',
          userEdited: true,
        },
      ],
    };
    const merged = mergeGeneratedTimeline(stored, [
      {
        id: generatedEventId('Born in Ohio'),
        label: 'Born in Ohio',
        date: '1985',
        userEdited: false,
      },
    ]);
    expect(merged.events).toHaveLength(1);
    expect(merged.events[0]).toMatchObject({ label: 'Born in Columbus', date: '1987' });
  });

  it('a DELETED moment stays deleted — the next pass can’t re-propose it (§16.2)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs, [event({ id: 'e1', label: 'The divorce', date: '2004' })]);

    await removeTimelineEvent(fs, key, 'me', bookId, { eventId: 'e1' });
    expect((await getTimeline(fs, key, 'me', bookId))!.events).toEqual([]);

    await applyFoundations(
      fs,
      key,
      'me',
      bookId,
      {
        essence: 'A quiet man.',
        outline,
        timeline: {
          schemaVersion: 1,
          events: [event({ id: 'regen', label: 'The divorce', date: '2004' })],
        },
      },
      now,
    );
    // "Take this out of my book" is the most likely reason to open the panel — it has to stick.
    expect((await getTimeline(fs, key, 'me', bookId))!.events).toEqual([]);

    // Adding it back clears the tombstone — they're allowed to change their mind.
    await addTimelineEvent(fs, key, 'me', bookId, { label: 'The divorce', date: '2004' });
    expect((await getTimeline(fs, key, 'me', bookId))!.events).toHaveLength(1);
    expect((await getTimeline(fs, key, 'me', bookId))!.removed ?? []).not.toContain('the divorce');
  });

  it('normalizes punctuation/case/spacing when matching a re-proposal', () => {
    expect(normalizeMoment('  Born  in Ohio. ')).toBe('born in ohio');
    expect(generatedEventId('Born in Ohio')).toBe(generatedEventId('born in  ohio!'));
  });

  it('persists the chronology SORTED, so a reload shows the same order as the edit did', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs, [
      event({ id: 'e1', label: 'Started the shop', date: '2001' }),
    ]);
    await addTimelineEvent(fs, key, 'me', bookId, { label: 'Born', date: '1985' });
    expect((await getTimeline(fs, key, 'me', bookId))!.events.map((e) => e.label)).toEqual([
      'Born',
      'Started the shop',
    ]);
  });

  it('a rewrite from scratch keeps the moments the person authored, not the model’s (§16.2)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs, [event({ id: 'e1', label: 'Born in Ohio', date: '1985' })]);
    await updateTimelineEvent(fs, key, 'me', bookId, { eventId: 'e1', date: '1987' });
    await addTimelineEvent(fs, key, 'me', bookId, { label: 'We moved west', approx: 'mid-90s' });
    // A moment the biographer proposed and nobody touched.
    await saveTimeline(fs, key, 'me', bookId, {
      schemaVersion: 1,
      events: [
        ...(await getTimeline(fs, key, 'me', bookId))!.events,
        event({ id: 'gen', label: 'A guessed milestone', date: '1999' }),
      ],
    });

    await rewriteBookFromScratch(fs, key, 'me', bookId, now);

    // The dialog promises the timeline is kept — so the person's own moments must survive, and only the
    // biographer's guesses go with the discarded draft.
    const after = (await getTimeline(fs, key, 'me', bookId))!.events.map((e) => e.label);
    expect(after).toContain('Born in Ohio');
    expect(after).toContain('We moved west');
    expect(after).not.toContain('A guessed milestone');
  });

  // --- It actually feeds the book ------------------------------------------------------------------

  it('dated moments reach the corpus as citable, dated source material (§16.2)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs, [
      event({ id: 'e1', label: 'Born in Ohio', date: '1985' }),
      event({ id: 'e2', label: 'Moved west', approx: 'mid-90s' }),
    ]);

    const corpus = await buildStoryCorpus(fs, key, 'me', bookId);
    const text = corpusText(corpus);
    expect(text).toContain('1985 — Born in Ohio');
    expect(text).toContain('mid-90s — Moved west');
    // Cited per event, so a paragraph can point at the moment it placed — and a `source` exclusion can
    // drop one moment rather than the whole chronology.
    const items = corpus.items.filter((i) => i.sourceRef.kind === 'timeline');
    expect(items.map((i) => i.sourceRef.id).sort()).toEqual(['e1', 'e2']);
    expect(items.find((i) => i.sourceRef.id === 'e1')?.date).toBe('1985');
  });

  it('a source-excluded moment stays out of the corpus (§3.3)', async () => {
    const fs = memFileSystem();
    const bookId = await seedBook(fs, [
      event({ id: 'e1', label: 'Born in Ohio', date: '1985' }),
      event({ id: 'e2', label: 'A private year', date: '1999' }),
    ]);
    const corpus = await buildStoryCorpus(fs, key, 'me', bookId, [
      { id: 'x1', kind: 'source', value: 'e2', createdAt: 'now' },
    ]);
    const text = corpusText(corpus);
    expect(text).toContain('Born in Ohio');
    expect(text).not.toContain('A private year');
  });

  it('timelineLines renders a compact "when — what" per moment, in order', () => {
    expect(
      timelineLines({
        schemaVersion: 1,
        events: [
          event({ label: 'Moved west', approx: 'mid-90s' }),
          event({ label: 'Born', date: '1985' }),
          event({ label: 'Undated' }),
        ],
      }),
    ).toEqual(['1985 — Born', 'mid-90s — Moved west', 'Undated']);
    expect(timelineLines(null)).toEqual([]);
  });
});

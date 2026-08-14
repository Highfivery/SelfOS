import type { FileSystem } from '../host';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { LifeTimelineSchema, type LifeTimeline, type TimelineEvent } from '../schemas';
import { normalizeMoment, sortTimeline } from './storyTimeline';
import { getTimeline, saveTimeline } from './storyService';

/**
 * The person-level timeline (72 §3.8/§4.3).
 *
 * A chronology belongs to a life, not to a book. Before this, every book kept its own — so correcting the
 * year you left home in your biography left it wrong in your memoir, and the same correction had to be made
 * again in each. What you fix here stays fixed, and follows you into every book you ever write.
 *
 * A book can still hold its OWN moments (`bookScoped`), for a beat that belongs to one story and would be a
 * lie about the life — an invented event in a children's book, a scene that only that book stages.
 */

function personTimelinePath(personId: string): string {
  return `people/${personId}/story/timeline.enc`;
}

export async function getPersonTimeline(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<LifeTimeline | null> {
  const raw = await readEncryptedJson(fs, personTimelinePath(personId), key);
  return raw ? LifeTimelineSchema.parse(raw) : null;
}

export async function savePersonTimeline(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  timeline: LifeTimeline,
): Promise<void> {
  await writeEncryptedJson(
    fs,
    personTimelinePath(personId),
    { ...timeline, events: sortTimeline(timeline.events) },
    key,
  );
}

/**
 * Move a book's life moments onto the person, once. Idempotent and safe to run on every read.
 *
 * Every moment written before 72 is a life moment — books had no other kind — so the whole file moves and
 * the book keeps only what is explicitly `bookScoped`. Where the same moment already exists on the person,
 * a **`userEdited`** one wins: a correction the person typed must never be overwritten by a generated
 * duplicate from another book (the 64 §16.2 rule, applied across books now that they share a chronology).
 */
export async function migrateBookTimeline(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<void> {
  const book = await getTimeline(fs, key, personId, bookId);
  if (!book) return;
  const moving = book.events.filter((e) => !e.bookScoped);
  // Tombstones belong to the LIFE too — "I took that out" is a fact about the person, not one book. Leaving
  // them behind means a moment re-added on the person still reads as removed through the book's view.
  const tombstones = book.removed ?? [];
  if (moving.length === 0 && tombstones.length === 0) return;

  const person = (await getPersonTimeline(fs, key, personId)) ?? {
    schemaVersion: 1 as const,
    events: [],
  };
  const byMoment = new Map(person.events.map((e) => [normalizeMoment(e.label), e]));
  for (const e of moving) {
    const marker = normalizeMoment(e.label);
    const existing = byMoment.get(marker);
    if (!existing) {
      byMoment.set(marker, e);
      continue;
    }
    // A typed correction outranks a generated one, whichever book it came from.
    if (e.userEdited && !existing.userEdited) byMoment.set(marker, e);
  }
  const removed = [...new Set([...(person.removed ?? []), ...tombstones])];
  await savePersonTimeline(fs, key, personId, {
    schemaVersion: 1,
    events: [...byMoment.values()],
    ...(removed.length > 0 ? { removed } : {}),
  });
  // The book keeps only its own moments. Written after the person timeline, so a crash between the two
  // leaves a duplicate (harmless, deduped by the next run) rather than losing the moments entirely.
  await saveTimeline(fs, key, personId, bookId, {
    schemaVersion: 1,
    events: book.events.filter((e) => e.bookScoped),
  });
}

/**
 * What a book's chronology IS: the person's life plus this book's own moments.
 *
 * A PURE read — it deliberately does not migrate. Migrating here would give every reader a write side
 * effect, and two readers racing (the app and anything else looking at the same vault) can then truncate a
 * file the other is mid-write on. `migrateBookTimeline` runs once on the book-open path instead, where
 * there is a single writer.
 *
 * It merges by normalized label with the person winning, so it reads correctly both before that migration
 * has run and after — a book's un-migrated life moments still appear, and never twice.
 */
export async function readBookTimeline(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<LifeTimeline> {
  const person = await getPersonTimeline(fs, key, personId);
  const book = await getTimeline(fs, key, personId, bookId);
  const seen = new Set((person?.events ?? []).map((e) => normalizeMoment(e.label)));
  const fromBook = (book?.events ?? []).filter(
    (e) => e.bookScoped || !seen.has(normalizeMoment(e.label)),
  );
  const events: TimelineEvent[] = [...(person?.events ?? []), ...fromBook];
  const removed = [...new Set([...(person?.removed ?? []), ...(book?.removed ?? [])])];
  return {
    schemaVersion: 1,
    events: sortTimeline(events),
    ...(removed.length > 0 ? { removed } : {}),
  };
}

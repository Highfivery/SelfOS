import type { FileSystem } from '../host';
import { uuid } from '../id';
import { NoteSchema, type Note, type NoteSendInput } from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * Notes (76 §4) — an owner-authored note to ONE person, stored under the AUTHOR.
 *
 * It lives in the author's folder, not the recipient's, for the same reason a contribution invitation
 * does (08 §35.3): the thing offered is not the recipient's to hold, and writing into their space for
 * what is the author's artifact would cross the trust boundary. The recipient's Inbox finds it by
 * scanning for notes addressed to them.
 */

const notesDir = (authorPersonId: string): string => `people/${authorPersonId}/notes`;
const notePath = (authorPersonId: string, id: string): string =>
  `${notesDir(authorPersonId)}/${id}.enc`;

/** A safe path segment — guards a read against a crafted id (the `emailSend` precedent). */
const isSafeSegment = (v: string): boolean => /^[A-Za-z0-9_-]+$/.test(v);

/**
 * Create the note record. Written BEFORE any send is attempted (76 §5.3): the email is the reach
 * layer and may fail for reasons that have nothing to do with the note — no contact address, Resend
 * not configured, a transport error — and none of them may lose it.
 */
export async function createNote(
  fs: FileSystem,
  key: Uint8Array,
  authorPersonId: string,
  input: NoteSendInput,
  now: Date,
): Promise<Note> {
  const note: Note = {
    id: uuid(),
    schemaVersion: 1,
    authorPersonId,
    recipientPersonId: input.recipientPersonId,
    type: input.type,
    subject: input.subject,
    body: input.body,
    // An announcement carries no answers by design — nothing to tap means no false click signal.
    answers: input.type === 'announcement' ? [] : input.answers,
    drafted: input.drafted,
    createdAt: now.toISOString(),
  };
  await writeEncryptedJson(fs, notePath(authorPersonId, note.id), note, key);
  return note;
}

/** Stamp the email outcome onto a note once the send has been attempted. Best-effort, never throws. */
export async function markNoteEmailed(
  fs: FileSystem,
  key: Uint8Array,
  authorPersonId: string,
  noteId: string,
  emailEntryId: string,
  now: Date,
): Promise<void> {
  const existing = await readNote(fs, key, authorPersonId, noteId);
  if (!existing) return;
  await writeEncryptedJson(
    fs,
    notePath(authorPersonId, noteId),
    { ...existing, emailedAt: now.toISOString(), emailEntryId },
    key,
  );
}

export async function readNote(
  fs: FileSystem,
  key: Uint8Array,
  authorPersonId: string,
  noteId: string,
): Promise<Note | null> {
  if (!isSafeSegment(authorPersonId) || !isSafeSegment(noteId)) return null;
  try {
    const raw = await readEncryptedJson(fs, notePath(authorPersonId, noteId), key);
    if (!raw) return null;
    const parsed = NoteSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Every note this person has written, newest first. A corrupt record is skipped, never fatal. */
export async function listNotesByAuthor(
  fs: FileSystem,
  key: Uint8Array,
  authorPersonId: string,
): Promise<Note[]> {
  const out: Note[] = [];
  for (const name of await fs.list(notesDir(authorPersonId))) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(fs, `${notesDir(authorPersonId)}/${name}`, key);
    if (!raw) continue;
    const parsed = NoteSchema.safeParse(raw);
    if (parsed.success) out.push(parsed.data);
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Every note addressed TO this person, across every author — what the recipient's Inbox lists.
 *
 * `authorIds` is passed in rather than resolved here so this stays free of the people module (the
 * `insights` ↔ `people` cycle-avoidance pattern).
 */
export async function listNotesForRecipient(
  fs: FileSystem,
  key: Uint8Array,
  recipientPersonId: string,
  authorIds: readonly string[],
): Promise<Note[]> {
  const out: Note[] = [];
  for (const authorId of authorIds) {
    if (authorId === recipientPersonId) continue; // a note to yourself is not a queue item
    for (const note of await listNotesByAuthor(fs, key, authorId)) {
      if (note.recipientPersonId === recipientPersonId) out.push(note);
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Delete a note. Only the author's own path is reachable, so an id alone can't reach another's. */
export async function deleteNote(
  fs: FileSystem,
  authorPersonId: string,
  noteId: string,
): Promise<void> {
  if (!isSafeSegment(authorPersonId) || !isSafeSegment(noteId)) return;
  await fs.remove(notePath(authorPersonId, noteId));
}

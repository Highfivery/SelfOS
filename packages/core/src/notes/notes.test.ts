import { describe, expect, it } from 'vitest';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import { generateMasterKey } from '../crypto';
import { upsertPerson } from '../people/peopleService';
import { saveInsight } from '../insights/insightStore';
import { uuid } from '../id';
import type { AiDeps } from '../questionnaires/aiCall';
import { buildNoteContext } from './noteContext';
import { containsFirstPerson, draftNote } from './noteDraft';
import { createNote, listNotesByAuthor, listNotesForRecipient, markNoteEmailed } from './noteStore';
import { collectInbox } from '../inbox';
import { registerBuiltInInboxProviders } from '../inbox/providers';
import { buildNoteEmail } from '../email/emailComposer';
import {
  drainEmailTaps,
  listEmailResponses,
  mintEmailToken,
  noteAnswerOf,
  recordNoteAnswer,
} from '../email/emailResponse';

const NOW = new Date('2026-08-21T12:00:00.000Z');

async function seed(): Promise<{ fs: FileSystem; key: Uint8Array; owner: string; her: string }> {
  const fs = memFileSystem();
  const key = generateMasterKey();
  const owner = (await upsertPerson(fs, key, { displayName: 'Ben', isSubject: true, tags: [] })).id;
  const her = (
    await upsertPerson(fs, key, {
      displayName: 'Angel',
      isSubject: true,
      tags: [],
      occupation: 'nurse',
      healthNotes: 'migraines',
      faith: 'none',
      notes: 'a private note',
      // Locked to own-context-only everywhere ELSE in the app. The note draft reads it anyway (§8.1).
      privateFields: ['notes', 'healthNotes'],
    })
  ).id;
  return { fs, key, owner, her };
}

/** A Claude fake that returns whatever text it is given. */
function fakeClaude(text: string): ClaudeClient {
  return {
    send: () => Promise.resolve(text),
    stream: (_o, onDelta) => {
      onDelta(text);
      return Promise.resolve({
        text,
        // The APP's usage field names, not the SDK's — a fake that invents `cacheCreationTokens`
        // writes nulls into the usage event and every later budget check throws (74 §3.6.18).
        usage: { inputTokens: 10, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0 },
        stopReason: 'end_turn' as const,
      });
    },
  };
}

const aiDeps = (fs: FileSystem, key: Uint8Array, personId: string, text: string): AiDeps => ({
  fs,
  key,
  client: fakeClaude(text),
  apiKey: 'k',
  model: 'claude-sonnet-4-6',
  personId,
  now: NOW,
});

describe('notes — the record (76 §4)', () => {
  it('is written before any send, and an announcement carries no answers', async () => {
    const { fs, key, owner, her } = await seed();

    const note = await createNote(
      fs,
      key,
      owner,
      {
        recipientPersonId: her,
        type: 'announcement',
        subject: 'Dreams can draw your dreams now',
        body: 'It reads the dream and paints it.',
        // Even if answers arrive, an announcement drops them: nothing to tap means no false click
        // signal and no homework framing.
        answers: [{ label: 'Nice', stance: 'yes' }],
        drafted: 'ai',
      },
      NOW,
    );

    expect(note.answers).toEqual([]);
    expect(note.emailedAt).toBeUndefined(); // nothing has been sent yet — the record comes first
    expect((await listNotesByAuthor(fs, key, owner))[0]?.id).toBe(note.id);
  });

  it('a question keeps its answers, and the email outcome is stamped separately', async () => {
    const { fs, key, owner, her } = await seed();
    const note = await createNote(
      fs,
      key,
      owner,
      {
        recipientPersonId: her,
        type: 'question',
        subject: 'What would you want more of?',
        body: 'First thing that comes to mind.',
        answers: [
          { label: 'More time outside', stance: 'other' },
          { label: 'Quiet evenings', stance: 'other' },
        ],
        drafted: 'ai',
      },
      NOW,
    );
    expect(note.answers).toHaveLength(2);

    await markNoteEmailed(fs, key, owner, note.id, 'entry-1', NOW);
    const after = (await listNotesByAuthor(fs, key, owner))[0];
    expect(after?.emailedAt).toBe(NOW.toISOString());
    expect(after?.emailEntryId).toBe('entry-1');
  });

  it('the recipient finds notes addressed to them, and never a note to someone else', async () => {
    const { fs, key, owner, her } = await seed();
    const other = (await upsertPerson(fs, key, { displayName: 'Mara', isSubject: true, tags: [] }))
      .id;

    const base = { type: 'suggestion' as const, body: 'b', answers: [], drafted: 'self' as const };
    await createNote(
      fs,
      key,
      owner,
      { ...base, recipientPersonId: her, subject: 'For Angel' },
      NOW,
    );
    await createNote(
      fs,
      key,
      owner,
      { ...base, recipientPersonId: other, subject: 'For Mara' },
      NOW,
    );
    // A note the owner addressed to themselves is not a queue item.
    await createNote(fs, key, owner, { ...base, recipientPersonId: owner, subject: 'Self' }, NOW);

    const hers = await listNotesForRecipient(fs, key, her, [owner, her, other]);
    expect(hers.map((n) => n.subject)).toEqual(['For Angel']);

    const mine = await listNotesForRecipient(fs, key, owner, [owner, her, other]);
    expect(mine).toHaveLength(0);
  });
});

describe('notes — the draft context (76 §5.2)', () => {
  /*
   * This is the ONE deliberate exception to the sharing model. It is pinned rather than left implicit,
   * so that a future tightening of the cross-person gates does not silently narrow it — and so anyone
   * reading it sees that the unfiltered read is a decision, not an oversight.
   */
  it('reads locked and private material — the exception is intentional', async () => {
    const { fs, key, her } = await seed();
    await saveInsight(fs, key, {
      id: uuid(),
      schemaVersion: 1,
      subjectPersonId: her,
      source: 'session',
      summary: 'Work has been heavy lately',
      facts: [{ id: uuid(), text: 'Not sleeping well', shareable: false, restricted: true }],
      confidence: 'high',
      categories: [],
      approved: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      provenance: { at: NOW.toISOString() },
    });

    const { recipientName, digest } = await buildNoteContext(fs, key, her);

    expect(recipientName).toBe('Angel');
    expect(digest).toContain('nurse');
    expect(digest).toContain('migraines'); // a locked field
    expect(digest).toContain('a private note'); // another locked field
    expect(digest).toContain('Work has been heavy lately');
    expect(digest).toContain('Not sleeping well'); // a RESTRICTED fact
  });

  it('degrades rather than fails when there is nothing on file', async () => {
    const fs = memFileSystem();
    const key = generateMasterKey();
    const { recipientName, digest } = await buildNoteContext(fs, key, 'nobody');
    expect(recipientName).toBe('them');
    expect(digest).toBe('');
  });
});

describe('notes — the voice rule (76 §5.4)', () => {
  it('catches a first person, and leaves ordinary copy alone', () => {
    expect(containsFirstPerson('I noticed you’ve been writing')).toBe(true);
    expect(containsFirstPerson('I’m glad you tried it')).toBe(true);
    expect(containsFirstPerson('I’ve seen this before')).toBe(true);
    expect(containsFirstPerson('Something for those late nights')).toBe(false);
    expect(containsFirstPerson('You’ve written most nights this month')).toBe(false);
    expect(containsFirstPerson('Your memories are yours')).toBe(false);
  });

  it('REFUSES a draft that speaks as a person rather than sending it', async () => {
    const { fs, key, owner, her } = await seed();
    const reply = JSON.stringify({
      subject: 'Something for late nights',
      body: 'I noticed you’ve been writing most nights. SelfOS can paint one now.',
      answers: [],
    });

    const res = await draftNote(aiDeps(fs, key, owner, reply), {
      recipientPersonId: her,
      type: 'announcement',
      intent: 'dream images are live',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('spoke as a person');
  });

  it('accepts the same note written in SelfOS’s voice', async () => {
    const { fs, key, owner, her } = await seed();
    const reply = JSON.stringify({
      subject: 'Something for those late nights',
      body: 'You’ve written most nights this month. SelfOS can turn one of those into an image now.',
      answers: [],
    });

    const res = await draftNote(aiDeps(fs, key, owner, reply), {
      recipientPersonId: her,
      type: 'announcement',
      intent: 'dream images are live',
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.subject).toBe('Something for those late nights');
      expect(res.answers).toEqual([]); // an announcement never carries answers
    }
  });

  it('drops answers on an announcement even when the model returns them', async () => {
    const { fs, key, owner, her } = await seed();
    const reply = JSON.stringify({
      subject: 'Covers are here',
      body: 'Your books can have covers now.',
      answers: [{ label: 'Nice', stance: 'yes' }],
    });

    const res = await draftNote(aiDeps(fs, key, owner, reply), {
      recipientPersonId: her,
      type: 'announcement',
      intent: 'covers',
    });
    expect(res.ok && res.answers).toEqual([]);
  });

  it('keeps a question’s answers, and reports an unusable reply honestly', async () => {
    const { fs, key, owner, her } = await seed();

    const good = await draftNote(
      aiDeps(
        fs,
        key,
        owner,
        JSON.stringify({
          subject: 'One thing you’d want more of?',
          body: 'No wrong answer here.',
          answers: [
            { label: 'More time outside', stance: 'other' },
            { label: 'Quiet evenings', stance: 'other' },
          ],
        }),
      ),
      { recipientPersonId: her, type: 'question', intent: 'ask what she wants more of' },
    );
    expect(good.ok && good.answers.map((a) => a.label)).toEqual([
      'More time outside',
      'Quiet evenings',
    ]);

    const bad = await draftNote(aiDeps(fs, key, owner, 'not json at all'), {
      recipientPersonId: her,
      type: 'question',
      intent: 'x',
    });
    expect(bad.ok).toBe(false);
  });
});

describe('notes — the recipient surfaces (76 §3.6)', () => {
  it('appears in the recipient’s Inbox with NO sender, and only counts when there is something to answer', async () => {
    registerBuiltInInboxProviders();
    const { fs, key, owner, her } = await seed();

    await createNote(
      fs,
      key,
      owner,
      {
        recipientPersonId: her,
        type: 'announcement',
        subject: 'Covers are here',
        body: 'Your books can have covers now.\nSecond line that must not leak into the queue.',
        answers: [],
        drafted: 'ai',
      },
      NOW,
    );
    await createNote(
      fs,
      key,
      owner,
      {
        recipientPersonId: her,
        type: 'question',
        subject: 'One thing you’d want more of?',
        body: 'No wrong answer.',
        answers: [
          { label: 'Time outside', stance: 'other' },
          { label: 'Quiet evenings', stance: 'other' },
        ],
        drafted: 'ai',
      },
      NOW,
    );

    const entries = (await collectInbox({ fs, key, personId: her, now: NOW, readAt: {} })).filter(
      (e) => e.kind === 'note',
    );
    expect(entries).toHaveLength(2);

    // No attribution anywhere — a note reads as the app, on both surfaces.
    expect(entries.every((e) => e.fromName === undefined)).toBe(true);
    // Announce, never preview: the first line only.
    expect(entries.some((e) => e.detail?.includes('must not leak'))).toBe(false);
    // The badge means "something needs you" — an announcement does not.
    expect(entries.find((e) => e.title === 'Covers are here')?.waiting).toBe(false);
    expect(entries.find((e) => e.title?.startsWith('One thing'))?.waiting).toBe(true);
  });

  it('the email carries no signature, no greeting and no sender', () => {
    const mail = buildNoteEmail({
      recipientName: 'Angel',
      subject: 'Something for those late nights',
      body: 'You’ve written most nights this month.',
      answers: [{ label: 'I’m game', url: 'https://relay.example/t/abc' }],
    });

    expect(mail.subject).toBe('Something for those late nights');
    // No "Hi <name>" opener, and nothing that reads as a person signing off.
    expect(mail.html).not.toContain('Hi Angel');
    expect(mail.text).not.toContain('Hi Angel');
    expect(mail.text).not.toMatch(/^—\s/m);
    expect(mail.html).toContain('https://relay.example/t/abc');
    // The standing not-medical line is untouched by any of this.
    expect(mail.text).toContain('wellness');
  });

  it('an email with no tap buttons still closes with a way in, rather than dead-ending', () => {
    const mail = buildNoteEmail({
      subject: 'Covers are here',
      body: 'Your books can have covers.',
    });
    expect(mail.text).toContain('Open SelfOS');
    expect(mail.html).toContain('Open SelfOS');
  });
});

describe('answering a note (76 §3.5)', () => {
  it('records ONE answer under the author whichever surface it came from, and replaces it on a change', async () => {
    const { fs, key, owner } = await seed();
    const note = await createNote(
      fs,
      key,
      owner,
      {
        recipientPersonId: 'her',
        type: 'question',
        subject: 'A question',
        body: 'Body.',
        answers: [
          { label: 'Yes', stance: 'yes' },
          { label: 'Not now', stance: 'no' },
        ],
        drafted: 'ai',
      },
      NOW,
    );

    // In-app first.
    await recordNoteAnswer(
      fs,
      key,
      owner,
      { noteId: note.id, answer: 'Yes', stance: 'yes', source: 'in-app' },
      NOW,
    );
    let responses = await listEmailResponses(fs, key, owner);
    expect(responses).toHaveLength(1);
    expect(noteAnswerOf(responses, note.id)?.answer).toBe('Yes');
    expect(noteAnswerOf(responses, note.id)?.source).toBe('in-app');

    // Then a change of mind — REPLACES rather than appends, so the author reads one answer, not a log.
    await recordNoteAnswer(
      fs,
      key,
      owner,
      { noteId: note.id, answer: 'Not now', stance: 'no', source: 'in-app' },
      new Date('2026-08-21T13:00:00.000Z'),
    );
    responses = await listEmailResponses(fs, key, owner);
    expect(responses).toHaveLength(1);
    expect(noteAnswerOf(responses, note.id)?.answer).toBe('Not now');
    expect(noteAnswerOf(responses, note.id)?.stance).toBe('no');

    // A different note is untouched by either.
    expect(noteAnswerOf(responses, 'some-other-note')).toBeNull();
  });

  it('an emailed tap drains into the SAME record shape, carrying the note id', async () => {
    const { fs, key, owner } = await seed();
    await mintEmailToken(fs, key, owner, {
      token: 'tok-1',
      schemaVersion: 1,
      interactionId: 'int-1',
      family: 'note',
      noteId: 'note-7',
      kind: 'note-answer',
      answer: 'I’m in',
      stance: 'yes',
      mintedAt: NOW.toISOString(),
    });

    const drained = await drainEmailTaps(
      fs,
      key,
      owner,
      { drainTaps: async () => [{ token: 'tok-1', at: NOW.toISOString() }] },
      NOW,
    );

    expect(drained).toHaveLength(1);
    // The note id has to survive the drain, or the answer belongs to nothing.
    expect(drained[0]?.noteId).toBe('note-7');
    expect(drained[0]?.kind).toBe('note-answer');
    expect(drained[0]?.stance).toBe('yes');
    expect(noteAnswerOf(await listEmailResponses(fs, key, owner), 'note-7')?.answer).toBe('I’m in');
  });

  it('renders the answers as buttons in the email, and only when there are taps to mint', async () => {
    const withTaps = buildNoteEmail({
      subject: 'A question',
      body: 'Body.',
      answers: [{ label: 'Yes', url: 'https://relay.example/t/abc' }],
    });
    expect(withTaps.html).toContain('https://relay.example/t/abc');
    expect(withTaps.text).toContain('Yes: https://relay.example/t/abc');
    // With buttons the "open the app" closer would be redundant.
    expect(withTaps.text).not.toContain('Open SelfOS to see it.');

    // Without a relay there is nothing to mint, so it must not dead-end.
    const without = buildNoteEmail({ subject: 'A question', body: 'Body.' });
    expect(without.text).toContain('Open SelfOS to see it.');
  });
});

describe('reading notes is resilient (76 §5.3)', () => {
  it('a corrupt note does not take down the whole list', async () => {
    const { fs, key, owner } = await seed();
    await createNote(
      fs,
      key,
      owner,
      {
        recipientPersonId: 'her',
        type: 'announcement',
        subject: 'Good one',
        body: 'Body.',
        answers: [],
        drafted: 'self',
      },
      NOW,
    );
    // Not an envelope at all — `readEncryptedJson` THROWS on this, which used to blank the surface.
    await fs.writeAtomic(
      `people/${owner}/notes/broken.enc`,
      new TextEncoder().encode('not-an-envelope'),
    );

    const notes = await listNotesByAuthor(fs, key, owner);
    expect(notes.map((n) => n.subject)).toEqual(['Good one']);
  });

  it('refuses a crafted recipient id WITHOUT attempting a read', async () => {
    const { fs, key } = await seed();
    // The assertion has to be that no read is ATTEMPTED. An in-memory FS treats a path as an opaque
    // string, so it can never reproduce the traversal itself — the node host's `join` is what normalizes
    // `..`. Spying on the reads is the only thing that distinguishes "refused" from "happened to miss".
    const reads: string[] = [];
    const spy: FileSystem = { ...fs, read: (path) => (reads.push(path), fs.read(path)) };

    const ctx = await buildNoteContext(spy, key, '../../config');
    expect(ctx.digest).toBe('');
    expect(ctx.recipientName).toBe('them');
    expect(reads).toEqual([]);

    // A legitimate id still reads, so the guard isn't refusing everything.
    const { her } = await seed();
    reads.length = 0;
    await buildNoteContext(spy, key, her);
    expect(reads.length).toBeGreaterThan(0);
  });
});

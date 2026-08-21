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

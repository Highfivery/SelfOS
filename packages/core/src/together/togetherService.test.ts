import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { FileSystem } from '../host';
import type { ParticipantState, TogetherMessage, TogetherSession } from '../schemas';
import {
  appendMessage,
  createSession,
  deriveStatusFor,
  digestFor,
  getSession,
  isInvitationExpired,
  isPendingInvite,
  listMessages,
  listSessionsForPerson,
  listStates,
  pairKeyFor,
  projectMessages,
  reapTogetherForPerson,
  removeMessagesFrom,
  awaitingTogetherReply,
  turnStateFor,
  unreadCountFor,
  updateState,
  withdrawSession,
} from './togetherService';
import { saveAgreement } from './agreementService';

const key = generateMasterKey();
const NOW = new Date('2026-07-10T12:00:00.000Z');
const A = 'personA';
const B = 'personB';

function state(personId: string, patch: Partial<ParticipantState> = {}): ParticipantState {
  return { schemaVersion: 1, personId, updatedAt: NOW.toISOString(), ...patch };
}

function msg(
  author: string,
  role: 'user' | 'assistant',
  ts: string,
  patch: Partial<TogetherMessage> = {},
): TogetherMessage {
  return {
    id: `${author}-${ts}`,
    schemaVersion: 1,
    authorPersonId: author,
    role,
    content: `${role} from ${author}`,
    ts,
    ...patch,
  };
}

function session(patch: Partial<TogetherSession> = {}): TogetherSession {
  return {
    id: 's1',
    schemaVersion: 1,
    pairKey: pairKeyFor(A, B),
    participantIds: [A, B],
    initiatorPersonId: A,
    createdAt: NOW.toISOString(),
    ...patch,
  };
}

function states(...entries: ParticipantState[]): Map<string, ParticipantState> {
  return new Map(entries.map((s) => [s.personId, s]));
}

describe('pairKeyFor', () => {
  it('is order-independent + stable', () => {
    expect(pairKeyFor(A, B)).toBe(pairKeyFor(B, A));
    expect(pairKeyFor(A, B)).toBe('personA~personB');
  });
});

describe('deriveStatusFor (§4.3 truth table)', () => {
  const acked = () =>
    states(
      state(A, { rulesAckAt: NOW.toISOString() }),
      state(B, { rulesAckAt: NOW.toISOString() }),
    );

  it('invited: partner un-acked; initiator acked at create', () => {
    const st = states(state(A, { rulesAckAt: NOW.toISOString() })); // only the initiator
    expect(deriveStatusFor(session(), st, null, [], A, NOW)).toBe('invited');
    expect(deriveStatusFor(session(), st, null, [], B, NOW)).toBe('invited');
  });

  it('expired: invited + older than 30 days', () => {
    const s = session({ createdAt: '2026-01-01T00:00:00.000Z' });
    const st = states(state(A, { rulesAckAt: s.createdAt }));
    expect(deriveStatusFor(s, st, null, [], A, NOW)).toBe('expired');
  });

  it('active: both acked, no report', () => {
    expect(deriveStatusFor(session(), acked(), null, [], A, NOW)).toBe('active');
  });

  it('complete: both acked, report newer than the newest shared human message', () => {
    const messages = [msg(A, 'user', '2026-07-01T00:00:00.000Z')];
    const reportAt = '2026-07-02T00:00:00.000Z';
    expect(deriveStatusFor(session(), acked(), reportAt, messages, A, NOW)).toBe('complete');
  });

  it('stale → active: a human message newer than the report un-completes it', () => {
    const messages = [msg(A, 'user', '2026-07-03T00:00:00.000Z')];
    const reportAt = '2026-07-02T00:00:00.000Z';
    expect(deriveStatusFor(session(), acked(), reportAt, messages, A, NOW)).toBe('active');
  });

  it('an ASIDE after wrap-up does NOT un-complete (staleness uses shared human messages only)', () => {
    const messages = [msg(A, 'user', '2026-07-03T00:00:00.000Z', { privateAside: true })];
    const reportAt = '2026-07-02T00:00:00.000Z';
    // Consistent for BOTH viewers — the report is shared.
    expect(deriveStatusFor(session(), acked(), reportAt, messages, A, NOW)).toBe('complete');
    expect(deriveStatusFor(session(), acked(), reportAt, messages, B, NOW)).toBe('complete');
  });

  it('onHold: shows only in the pauser’s own view', () => {
    const st = states(
      state(A, { rulesAckAt: NOW.toISOString(), pausedAt: NOW.toISOString() }),
      state(B, { rulesAckAt: NOW.toISOString() }),
    );
    expect(deriveStatusFor(session(), st, null, [], A, NOW)).toBe('onHold');
    expect(deriveStatusFor(session(), st, null, [], B, NOW)).toBe('active'); // partner unaffected (§8.3)
  });

  it('ended: any participant’s leftAt ends it for everyone, neutrally', () => {
    const st = states(
      state(A, { rulesAckAt: NOW.toISOString() }),
      state(B, { rulesAckAt: NOW.toISOString(), leftAt: NOW.toISOString() }),
    );
    expect(deriveStatusFor(session(), st, null, [], A, NOW)).toBe('ended');
    expect(deriveStatusFor(session(), st, null, [], B, NOW)).toBe('ended');
  });

  it('declined: honored ONLY in the decliner’s projection; foreign declinedAt is ignored', () => {
    const st = states(
      state(A, { rulesAckAt: NOW.toISOString() }),
      state(B, { declinedAt: NOW.toISOString() }),
    );
    // The decliner (B) sees it declined; the initiator (A) sees invited (never "declined") — §3.5.
    expect(deriveStatusFor(session(), st, null, [], B, NOW)).toBe('declined');
    expect(deriveStatusFor(session(), st, null, [], A, NOW)).toBe('invited');
  });
});

describe('projectMessages (§5.2)', () => {
  it('hides a private aside (and its coach reply) from the partner, keeps it for the author', () => {
    const messages = [
      msg(A, 'user', '1', { id: 'm1' }),
      msg(A, 'user', '2', { id: 'aside', privateAside: true }),
      msg(A, 'assistant', '3', {
        id: 'aside-reply',
        privateAside: true,
        replyToMessageId: 'aside',
      }),
      msg(B, 'user', '4', { id: 'm4' }),
    ];
    const forA = projectMessages(messages, A).map((m) => m.id);
    const forB = projectMessages(messages, B).map((m) => m.id);
    expect(forA).toEqual(['m1', 'aside', 'aside-reply', 'm4']);
    expect(forB).toEqual(['m1', 'm4']); // no aside, no aside-reply, no placeholder
  });

  it('strips a replyToMessageId whose target is not in the projection', () => {
    const messages = [
      msg(A, 'user', '1', { id: 'aside', privateAside: true }),
      // A (hypothetical) non-aside coach reply pointing at an aside must not dangle for B.
      msg(A, 'assistant', '2', { id: 'reply', replyToMessageId: 'aside' }),
    ];
    const forB = projectMessages(messages, B);
    expect(forB.map((m) => m.id)).toEqual(['reply']);
    expect(forB[0]?.replyToMessageId).toBeUndefined();
  });
});

describe('removeMessagesFrom — the tombstone (66 §3.3/§8.3)', () => {
  const fs = () => memFileSystem();

  async function seed(messages: TogetherMessage[]): Promise<ReturnType<typeof memFileSystem>> {
    const f = fs();
    for (const m of messages) await appendMessage(f, key, 'S1', m);
    return f;
  }

  it('deletes the span and leaves ONE tombstone standing in its place', async () => {
    const f = await seed([
      msg(A, 'user', '1'),
      msg('coach', 'assistant', '2'),
      msg(B, 'user', '3'),
    ]);

    const result = await removeMessagesFrom(f, key, 'S1', A, `${'coach'}-2`);
    expect(result).toEqual({ ok: true, removed: 2 });

    const after = projectMessages(await listMessages(f, key, 'S1'), A);
    expect(after.map((m) => m.id)).toEqual([`${A}-1`, expect.any(String)]);
    const stone = after[1]!;
    expect(stone.redacted).toBe(true);
    expect(stone.redactedCount).toBe(2);
    expect(stone.redactedByPersonId).toBe(A);
    // The content is genuinely gone — a "delete" that leaves the text on disk isn't one.
    expect(JSON.stringify(after)).not.toContain('user from ' + B);
  });

  it('shows the same tombstone to BOTH partners — the shared record never silently changes shape', async () => {
    const f = await seed([msg(A, 'user', '1'), msg(B, 'user', '2')]);
    await removeMessagesFrom(f, key, 'S1', A, `${B}-2`);

    const stored = await listMessages(f, key, 'S1');
    for (const viewer of [A, B]) {
      const projected = projectMessages(stored, viewer);
      expect(projected.some((m) => m.redacted)).toBe(true);
    }
  });

  it('cannot remove a message the remover cannot see', async () => {
    // B's private aside is invisible to A, so A can't target it even by id.
    const f = await seed([msg(B, 'user', '1', { id: 'secret', privateAside: true })]);
    expect(await removeMessagesFrom(f, key, 'S1', A, 'secret')).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
    expect(await listMessages(f, key, 'S1')).toHaveLength(1); // untouched
  });

  it('keeps an aside-only removal PRIVATE — the tombstone must not leak that asides exist', async () => {
    // If A removes only their own asides, B must not see "A removed 1 message" for an exchange they
    // never knew about.
    const f = await seed([
      msg(B, 'user', '1'),
      msg(A, 'user', '2', { id: 'mine', privateAside: true }),
    ]);
    await removeMessagesFrom(f, key, 'S1', A, 'mine');

    const stored = await listMessages(f, key, 'S1');
    expect(projectMessages(stored, A).some((m) => m.redacted)).toBe(true);
    expect(projectMessages(stored, B).some((m) => m.redacted)).toBe(false);
  });

  it('splits a MIXED span into a shared tombstone and a private one', async () => {
    const f = await seed([
      msg(A, 'user', '1'),
      msg(A, 'user', '2', { id: 'aside', privateAside: true }),
      msg(A, 'user', '3'),
    ]);
    await removeMessagesFrom(f, key, 'S1', A, `${A}-1`);

    const stored = await listMessages(f, key, 'S1');
    // A sees both; B sees only the shared one, counting only what they could have seen.
    expect(projectMessages(stored, A).filter((m) => m.redacted)).toHaveLength(2);
    const forB = projectMessages(stored, B).filter((m) => m.redacted);
    expect(forB).toHaveLength(1);
    expect(forB[0]?.redactedCount).toBe(2);
  });

  it('a tombstone disturbs no derived signal', async () => {
    // The whole correctness surface in one place: it must not flip the turn, count as unread, or
    // become the sessions-list preview.
    const f = await seed([
      msg(A, 'user', '1'),
      msg('coach', 'assistant', '2'),
      msg(B, 'user', '3'),
    ]);
    await removeMessagesFrom(f, key, 'S1', A, `${B}-3`);
    const stored = await listMessages(f, key, 'S1');

    // B wrote last, but that message is gone — so it is no longer A's turn.
    expect(turnStateFor(stored, A)).toBe(false);
    expect(unreadCountFor(stored, A, undefined)).toBe(1); // the coach reply only, not the tombstone
    expect(awaitingTogetherReply(stored, A)).toBe(false); // an empty placeholder isn't an unanswered turn
  });
});

describe('awaitingTogetherReply (66 §3.2)', () => {
  it('is true when the coach still owes a reply, false once it has answered', () => {
    // Together used to gate "Try again" on transient `error` state only, so a session reopened after an
    // unanswered turn dead-ended. Deriving it from the transcript is what fixes that.
    const unanswered = [msg(A, 'user', '1'), msg('coach', 'assistant', '2'), msg(B, 'user', '3')];
    expect(awaitingTogetherReply(unanswered, A)).toBe(true);

    const answered = [...unanswered, msg('coach', 'assistant', '4')];
    expect(awaitingTogetherReply(answered, A)).toBe(false);
  });

  it('ignores a trailing blank ghost reply left by older code', () => {
    const withGhost = [msg(A, 'user', '1'), msg('coach', 'assistant', '2', { content: '  ' })];
    expect(awaitingTogetherReply(withGhost, A)).toBe(true);
  });

  it('is viewer-projected — a partner’s private aside never makes it look answered', () => {
    // B must not see A's aside at all, so it can't affect whether B is owed a reply.
    const messages = [msg(B, 'user', '1'), msg(A, 'user', '2', { id: 'x', privateAside: true })];
    expect(awaitingTogetherReply(messages, B)).toBe(true);
  });
});

describe('turnStateFor + unreadCountFor', () => {
  const messages = [msg(A, 'user', '1'), msg('coach', 'assistant', '2'), msg(B, 'user', '3')];

  it("it's your turn when the newest human message isn't yours", () => {
    expect(turnStateFor(messages, A)).toBe(true); // B wrote last
    expect(turnStateFor(messages, B)).toBe(false);
  });

  it("an aside by A never flips B's turn or unread (projection-derived §3.6)", () => {
    const withAside = [...messages, msg(A, 'user', '4', { id: 'x', privateAside: true })];
    expect(turnStateFor(withAside, B)).toBe(false); // still B's own last shared msg
    expect(unreadCountFor(withAside, B, undefined)).toBe(unreadCountFor(messages, B, undefined));
  });

  it('unread counts others’ messages (incl. the coach) newer than lastRead only', () => {
    expect(unreadCountFor(messages, A, undefined)).toBe(2); // the coach reply + B's message
    expect(unreadCountFor(messages, A, '2')).toBe(1); // only B's message is newer than '2'
    expect(unreadCountFor(messages, A, '3')).toBe(0);
    expect(unreadCountFor(messages, B, undefined)).toBe(2); // A's message + the coach reply
  });
});

describe('isInvitationExpired', () => {
  it('true past 30 days, false within', () => {
    expect(isInvitationExpired('2026-01-01T00:00:00.000Z', NOW)).toBe(true);
    expect(isInvitationExpired('2026-07-01T00:00:00.000Z', NOW)).toBe(false);
    expect(isInvitationExpired('not-a-date', NOW)).toBe(false);
  });
});

describe('storage round-trips + corrupt-file tolerance (§7)', () => {
  async function makeFs(): Promise<FileSystem> {
    return memFileSystem();
  }

  it('createSession seeds the initiator ack + derives invited until the partner acks', async () => {
    const fs = await makeFs();
    const s = await createSession(fs, key, { initiatorPersonId: A, participantIds: [A, B] }, NOW);
    expect((await getSession(fs, key, s.id))?.initiatorPersonId).toBe(A);
    const st = await listStates(fs, key, s.id);
    expect(st.get(A)?.rulesAckAt).toBeTruthy();
    expect(st.get(B)).toBeUndefined();
    expect(deriveStatusFor(s, st, null, [], A, NOW)).toBe('invited');
    expect(await listSessionsForPerson(fs, key, A)).toHaveLength(1);
    expect(await listSessionsForPerson(fs, key, 'stranger')).toHaveLength(0);
  });

  it('reapTogetherForPerson removes the deleted person’s session folders + pair agreements, leaving others', async () => {
    const fs = await makeFs();
    // A~B share a session + an agreement; C~D share a separate session (must survive B's deletion).
    const ab = await createSession(fs, key, { initiatorPersonId: A, participantIds: [A, B] }, NOW);
    const cd = await createSession(
      fs,
      key,
      { initiatorPersonId: 'personC', participantIds: ['personC', 'personD'] },
      NOW,
    );
    await saveAgreement(
      fs,
      key,
      A,
      B,
      { text: 'weekly date night', status: 'standing', sessionId: ab.id },
      NOW,
    );
    expect(await getSession(fs, key, ab.id)).toBeTruthy();

    await reapTogetherForPerson(fs, key, B);

    // B's session + the A~B agreements dir are gone; C~D's session is untouched.
    expect(await getSession(fs, key, ab.id)).toBeNull();
    expect(await fs.list(`together/pairs/${pairKeyFor(A, B)}`)).toHaveLength(0);
    expect(await getSession(fs, key, cd.id)).toBeTruthy();
    expect(await listSessionsForPerson(fs, key, A)).toHaveLength(0);
  });

  it('withdrawSession: the initiator undoes a pending invite (deletes for both); non-initiator is refused', async () => {
    const fs = await makeFs();
    const s = await createSession(fs, key, { initiatorPersonId: A, participantIds: [A, B] }, NOW);
    // Only the initiator (A) has acked → still a pending invite.
    expect(isPendingInvite(s, await listStates(fs, key, s.id))).toBe(true);
    // The recipient (B) can't withdraw A's invite.
    expect(await withdrawSession(fs, key, s.id, B)).toEqual({ ok: false, reason: 'NOT_INITIATOR' });
    expect(await getSession(fs, key, s.id)).toBeTruthy();
    // A withdraws → the shared session is gone for BOTH.
    expect(await withdrawSession(fs, key, s.id, A)).toEqual({ ok: true });
    expect(await getSession(fs, key, s.id)).toBeNull();
    expect(await listSessionsForPerson(fs, key, A)).toHaveLength(0);
    expect(await listSessionsForPerson(fs, key, B)).toHaveLength(0);
  });

  it('withdrawSession: refused once the recipient ACCEPTED; a quiet DECLINE is still withdrawable', async () => {
    const fs = await makeFs();
    // Accepted → no longer a pending invite → refused, session untouched.
    const accepted = await createSession(
      fs,
      key,
      { initiatorPersonId: A, participantIds: [A, B] },
      NOW,
    );
    await updateState(fs, key, accepted.id, B, { rulesAckAt: NOW.toISOString() }, NOW);
    expect(isPendingInvite(accepted, await listStates(fs, key, accepted.id))).toBe(false);
    expect(await withdrawSession(fs, key, accepted.id, A)).toEqual({
      ok: false,
      reason: 'ALREADY_ACCEPTED',
    });
    expect(await getSession(fs, key, accepted.id)).toBeTruthy();

    // Quietly declined (B set declinedAt, never acked) → still pending → the initiator can clean it up.
    const declined = await createSession(
      fs,
      key,
      { initiatorPersonId: A, participantIds: [A, B] },
      NOW,
    );
    await updateState(fs, key, declined.id, B, { declinedAt: NOW.toISOString() }, NOW);
    expect(isPendingInvite(declined, await listStates(fs, key, declined.id))).toBe(true);
    expect(await withdrawSession(fs, key, declined.id, A)).toEqual({ ok: true });
    expect(await getSession(fs, key, declined.id)).toBeNull();

    // A missing session → NOT_FOUND (never throws).
    expect(await withdrawSession(fs, key, 'nope', A)).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('updateState is one-writer read-modify-write', async () => {
    const fs = await makeFs();
    const s = await createSession(fs, key, { initiatorPersonId: A, participantIds: [A, B] }, NOW);
    await updateState(fs, key, s.id, B, { rulesAckAt: NOW.toISOString() }, NOW);
    await updateState(fs, key, s.id, B, { lastReadMessageAt: '3' }, NOW);
    const st = await listStates(fs, key, s.id);
    expect(st.get(B)?.rulesAckAt).toBeTruthy(); // preserved across the second write
    expect(st.get(B)?.lastReadMessageAt).toBe('3');
  });

  it('appendMessage is write-once + ordered by ts', async () => {
    const fs = await makeFs();
    const s = await createSession(fs, key, { initiatorPersonId: A, participantIds: [A, B] }, NOW);
    await appendMessage(fs, key, s.id, msg(A, 'user', '2026-07-10T00:00:02.000Z'));
    await appendMessage(fs, key, s.id, msg(B, 'user', '2026-07-10T00:00:01.000Z'));
    const messages = await listMessages(fs, key, s.id);
    expect(messages.map((m) => m.ts)).toEqual([
      '2026-07-10T00:00:01.000Z',
      '2026-07-10T00:00:02.000Z',
    ]);
  });

  it('a corrupt STATE file ⇒ that person is treated as not consented (fail-closed)', async () => {
    const fs = await makeFs();
    const s = await createSession(fs, key, { initiatorPersonId: A, participantIds: [A, B] }, NOW);
    await updateState(fs, key, s.id, B, { rulesAckAt: NOW.toISOString() }, NOW);
    // Corrupt B's state file → B reads as having no state → not acked → invited (never a silent grant).
    await fs.writeAtomic(
      `together/sessions/${s.id}/state/${B}.enc`,
      new TextEncoder().encode('not-encrypted'),
    );
    const st = await listStates(fs, key, s.id);
    expect(st.get(B)).toBeUndefined();
    expect(deriveStatusFor(s, st, null, [], A, NOW)).toBe('invited');
  });

  it('a corrupt MESSAGE file is skipped, not fatal', async () => {
    const fs = await makeFs();
    const s = await createSession(fs, key, { initiatorPersonId: A, participantIds: [A, B] }, NOW);
    await appendMessage(fs, key, s.id, msg(A, 'user', '2026-07-10T00:00:01.000Z'));
    await fs.writeAtomic(
      `together/sessions/${s.id}/messages/999-x-bad.enc`,
      new TextEncoder().encode('corrupt'),
    );
    expect(await listMessages(fs, key, s.id)).toHaveLength(1);
  });
});

describe('digestFor', () => {
  it('assembles status + turn + unread + snippet over the viewer projection', async () => {
    const messages = [
      msg(A, 'user', '1', { content: 'hello world' }),
      msg(B, 'user', '2', { content: 'hi back' }),
    ];
    const st = states(
      state(A, { rulesAckAt: NOW.toISOString() }),
      state(B, { rulesAckAt: NOW.toISOString() }),
    );
    const digest = digestFor(session(), st, null, messages, A, NOW);
    expect(digest).toMatchObject({
      status: 'active',
      yourTurn: true,
      unreadCount: 1,
      viewerAcked: true,
      lastMessageSnippet: 'hi back',
      lastMessageAt: '2',
    });
  });

  it('sets lastPrivateCoachAt ONLY for a coach-INITIATED note to the viewer — never for an ordinary aside coach reply (§3.14 Part B)', async () => {
    const st = states(
      state(A, { rulesAckAt: NOW.toISOString() }),
      state(B, { rulesAckAt: NOW.toISOString() }),
    );
    // A's OWN private aside + the coach's aside REPLY (both authored-for A, privateAside, NOT coachInitiated).
    const asideOnly = [
      msg(A, 'user', '1', { privateAside: true }),
      msg(A, 'assistant', '2', { privateAside: true, replyToMessageId: 'personA-1' }),
    ];
    expect(digestFor(session(), st, null, asideOnly, A, NOW).lastPrivateCoachAt).toBeUndefined();

    // Now a coach-INITIATED note for A (authored-for A, privateAside, coachInitiated) → the signal fires.
    const withNote = [
      msg(B, 'user', '1', { content: 'open message' }),
      msg(B, 'assistant', '2', { content: 'shared reply' }),
      msg(A, 'assistant', '3', { privateAside: true, coachInitiated: true }),
    ];
    expect(digestFor(session(), st, null, withNote, A, NOW).lastPrivateCoachAt).toBe('3');
    // …but NOT for B — the note is authored for A, so it's outside B's projection + scoped away.
    expect(digestFor(session(), st, null, withNote, B, NOW).lastPrivateCoachAt).toBeUndefined();
  });
});

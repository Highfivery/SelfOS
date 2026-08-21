import { getPerson, listPeople } from '../people/peopleService';
import { listNotesForRecipient } from '../notes/noteStore';
import { listMyInvitations } from '../books/contributions';
import { listSharedBooks } from '../books/storyPublish';
import { deriveStatusFor, listSessionsForPerson, listStates } from '../together/togetherService';
import { registerInboxProvider, type InboxEntry, type InboxProvider } from './registry';

/**
 * The built-in Inbox providers other than check-ins (08 §35.2). Check-ins stay in the bridge: they are the
 * one kind answered IN the Inbox, so they carry the whole `InboxItem` the answering pane needs rather than
 * the queue's slim `InboxEntry`.
 *
 * Every provider here obeys the same two rules, and each is enforced by the shape it returns, not by the
 * caller remembering:
 *   1. **Navigate, never act.** An entry carries an `openPath` and nothing else. The surface it opens keeps
 *      its own gates, framing and consent step.
 *   2. **Announce, never preview.** Names and titles only where the person is already cleared to see them —
 *      never message content, and never a book title they have not been shown.
 */

/**
 * A Together invitation waiting for the person (58 §3.4).
 *
 * `invited` is derived, not stored: it means not every participant has a `rulesAckAt`. The initiator's own is
 * seeded at create ("starting IS consenting"), so a fresh session reads `invited` for both people — hence the
 * `initiatorPersonId !== personId` clause, without which the initiator would see their own invitation queued.
 *
 * The entry carries the topic and NO message text. That is the rule every other surface follows (the
 * notification header states it outright) and it is load-bearing here: an invitation can already hold the
 * initiator's opening message and a coach reply before it is accepted, and the invitation screen itself shows
 * only the topic. `openPath` goes to the session, which returns the ceremony — the rules of the room, the
 * "Not right now" and the "Decline quietly" that exists for someone who cannot say no directly.
 */
const togetherInvitations: InboxProvider = {
  kind: 'together-invitation',
  list: async ({ fs, key, personId, now }) => {
    const sessions = await listSessionsForPerson(fs, key, personId);
    const out: InboxEntry[] = [];
    for (const session of sessions) {
      if (session.initiatorPersonId === personId) continue;
      const states = await listStates(fs, key, session.id);
      const status = deriveStatusFor(session, states, null, [], personId, now);
      if (status !== 'invited') continue;
      const from = await getPerson(fs, key, session.initiatorPersonId);
      out.push({
        id: `together-invitation:${session.id}`,
        kind: 'together-invitation',
        title: session.topic?.trim() || 'A session together',
        ...(from?.displayName ? { fromName: from.displayName } : {}),
        detail: 'Invited you to a session',
        at: session.createdAt,
        openPath: `/together/session/${session.id}`,
        // Deciding is the whole point of opening it — there is no "put this off" that isn't already
        // "Not right now" on the invitation screen itself.
        dismissible: false,
        waiting: true,
      });
    }
    return out;
  },
};

/**
 * An invitation to add to someone's book (73 §8.2).
 *
 * **No book title, ever.** Not a policy this code applies — a property of the data it is given:
 * `ContributionInviteView` has no `title` field, because nothing may tell a person a book exists unless its
 * author told them. The entry names the author and, where they wrote one, their note — which is the thing
 * they actually asked.
 *
 * There is no accept or decline here: the invitation is a standing grant, not a proposal. You add something
 * or you don't, so this one IS dismissible — otherwise an invitation you have no plans to answer sits in
 * your queue forever with no honest way to clear it.
 */
const contributionInvitations: InboxProvider = {
  kind: 'contribution-invitation',
  list: async ({ fs, key, personId }) => {
    const invitations = await listMyInvitations(fs, key, personId);
    return invitations.map((invite) => ({
      id: `contribution-invitation:${invite.id}`,
      kind: 'contribution-invitation' as const,
      title: `${invite.authorName} asked you to add to their book`,
      fromName: invite.authorName,
      ...(invite.note?.trim() ? { detail: invite.note.trim() } : {}),
      at: invite.invitedAt,
      openPath: `/contribute/${invite.id}`,
      dismissible: true,
      waiting: true,
    }));
  },
};

/**
 * A book someone shared with you that you have not read yet (64 §3.5).
 *
 * Queue-shaped, so it appears when it is new to you or the author has published since you last opened it, and
 * leaves once you have read the current version (owner, 2026-08-20). A permanent list of books you have
 * already read is a library, not an inbox.
 *
 * The title is shown here and only here among the book kinds, because being shared a book IS being told it
 * exists — the opposite of a contribution invitation.
 *
 * **This must never mark the book read.** `booksMarkSharedRead` writes a receipt the AUTHOR can see, with no
 * undo anywhere in the app, so "you opened my book" would become permanently true because the queue listed
 * it. Reading is the reader's act, recorded when they actually read.
 */
const sharedBooks: InboxProvider = {
  kind: 'shared-book',
  list: async ({ fs, key, personId, readAt }) => {
    const books = await listSharedBooks(fs, key, personId, readAt);
    return books
      .filter((b) => b.neverOpened || b.updated)
      .map((b) => ({
        id: `shared-book:${b.authorPersonId}:${b.bookId}`,
        kind: 'shared-book' as const,
        title: b.title,
        fromName: b.authorName,
        detail: b.neverOpened ? 'Shared their book with you' : 'Added something new',
        at: b.publishedAt,
        openPath: `/books/shared/${b.authorPersonId}/${b.bookId}`,
        dismissible: true,
        // Only new-or-updated books are listed at all, so every one of them is unread.
        waiting: true,
      }));
  },
};

/**
 * A note written for this person (76 §3.6).
 *
 * The note lives in the AUTHOR's folder, so this scans the household for notes addressed here — the same
 * shape as a contribution invitation, and legitimate for the same reason: the thing offered is not the
 * recipient's to hold.
 *
 * **No sender.** `fromName` is deliberately left unset. A note is unattributed on both surfaces — it
 * reads as something the app noticed — and setting it here would contradict the email, which carries no
 * signature. The queue names the thing, not who sent it.
 *
 * `waiting` is true only while the note carries something to answer. An announcement has nothing to tap,
 * so it is listed but never counted — the badge means "something needs you", which an announcement does
 * not.
 */
const notes: InboxProvider = {
  kind: 'note',
  list: async ({ fs, key, personId }) => {
    const authorIds = (await listPeople(fs, key)).map((p) => p.id);
    const mine = await listNotesForRecipient(fs, key, personId, authorIds);
    return mine.map((note) => ({
      id: `note:${note.id}`,
      kind: 'note' as const,
      title: note.subject,
      // The first line only — enough to recognise it, never the whole body (announce, never preview).
      detail: note.body.split(/\n/)[0]?.slice(0, 120) ?? '',
      at: note.createdAt,
      openPath: `/inbox/note/${note.authorPersonId}/${note.id}`,
      dismissible: true,
      waiting: note.answers.length > 0,
    }));
  },
};

export function registerBuiltInInboxProviders(): void {
  registerInboxProvider(togetherInvitations);
  registerInboxProvider(contributionInvitations);
  registerInboxProvider(sharedBooks);
  registerInboxProvider(notes);
}

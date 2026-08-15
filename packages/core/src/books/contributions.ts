import type { FileSystem } from '../host';
import { uuid } from '../id';
import { pathSegment } from '../pathSafety';
import { listPeople, listRelatedPeople } from '../people';
import {
  ContributionDecisionListSchema,
  ContributionInviteSchema,
  ContributionSchema,
  type Contribution,
  type ContributionDecision,
  type ContributionDecisionList,
  type ContributionInvite,
  type ContributionInviteView,
  type ContributionKind,
  type ContributionReview,
  type ContributionStatus,
  type ContributionView,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { getBook } from './storyService';

/**
 * Household contributions (73) — the people who were THERE adding to someone's book, without anyone else
 * writing that person's life for them.
 *
 * **The consent model is the file layout.** A contribution lives in the CONTRIBUTOR's vault space and the
 * author's accept/decline lives in the BOOK. Neither side ever writes the other's file, which is what lets
 * "the author decides what goes in" and "the contributor may take it back at any time" both be true without
 * two writers on one record (the 58 §4 one-writer rule). The resulting state is DERIVED from the pair
 * (`contributionStatus`) rather than stored twice, so the two can never disagree.
 *
 * **Contributing is invite-only and re-gated on every call** — a live invitation AND a live relationship
 * edge (the 72 §5.8 pattern: the edge is the standing grant, so losing it stops contribution immediately
 * with nothing to clean up). Nothing here ever discloses a book to someone who was not invited to it (§8.2).
 */

const CONTRIBUTIONS_DIR = 'story/contributions';

function invitesDir(authorId: string, bookId: string): string {
  return `people/${pathSegment(authorId)}/story/books/${pathSegment(bookId)}/contributionInvites`;
}
function invitePath(authorId: string, bookId: string, personId: string): string {
  return `${invitesDir(authorId, bookId)}/${pathSegment(personId)}.enc`;
}
function decisionsPath(authorId: string, bookId: string): string {
  return `people/${pathSegment(authorId)}/story/books/${pathSegment(bookId)}/contributionDecisions.enc`;
}
function contributionsDir(contributorId: string): string {
  return `people/${pathSegment(contributorId)}/${CONTRIBUTIONS_DIR}`;
}
function contributionPath(contributorId: string, id: string): string {
  return `${contributionsDir(contributorId)}/${pathSegment(id)}.enc`;
}

/** Whether these two are currently related at all — the standing grant behind every call here. */
async function related(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  otherId: string,
): Promise<boolean> {
  const people = await listRelatedPeople(fs, key, personId).catch(() => []);
  return people.some((p) => p.id === otherId);
}

// --- The author's side: invitations ------------------------------------------------------------------------

/** Invite one related person to contribute to one book. Re-inviting refreshes the note and un-revokes. */
export async function inviteContribution(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
  args: { bookId: string; personId: string; note?: string; now: Date },
): Promise<ContributionInvite | null> {
  if (args.personId === authorId) return null;
  if (!(await getBook(fs, key, authorId, args.bookId))) return null;
  if (!(await related(fs, key, authorId, args.personId))) return null;
  // Re-inviting someone reuses the existing id (and clears any revocation), so a link they already hold
  // keeps working rather than 404-ing after the author changes their mind twice.
  const existing = await readEncryptedJson(
    fs,
    invitePath(authorId, args.bookId, args.personId),
    key,
  )
    .then((raw) => (raw ? ContributionInviteSchema.safeParse(raw) : null))
    .catch(() => null);
  const invite: ContributionInvite = {
    schemaVersion: 1,
    id: existing?.success ? existing.data.id : uuid(),
    personId: args.personId,
    bookId: args.bookId,
    ...(args.note?.trim() ? { note: args.note.trim() } : {}),
    invitedAt: args.now.toISOString(),
  };
  await writeEncryptedJson(fs, invitePath(authorId, args.bookId, args.personId), invite, key);
  return invite;
}

/** Stop further contributions. Already-accepted material stays — it is the author's corpus by now (§7.2). */
export async function revokeContributionInvite(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
  args: { bookId: string; personId: string; now: Date },
): Promise<void> {
  const path = invitePath(authorId, args.bookId, args.personId);
  const raw = await readEncryptedJson(fs, path, key).catch(() => null);
  if (!raw) return;
  const invite = ContributionInviteSchema.parse(raw);
  await writeEncryptedJson(fs, path, { ...invite, revokedAt: args.now.toISOString() }, key);
}

export async function listContributionInvites(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
  bookId: string,
): Promise<ContributionInvite[]> {
  const out: ContributionInvite[] = [];
  for (const name of await fs.list(invitesDir(authorId, bookId)).catch(() => [])) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(fs, `${invitesDir(authorId, bookId)}/${name}`, key).catch(
      () => null,
    );
    const parsed = raw ? ContributionInviteSchema.safeParse(raw) : null;
    if (parsed?.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Is this person allowed to contribute to this book RIGHT NOW? A live, un-revoked invitation plus a live
 * relationship edge — re-checked on every submit, never trusted from the UI.
 */
async function liveInvite(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
  bookId: string,
  personId: string,
): Promise<ContributionInvite | null> {
  const raw = await readEncryptedJson(fs, invitePath(authorId, bookId, personId), key).catch(
    () => null,
  );
  const parsed = raw ? ContributionInviteSchema.safeParse(raw) : null;
  if (!parsed?.success || parsed.data.revokedAt) return null;
  return (await related(fs, key, personId, authorId)) ? parsed.data : null;
}

/** Every book this person is currently invited to contribute to — the contributor's own entry point. */
export async function listMyInvitations(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<ContributionInviteView[]> {
  const out: ContributionInviteView[] = [];
  for (const author of await listRelatedPeople(fs, key, personId).catch(() => [])) {
    // Only their own books can carry an invitation for us; a missing dir simply yields nothing.
    for (const bookId of await fs
      .list(`people/${pathSegment(author.id)}/story/books`)
      .catch(() => [])) {
      if (bookId.endsWith('.enc')) continue; // book ids are folders
      const invite = await liveInvite(fs, key, author.id, bookId, personId);
      if (!invite) continue;
      const book = await getBook(fs, key, author.id, bookId).catch(() => null);
      if (!book) continue;
      out.push({
        id: invite.id,
        bookId,
        authorPersonId: author.id,
        authorName: author.displayName,
        ...(invite.note ? { note: invite.note } : {}),
        // `correction` is only offered on a book they can actually read (§3.2).
        canRead: Boolean(book.publishedAt) && book.sharedWith.includes(personId),
      });
    }
  }
  return out;
}

// --- The contributor's side ---------------------------------------------------------------------------------

export async function submitContribution(
  fs: FileSystem,
  key: Uint8Array,
  contributorId: string,
  args: {
    authorPersonId: string;
    bookId: string;
    kind: ContributionKind;
    text: string;
    chapterId?: string;
    now: Date;
  },
): Promise<Contribution | null> {
  const invite = await liveInvite(fs, key, args.authorPersonId, args.bookId, contributorId);
  if (!invite) return null;
  const text = args.text.trim();
  if (!text) return null;
  // A correction is about something they READ, so it needs read access — refused here, not just hidden.
  if (args.kind === 'correction') {
    const book = await getBook(fs, key, args.authorPersonId, args.bookId).catch(() => null);
    if (!book?.publishedAt || !book.sharedWith.includes(contributorId)) return null;
  }
  const contribution: Contribution = {
    schemaVersion: 1,
    id: uuid(),
    toPersonId: args.authorPersonId,
    bookId: args.bookId,
    kind: args.kind,
    text,
    ...(args.chapterId ? { chapterId: args.chapterId } : {}),
    createdAt: args.now.toISOString(),
  };
  await writeEncryptedJson(fs, contributionPath(contributorId, contribution.id), contribution, key);
  return contribution;
}

/** Take it back — at any status. It leaves the corpus immediately; prose already written is not rewritten. */
export async function withdrawContribution(
  fs: FileSystem,
  key: Uint8Array,
  contributorId: string,
  args: { contributionId: string; now: Date },
): Promise<void> {
  const path = contributionPath(contributorId, args.contributionId);
  const raw = await readEncryptedJson(fs, path, key).catch(() => null);
  if (!raw) return;
  const parsed = ContributionSchema.safeParse(raw);
  if (!parsed.success) return;
  await writeEncryptedJson(fs, path, { ...parsed.data, withdrawnAt: args.now.toISOString() }, key);
}

async function listContributionsBy(
  fs: FileSystem,
  key: Uint8Array,
  contributorId: string,
): Promise<Contribution[]> {
  const out: Contribution[] = [];
  for (const name of await fs.list(contributionsDir(contributorId)).catch(() => [])) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(
      fs,
      `${contributionsDir(contributorId)}/${name}`,
      key,
    ).catch(() => null);
    const parsed = raw ? ContributionSchema.safeParse(raw) : null;
    if (parsed?.success) out.push(parsed.data);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// --- The author's side: decisions ----------------------------------------------------------------------------

export async function getContributionDecisions(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
  bookId: string,
): Promise<ContributionDecisionList> {
  const raw = await readEncryptedJson(fs, decisionsPath(authorId, bookId), key).catch(() => null);
  const parsed = raw ? ContributionDecisionListSchema.safeParse(raw) : null;
  return parsed?.success ? parsed.data : { schemaVersion: 1, decisions: [] };
}

/** The derived state (§4.3) — withdrawal wins over any decision, because taking it back is unconditional. */
export function contributionStatus(
  contribution: Contribution,
  decision: ContributionDecision | undefined,
): ContributionStatus {
  if (contribution.withdrawnAt) return 'withdrawn';
  return decision ? decision.status : 'pending';
}

/** What the contributor sees about their own offerings — status only, never the book (§6). */
export async function listMyContributions(
  fs: FileSystem,
  key: Uint8Array,
  contributorId: string,
): Promise<ContributionView[]> {
  const mine = await listContributionsBy(fs, key, contributorId);
  const byBook = new Map<string, ContributionDecisionList>();
  const out: ContributionView[] = [];
  for (const c of mine) {
    const cacheKey = `${c.toPersonId}/${c.bookId}`;
    let decisions = byBook.get(cacheKey);
    if (!decisions) {
      decisions = await getContributionDecisions(fs, key, c.toPersonId, c.bookId);
      byBook.set(cacheKey, decisions);
    }
    out.push({
      id: c.id,
      bookId: c.bookId,
      kind: c.kind,
      text: c.text,
      status: contributionStatus(
        c,
        decisions.decisions.find((d) => d.contributionId === c.id),
      ),
      createdAt: c.createdAt,
    });
  }
  return out;
}

/**
 * Everything sent to this author's book, for review. Reads each INVITED person's contributions — an
 * un-invited person's file is never even looked at. Note `listContributionInvites` does NOT filter revoked
 * invitations, deliberately: revoking stops NEW offerings (§7.2), but what someone already sent stays
 * reviewable, so the author isn't left with a decision they can no longer make.
 */
export async function listContributionsForBook(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
  bookId: string,
): Promise<ContributionReview[]> {
  const invites = await listContributionInvites(fs, key, authorId, bookId);
  if (invites.length === 0) return [];
  const decisions = await getContributionDecisions(fs, key, authorId, bookId);
  const names = new Map(
    (await listPeople(fs, key).catch(() => [])).map((p) => [p.id, p.displayName]),
  );
  const out: ContributionReview[] = [];
  for (const invite of invites) {
    for (const c of await listContributionsBy(fs, key, invite.personId)) {
      if (c.toPersonId !== authorId || c.bookId !== bookId) continue;
      if (c.withdrawnAt) continue; // withdrawn is gone from the author's view too
      const decision = decisions.decisions.find((d) => d.contributionId === c.id);
      out.push({
        id: c.id,
        contributorId: invite.personId,
        contributorName: names.get(invite.personId) ?? 'Someone',
        kind: c.kind,
        text: c.text,
        ...(c.chapterId ? { chapterId: c.chapterId } : {}),
        status: contributionStatus(c, decision),
        ...(decision ? { attributed: decision.attributed } : {}),
        createdAt: c.createdAt,
      });
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Accept or decline. Writes ONLY the author's decision file — never the contributor's record. */
export async function decideContribution(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
  args: {
    bookId: string;
    contributionId: string;
    status: 'accepted' | 'declined';
    attributed?: boolean;
    gapId?: string;
    now: Date;
  },
): Promise<ContributionReview[]> {
  const pending = await listContributionsForBook(fs, key, authorId, args.bookId);
  const target = pending.find((c) => c.id === args.contributionId);
  if (!target) return pending; // not ours to decide (or withdrawn) — no write
  const list = await getContributionDecisions(fs, key, authorId, args.bookId);
  const decision: ContributionDecision = {
    contributionId: args.contributionId,
    contributorId: target.contributorId,
    status: args.status,
    attributed: args.attributed ?? true,
    decidedAt: args.now.toISOString(),
    ...(args.gapId ? { gapId: args.gapId } : {}),
  };
  const decisions = [
    ...list.decisions.filter((d) => d.contributionId !== args.contributionId),
    decision,
  ];
  await writeEncryptedJson(
    fs,
    decisionsPath(authorId, args.bookId),
    { schemaVersion: 1, decisions },
    key,
  );
  return listContributionsForBook(fs, key, authorId, args.bookId);
}

/**
 * Stamp the gap an accepted `question` became (73 §3.4), so a later pass doesn't mint a second one for the
 * same question. Separate from `decideContribution` because the gap only exists after the interview state
 * has been written — the author accepts first, the gap is seeded from the free gaps read.
 */
export async function setContributionGapId(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
  bookId: string,
  contributionId: string,
  gapId: string,
): Promise<void> {
  const list = await getContributionDecisions(fs, key, authorId, bookId);
  const decisions = list.decisions.map((d) =>
    d.contributionId === contributionId ? { ...d, gapId } : d,
  );
  if (decisions.length === 0) return;
  await writeEncryptedJson(
    fs,
    decisionsPath(authorId, bookId),
    { schemaVersion: 1, decisions },
    key,
  );
}

/** Accepted `question` contributions and the gap each already became (73 §3.4) — the interview's input. */
export async function acceptedQuestionContributions(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
  bookId: string,
): Promise<{ id: string; text: string; contributorName: string; gapId?: string }[]> {
  const reviews = await listContributionsForBook(fs, key, authorId, bookId);
  const { decisions } = await getContributionDecisions(fs, key, authorId, bookId);
  const gapOf = new Map(decisions.map((d) => [d.contributionId, d.gapId]));
  return reviews
    .filter((c) => c.status === 'accepted' && c.kind === 'question')
    .map((c) => {
      const gapId = gapOf.get(c.id);
      return {
        id: c.id,
        text: c.text,
        contributorName: c.contributorName,
        ...(gapId ? { gapId } : {}),
      };
    });
}

/**
 * The accepted material a book may draw on (73 §3.4) — memories and quotes only. A `question` reaches the
 * book through the SUBJECT'S ANSWER (it seeds an interview gap), and a `correction` is resolved by hand, so
 * neither is corpus material and neither appears here.
 *
 * `attributed: false` drops the contributor's name, so the prose treats it as ordinary source.
 */
export async function acceptedContributionMaterial(
  fs: FileSystem,
  key: Uint8Array,
  authorId: string,
  bookId: string,
): Promise<{ id: string; text: string; contributorName?: string; createdAt: string }[]> {
  const all = await listContributionsForBook(fs, key, authorId, bookId);
  return all
    .filter((c) => c.status === 'accepted' && (c.kind === 'memory' || c.kind === 'quote'))
    .map((c) => ({
      id: c.id,
      text: c.text,
      ...(c.attributed === false ? {} : { contributorName: c.contributorName }),
      createdAt: c.createdAt,
    }));
}

/** Reap everything when a person is deleted — both their offerings and any decisions about them (§7.4). */
export async function reapContributionsForPerson(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<void> {
  await fs.remove(contributionsDir(personId)).catch(() => {});
  for (const person of await listPeople(fs, key).catch(() => [])) {
    if (person.id === personId) continue;
    // The other direction: what OTHER people offered to the deleted person's books. Their whole tree went
    // with `deletePerson`, taking the decisions with it — so without this every contributor keeps an orphan
    // that reads as "waiting for them to read it" about someone who no longer exists.
    for (const c of await listContributionsBy(fs, key, person.id)) {
      if (c.toPersonId === personId) {
        await fs.remove(contributionPath(person.id, c.id)).catch(() => {});
      }
    }
    for (const bookId of await fs
      .list(`people/${pathSegment(person.id)}/story/books`)
      .catch(() => [])) {
      if (bookId.endsWith('.enc')) continue;
      await fs.remove(invitePath(person.id, bookId, personId)).catch(() => {});
      const list = await getContributionDecisions(fs, key, person.id, bookId);
      const kept = list.decisions.filter((d) => d.contributorId !== personId);
      if (kept.length !== list.decisions.length) {
        // Nothing left to record means nothing to keep — an empty file is still residue on disk.
        if (kept.length === 0) {
          await fs.remove(decisionsPath(person.id, bookId)).catch(() => {});
        } else {
          await writeEncryptedJson(
            fs,
            decisionsPath(person.id, bookId),
            { schemaVersion: 1, decisions: kept },
            key,
          );
        }
      }
    }
  }
}

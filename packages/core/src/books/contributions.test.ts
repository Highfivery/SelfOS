import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { deleteRelationship, savePerson, saveRelationship } from '../people';
import type { BookConfig, Person, Relationship } from '../schemas';
import {
  acceptedContributionMaterial,
  contributionStatus,
  decideContribution,
  inviteContribution,
  listContributionInvites,
  listContributionsForBook,
  listMyContributions,
  listMyInvitations,
  reapContributionsForPerson,
  revokeContributionInvite,
  submitContribution,
  withdrawContribution,
} from './contributions';
import { createBook, updateBook } from './storyService';

const key = generateMasterKey();
const now = new Date('2026-08-14T00:00:00.000Z');
const later = new Date('2026-08-15T00:00:00.000Z');
const config: BookConfig = {
  voice: 'third',
  style: 'warm',
  length: 'standard',
  autoRefresh: true,
  typeOptions: {},
  sourceIds: [],
};

function person(id: string, name: string): Person {
  return {
    id,
    schemaVersion: 2,
    displayName: name,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
}
function edge(a: string, b: string): Relationship {
  return {
    id: `rel-${a}-${b}`,
    schemaVersion: 2,
    fromPersonId: a,
    toPersonId: b,
    type: 'partner',
    createdAt: 'now',
    updatedAt: 'now',
  };
}

/** Ben writes a book; Angel is related to him; Cass is in the household but unrelated. */
async function seed(fs: ReturnType<typeof memFileSystem>): Promise<string> {
  await savePerson(fs, key, person('ben', 'Ben'));
  await savePerson(fs, key, person('angel', 'Angel'));
  await savePerson(fs, key, person('cass', 'Cass'));
  await saveRelationship(fs, key, edge('ben', 'angel'));
  const book = await createBook(fs, key, {
    personId: 'ben',
    type: 'biography',
    title: 'The Weight of Quiet',
    config,
    now,
  });
  return book.id;
}

async function invited(fs: ReturnType<typeof memFileSystem>, bookId: string): Promise<void> {
  await inviteContribution(fs, key, 'ben', { bookId, personId: 'angel', note: 'Denver?', now });
}

describe('inviting (73 §3.1)', () => {
  it('invites a related person, and refuses yourself or a stranger', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    expect(
      await inviteContribution(fs, key, 'ben', { bookId, personId: 'angel', now }),
    ).not.toBeNull();
    expect(await inviteContribution(fs, key, 'ben', { bookId, personId: 'ben', now })).toBeNull();
    // Cass is in the household but not related — contributing is invite-only AND relationship-gated.
    expect(await inviteContribution(fs, key, 'ben', { bookId, personId: 'cass', now })).toBeNull();
    expect((await listContributionInvites(fs, key, 'ben', bookId)).map((i) => i.personId)).toEqual([
      'angel',
    ]);
  });

  it('the invitation is how a contributor learns the book exists — and only then (§8.2)', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    // Before the invite, Angel is related to Ben and still sees nothing.
    expect(await listMyInvitations(fs, key, 'angel')).toEqual([]);
    await invited(fs, bookId);
    const mine = await listMyInvitations(fs, key, 'angel');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ authorName: 'Ben', note: 'Denver?', canRead: false });
    // Cass, uninvited, still sees nothing at all.
    expect(await listMyInvitations(fs, key, 'cass')).toEqual([]);
  });
});

describe('contributing (73 §3.2)', () => {
  it('submits a memory once invited, and refuses without a live invitation', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    // No invite yet → refused at the service, not merely hidden in the UI.
    expect(
      await submitContribution(fs, key, 'angel', {
        authorPersonId: 'ben',
        bookId,
        kind: 'memory',
        text: 'He rebuilt the porch that whole summer.',
        now,
      }),
    ).toBeNull();

    await invited(fs, bookId);
    expect(
      await submitContribution(fs, key, 'angel', {
        authorPersonId: 'ben',
        bookId,
        kind: 'memory',
        text: 'He rebuilt the porch that whole summer.',
        now,
      }),
    ).not.toBeNull();
  });

  /** The edge is the standing grant (72 §5.8) — losing it stops contribution with nothing to clean up. */
  it('stops the moment the relationship edge goes, even with an invitation on file', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await invited(fs, bookId);
    await deleteRelationship(fs, 'rel-ben-angel');
    expect(
      await submitContribution(fs, key, 'angel', {
        authorPersonId: 'ben',
        bookId,
        kind: 'memory',
        text: 'anything',
        now,
      }),
    ).toBeNull();
    expect(await listMyInvitations(fs, key, 'angel')).toEqual([]);
  });

  it('a revoked invitation stops NEW contributions but keeps what was accepted (§7.2)', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await invited(fs, bookId);
    const first = await submitContribution(fs, key, 'angel', {
      authorPersonId: 'ben',
      bookId,
      kind: 'memory',
      text: 'the porch',
      now,
    });
    await decideContribution(fs, key, 'ben', {
      bookId,
      contributionId: first!.id,
      status: 'accepted',
      now,
    });

    await revokeContributionInvite(fs, key, 'ben', { bookId, personId: 'angel', now: later });
    expect(
      await submitContribution(fs, key, 'angel', {
        authorPersonId: 'ben',
        bookId,
        kind: 'memory',
        text: 'something new',
        now: later,
      }),
    ).toBeNull();
    // …and the accepted one is still the author's material.
    expect((await acceptedContributionMaterial(fs, key, 'ben', bookId)).map((m) => m.text)).toEqual(
      ['the porch'],
    );
  });

  it('a correction needs a book they can actually READ (§3.2)', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await invited(fs, bookId);
    const args = {
      authorPersonId: 'ben',
      bookId,
      kind: 'correction' as const,
      text: 'That was 1994, not 1995.',
      now,
    };
    expect(await submitContribution(fs, key, 'angel', args)).toBeNull();

    // Publish + share it with her, and the same correction goes through.
    await updateBook(
      fs,
      key,
      'ben',
      bookId,
      { publishedAt: now.toISOString(), sharedWith: ['angel'] },
      now,
    );
    expect(await submitContribution(fs, key, 'angel', args)).not.toBeNull();
    expect((await listMyInvitations(fs, key, 'angel'))[0]?.canRead).toBe(true);
  });
});

describe('the two-writer split (73 §4.3) — the heart of the consent model', () => {
  it('derives status from both files, and neither side writes the other’s', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await invited(fs, bookId);
    const c = await submitContribution(fs, key, 'angel', {
      authorPersonId: 'ben',
      bookId,
      kind: 'memory',
      text: 'the porch',
      now,
    });

    expect((await listMyContributions(fs, key, 'angel'))[0]?.status).toBe('pending');
    await decideContribution(fs, key, 'ben', {
      bookId,
      contributionId: c!.id,
      status: 'accepted',
      now,
    });
    expect((await listMyContributions(fs, key, 'angel'))[0]?.status).toBe('accepted');

    // The author's decision did NOT touch her record — it still has no withdrawal and is hers alone.
    const raw = await fs.read(`people/angel/story/contributions/${c!.id}.enc`);
    expect(raw).not.toBeNull();
    // …and her withdrawal does not touch his decision file.
    await withdrawContribution(fs, key, 'angel', { contributionId: c!.id, now: later });
    expect((await listMyContributions(fs, key, 'angel'))[0]?.status).toBe('withdrawn');
  });

  it('withdrawal wins over an acceptance, and pulls the material out of the corpus', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await invited(fs, bookId);
    const c = await submitContribution(fs, key, 'angel', {
      authorPersonId: 'ben',
      bookId,
      kind: 'memory',
      text: 'the porch',
      now,
    });
    await decideContribution(fs, key, 'ben', {
      bookId,
      contributionId: c!.id,
      status: 'accepted',
      now,
    });
    expect(await acceptedContributionMaterial(fs, key, 'ben', bookId)).toHaveLength(1);

    await withdrawContribution(fs, key, 'angel', { contributionId: c!.id, now: later });
    expect(await acceptedContributionMaterial(fs, key, 'ben', bookId)).toEqual([]);
    // It leaves the author's review list too — taking it back is unconditional.
    expect(await listContributionsForBook(fs, key, 'ben', bookId)).toEqual([]);
  });

  it('the derived state is a pure function of the two records', () => {
    const base = {
      schemaVersion: 1 as const,
      id: 'c1',
      toPersonId: 'ben',
      bookId: 'b1',
      kind: 'memory' as const,
      text: 't',
      createdAt: 'now',
    };
    const decision = {
      contributionId: 'c1',
      contributorId: 'angel',
      status: 'accepted' as const,
      attributed: true,
      decidedAt: 'now',
    };
    expect(contributionStatus(base, undefined)).toBe('pending');
    expect(contributionStatus(base, decision)).toBe('accepted');
    expect(contributionStatus(base, { ...decision, status: 'declined' })).toBe('declined');
    // Withdrawal beats any decision.
    expect(contributionStatus({ ...base, withdrawnAt: 'now' }, decision)).toBe('withdrawn');
  });
});

describe('what reaches the book (73 §3.4)', () => {
  async function accepted(
    fs: ReturnType<typeof memFileSystem>,
    bookId: string,
    kind: 'memory' | 'question' | 'quote',
    text: string,
    attributed?: boolean,
  ): Promise<void> {
    const c = await submitContribution(fs, key, 'angel', {
      authorPersonId: 'ben',
      bookId,
      kind,
      text,
      now,
    });
    await decideContribution(fs, key, 'ben', {
      bookId,
      contributionId: c!.id,
      status: 'accepted',
      ...(attributed === undefined ? {} : { attributed }),
      now,
    });
  }

  it('names the contributor by default, and drops the name when absorbed as material', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await invited(fs, bookId);
    await accepted(fs, bookId, 'memory', 'named one');
    await accepted(fs, bookId, 'memory', 'absorbed one', false);

    const material = await acceptedContributionMaterial(fs, key, 'ben', bookId);
    expect(material.find((m) => m.text === 'named one')?.contributorName).toBe('Angel');
    expect(material.find((m) => m.text === 'absorbed one')?.contributorName).toBeUndefined();
  });

  it('a QUESTION never becomes corpus material — only the subject’s answer can', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await invited(fs, bookId);
    await accepted(fs, bookId, 'question', 'Ask him why he left that job.');
    // Accepted, visible to the author, and deliberately absent from what the prose draws on.
    expect((await listContributionsForBook(fs, key, 'ben', bookId))[0]?.status).toBe('accepted');
    expect(await acceptedContributionMaterial(fs, key, 'ben', bookId)).toEqual([]);
  });

  it('a DECLINED contribution never reaches the material', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await invited(fs, bookId);
    const c = await submitContribution(fs, key, 'angel', {
      authorPersonId: 'ben',
      bookId,
      kind: 'memory',
      text: 'not this',
      now,
    });
    await decideContribution(fs, key, 'ben', {
      bookId,
      contributionId: c!.id,
      status: 'declined',
      now,
    });
    expect(await acceptedContributionMaterial(fs, key, 'ben', bookId)).toEqual([]);
    expect((await listMyContributions(fs, key, 'angel'))[0]?.status).toBe('declined');
  });
});

describe('boundaries', () => {
  it('an author only ever reviews contributions addressed to their own book', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await invited(fs, bookId);
    // A second book of Ben's; a contribution to the first must not surface under the second.
    const other = await createBook(fs, key, {
      personId: 'ben',
      type: 'biography',
      title: 'Other',
      config,
      now,
    });
    await submitContribution(fs, key, 'angel', {
      authorPersonId: 'ben',
      bookId,
      kind: 'memory',
      text: 'first book only',
      now,
    });
    expect(await listContributionsForBook(fs, key, 'ben', other.id)).toEqual([]);
  });

  it('deciding something that is not yours writes nothing', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await invited(fs, bookId);
    const before = await listContributionsForBook(fs, key, 'ben', bookId);
    expect(
      await decideContribution(fs, key, 'ben', {
        bookId,
        contributionId: 'not-a-real-id',
        status: 'accepted',
        now,
      }),
    ).toEqual(before);
  });

  it('deleting a person reaps their contributions AND the decisions about them (§7.4)', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await invited(fs, bookId);
    const c = await submitContribution(fs, key, 'angel', {
      authorPersonId: 'ben',
      bookId,
      kind: 'memory',
      text: 'the porch',
      now,
    });
    await decideContribution(fs, key, 'ben', {
      bookId,
      contributionId: c!.id,
      status: 'accepted',
      now,
    });

    await reapContributionsForPerson(fs, key, 'angel');
    expect(await listContributionsForBook(fs, key, 'ben', bookId)).toEqual([]);
    expect(await acceptedContributionMaterial(fs, key, 'ben', bookId)).toEqual([]);
    expect(await listMyContributions(fs, key, 'angel')).toEqual([]);
    expect(await listContributionInvites(fs, key, 'ben', bookId)).toEqual([]);

    // Both directions, at the file level: no record of her survives in HIS space either —
    // the decision and the invitation are residue about a person who no longer exists.
    const bookDir = `people/ben/story/books/${bookId}`;
    expect(await fs.read(`${bookDir}/contributionDecisions.enc`)).toBeNull();
    expect(await fs.list(`${bookDir}/contributionInvites`)).toEqual([]);
    expect(await fs.list('people/angel/story/contributions')).toEqual([]);
  });
});

describe('scoping the author’s review list', () => {
  /** The guard this pins: a contributor invited to TWO of the same author's books. Without the per-book
   *  check, an offering to one would surface under the other — and the earlier test couldn't reach it,
   *  because a book with no invitation returns early before the check ever runs. */
  it('keeps two books of the same author separate for one contributor', async () => {
    const fs = memFileSystem();
    const first = await seed(fs);
    const second = (
      await createBook(fs, key, {
        personId: 'ben',
        type: 'biography',
        title: 'Second',
        config,
        now,
      })
    ).id;
    await inviteContribution(fs, key, 'ben', { bookId: first, personId: 'angel', now });
    await inviteContribution(fs, key, 'ben', { bookId: second, personId: 'angel', now });

    await submitContribution(fs, key, 'angel', {
      authorPersonId: 'ben',
      bookId: first,
      kind: 'memory',
      text: 'for the first book',
      now,
    });

    expect((await listContributionsForBook(fs, key, 'ben', first)).map((c) => c.text)).toEqual([
      'for the first book',
    ]);
    expect(await listContributionsForBook(fs, key, 'ben', second)).toEqual([]);
  });

  it('deleting an AUTHOR clears what others offered them, so nothing waits on a ghost (§7.4)', async () => {
    const fs = memFileSystem();
    const bookId = await seed(fs);
    await invited(fs, bookId);
    await submitContribution(fs, key, 'angel', {
      authorPersonId: 'ben',
      bookId,
      kind: 'memory',
      text: 'the porch',
      now,
    });
    expect(await listMyContributions(fs, key, 'angel')).toHaveLength(1);

    await reapContributionsForPerson(fs, key, 'ben');
    expect(await listMyContributions(fs, key, 'angel')).toEqual([]);
  });
});

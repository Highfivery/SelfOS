import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { deleteRelationship, savePerson, saveRelationship } from '../people';
import type { BookConfig, Person, Relationship } from '../schemas';
import { pairKeyFor } from '../together';
import {
  isPairRef,
  listPairBooks,
  livePairRefs,
  pairMembers,
  partnerOf,
  resolveBookOwnerRef,
} from './pairBooks';
import { booksDir, createBook, getBook, listBooks } from './storyService';

const key = generateMasterKey();
const now = new Date('2026-08-14T00:00:00.000Z');
const config: BookConfig = {
  voice: 'third',
  style: 'warm',
  length: 'standard',
  autoRefresh: true,
  typeOptions: {},
  sourceIds: [],
};

function person(id: string): Person {
  return {
    id,
    schemaVersion: 2,
    displayName: id,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
}
function partnerEdge(a: string, b: string): Relationship {
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

/** Ben + Angel are partners; Cass is in the household but unrelated to either. */
async function household(fs: ReturnType<typeof memFileSystem>): Promise<void> {
  for (const id of ['ben', 'angel', 'cass']) await savePerson(fs, key, person(id));
  await saveRelationship(fs, key, partnerEdge('ben', 'angel'));
}

describe('pair-owned book addressing (72 §5.8)', () => {
  it('a pairKey addresses the pair root; a person id addresses their own', () => {
    expect(booksDir('ben')).toBe('people/ben/story/books');
    expect(booksDir(pairKeyFor('ben', 'angel'))).toBe('together/pairs/angel~ben/books');
    // The pairKey is order-independent, so both partners resolve to the SAME root.
    expect(booksDir(pairKeyFor('angel', 'ben'))).toBe(booksDir(pairKeyFor('ben', 'angel')));
  });

  it('refuses a pair ref that is not two safe ids — the traversal guard still applies', () => {
    expect(() => booksDir('../x~../y')).toThrow(/unsafe id/i);
    expect(() => booksDir('a~b~c')).toThrow(/unsafe id/i);
  });

  it('reads back a book written at the pair root, from either partner’s side', async () => {
    const fs = memFileSystem();
    await household(fs);
    const ref = pairKeyFor('ben', 'angel');
    const book = await createBook(fs, key, {
      personId: ref,
      type: 'biography',
      title: 'Us',
      config,
      now,
    });
    expect(await fs.list('together/pairs/angel~ben/books')).toContain(book.id);
    // Neither partner's own books dir gained anything.
    expect(await listBooks(fs, key, 'ben')).toEqual([]);
    expect(await listBooks(fs, key, 'angel')).toEqual([]);
    expect((await getBook(fs, key, pairKeyFor('angel', 'ben'), book.id))?.title).toBe('Us');
  });
});

describe('the shared-book gate (72 §5.8) — membership plus a LIVE partner edge', () => {
  it('resolves a partner’s shared book for both of them, and nobody else', async () => {
    const fs = memFileSystem();
    await household(fs);
    const ref = pairKeyFor('ben', 'angel');
    const shared = await createBook(fs, key, {
      personId: ref,
      type: 'biography',
      title: 'Us',
      config,
      now,
    });

    expect(await resolveBookOwnerRef(fs, key, 'ben', shared.id)).toBe(ref);
    expect(await resolveBookOwnerRef(fs, key, 'angel', shared.id)).toBe(ref);
    // Cass is in the same household and has no partner edge — the shared book does not exist for them.
    expect(await resolveBookOwnerRef(fs, key, 'cass', shared.id)).toBeNull();
  });

  it('a solo book stays the owner’s alone — a partner cannot reach it', async () => {
    const fs = memFileSystem();
    await household(fs);
    const solo = await createBook(fs, key, {
      personId: 'ben',
      type: 'biography',
      title: 'Mine',
      config,
      now,
    });
    expect(await resolveBookOwnerRef(fs, key, 'ben', solo.id)).toBe('ben');
    // Being someone's partner does not open their own books.
    expect(await resolveBookOwnerRef(fs, key, 'angel', solo.id)).toBeNull();
    expect(await resolveBookOwnerRef(fs, key, 'cass', solo.id)).toBeNull();
  });

  /**
   * The property the whole design rests on: the edge IS the grant, re-derived on every call. Removing it
   * re-gates the shared book immediately — no revocation step, no `sharedWith` list to clean up, and no
   * stale access left behind in the pair folder.
   */
  it('removing the partner edge re-gates the shared book on the very next read', async () => {
    const fs = memFileSystem();
    await household(fs);
    const ref = pairKeyFor('ben', 'angel');
    const shared = await createBook(fs, key, {
      personId: ref,
      type: 'biography',
      title: 'Us',
      config,
      now,
    });
    expect(await resolveBookOwnerRef(fs, key, 'ben', shared.id)).toBe(ref);

    await deleteRelationship(fs, 'rel-ben-angel');
    expect(await resolveBookOwnerRef(fs, key, 'ben', shared.id)).toBeNull();
    expect(await resolveBookOwnerRef(fs, key, 'angel', shared.id)).toBeNull();
    // The book itself is untouched — it is unreachable, not destroyed.
    expect((await getBook(fs, key, ref, shared.id))?.title).toBe('Us');
  });

  it('an unknown book id resolves to nothing, exactly like a denial', async () => {
    const fs = memFileSystem();
    await household(fs);
    expect(await resolveBookOwnerRef(fs, key, 'ben', 'no-such-book')).toBeNull();
  });

  it('lists only the pair books this viewer can currently reach', async () => {
    const fs = memFileSystem();
    await household(fs);
    const ref = pairKeyFor('ben', 'angel');
    await createBook(fs, key, { personId: ref, type: 'biography', title: 'Us', config, now });

    expect((await listPairBooks(fs, key, 'ben')).map((b) => b.manifest.title)).toEqual(['Us']);
    expect((await listPairBooks(fs, key, 'angel')).map((b) => b.manifest.title)).toEqual(['Us']);
    expect(await listPairBooks(fs, key, 'cass')).toEqual([]);

    await deleteRelationship(fs, 'rel-ben-angel');
    expect(await listPairBooks(fs, key, 'ben')).toEqual([]);
  });

  it('derives pair refs from the live graph, never from what is on disk', async () => {
    const fs = memFileSystem();
    await household(fs);
    expect(await livePairRefs(fs, key, 'ben')).toEqual([pairKeyFor('ben', 'angel')]);
    expect(await livePairRefs(fs, key, 'cass')).toEqual([]);
  });
});

describe('pair ref helpers', () => {
  it('names the two members and the other one', () => {
    const ref = pairKeyFor('ben', 'angel');
    expect(pairMembers(ref)).toEqual(['angel', 'ben']);
    expect(partnerOf(ref, 'ben')).toBe('angel');
    expect(partnerOf(ref, 'angel')).toBe('ben');
    // A viewer who isn't a member gets nothing rather than a wrong name.
    expect(partnerOf(ref, 'cass')).toBeNull();
    expect(isPairRef(ref)).toBe(true);
    expect(isPairRef('ben')).toBe(false);
    expect(pairMembers('ben')).toBeNull();
    expect(partnerOf('ben', 'ben')).toBeNull();
  });
});

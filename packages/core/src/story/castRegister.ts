import type { FileSystem } from '../host';
import { listPeople, listRelatedPeople, listRelationships } from '../people';
import type { CastEntry, CastMember } from '../schemas';
import { buildStoryCorpus } from './storyCorpus';
import { listMemories } from './storyMemoryService';
import { getExclusions } from './storyService';

/**
 * The cast register (64-your-story §17.2, #295) — the book's recurring people, built deterministically (no AI)
 * from three sources: the People graph (relationships), the people named in saved memories, and named mentions
 * in the corpus. INTERNAL by default (a continuity aid so names/relationships stay consistent); the author may
 * opt in to publish it as a "dramatis personae" front-matter section (§4/§5, the frozen `PublishedManifest.cast`).
 *
 * Privacy: it reads the SAME gated related-people read the corpus uses (`listRelatedPeople` + `listRelationships`)
 * plus own memory people plus own corpus-text name hits — only structure (a display name + a relationship label)
 * and a mention count, never another person's private facts. Excluded people (a `person`/`topic` exclusion) drop
 * out because mention-counting runs over the already-exclusion-filtered corpus and the graph is filtered too.
 */

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/** A human relationship label from the subject's link to a person: a custom label wins, else the type. */
function labelFor(type: string, label: string | undefined): string {
  return label?.trim() ? label.trim() : type;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A case-insensitive WHOLE-WORD matcher for a name — so a short name ("Ed", "Al") never substring-matches an
 *  ordinary word ("edited", "always") and phantom-adds a person to the register (and the opt-in published cast). */
function wordMatcher(name: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i');
}

/**
 * Build the register for a book. Sorted by prominence (mentions desc, then name). Each entry names its
 * source(s) and, when the person is a household member, their `personId` + relationship label.
 */
export async function getCastRegister(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<CastEntry[]> {
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };

  const relationships = await safe(() => listRelationships(fs, key), []);
  const related = await safe(() => listRelatedPeople(fs, key, personId), []);
  const memories = await safe(() => listMemories(fs, key, personId), []);
  const people = await safe(() => listPeople(fs, key), []);
  const exclusions = await safe(() => getExclusions(fs, key, personId, bookId), []);
  const corpus = await safe(() => buildStoryCorpus(fs, key, personId, bookId, exclusions), {
    personName: '',
    profile: [],
    items: [],
  });

  // A `person` exclusion drops that person entirely; a `topic`/`passage`/name phrase drop is already applied to
  // the corpus, so mention counts exclude them — here we also drop an excluded person from the graph list.
  const excludedPersonIds = new Set(
    exclusions.filter((e) => e.kind === 'person').map((e) => e.value),
  );

  // Keyed by normalized (trim+lowercase) name — so two distinct household members with the same display name
  // collapse into one cast entry (fine for a name-only published cast; the first source's id/label wins).
  const byName = new Map<string, CastEntry>();
  const upsert = (
    rawName: string,
    patch: Partial<CastEntry> & { source: CastEntry['sources'][number] },
  ): CastEntry | null => {
    const name = rawName.trim();
    if (name.length < 2) return null; // a 1-char "name" is noise
    const kNorm = normalize(name);
    const existing = byName.get(kNorm);
    if (existing) {
      if (patch.personId && !existing.personId) existing.personId = patch.personId;
      if (patch.relationship && !existing.relationship) existing.relationship = patch.relationship;
      if (!existing.sources.includes(patch.source)) existing.sources.push(patch.source);
      return existing;
    }
    const entry: CastEntry = {
      name,
      ...(patch.personId ? { personId: patch.personId } : {}),
      ...(patch.relationship ? { relationship: patch.relationship } : {}),
      mentions: 0,
      sources: [patch.source],
    };
    byName.set(kNorm, entry);
    return entry;
  };

  // 1) The People graph — related household people, with their relationship label.
  for (const person of related) {
    if (excludedPersonIds.has(person.id)) continue;
    const link = relationships.find(
      (r) =>
        (r.fromPersonId === personId && r.toPersonId === person.id) ||
        (r.toPersonId === personId && r.fromPersonId === person.id),
    );
    upsert(person.displayName, {
      personId: person.id,
      source: 'graph',
      ...(link ? { relationship: labelFor(link.type, link.label) } : {}),
    });
  }

  // 2) People named in saved memories (own data). A linked household person carries their id.
  for (const memory of memories) {
    if (memory.status !== 'saved') continue;
    for (const p of memory.people) {
      if (p.personId && excludedPersonIds.has(p.personId)) continue;
      upsert(p.name, { source: 'memory', ...(p.personId ? { personId: p.personId } : {}) });
    }
  }

  // 3) Named mentions — count how often each household display name appears (as a WHOLE WORD) in the
  //    (exclusion-filtered) corpus. A person mentioned but not related/in a memory still enters (source
  //    'mention'). Whole-word matching so a short name never inflates on an ordinary word.
  const candidates = new Map<string, { name: string; personId?: string; re: RegExp }>();
  const addCandidate = (name: string, personId?: string): void => {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    const kNorm = normalize(trimmed);
    if (!candidates.has(kNorm)) {
      candidates.set(kNorm, {
        name: trimmed,
        ...(personId ? { personId } : {}),
        re: wordMatcher(trimmed),
      });
    }
  };
  for (const p of people) {
    if (p.id === personId || excludedPersonIds.has(p.id)) continue;
    addCandidate(p.displayName, p.id);
  }
  for (const entry of byName.values()) addCandidate(entry.name, entry.personId);
  for (const item of corpus.items) {
    for (const cand of candidates.values()) {
      if (!cand.re.test(item.text)) continue;
      const entry =
        byName.get(normalize(cand.name)) ??
        upsert(cand.name, {
          source: 'mention',
          ...(cand.personId ? { personId: cand.personId } : {}),
        });
      if (entry) entry.mentions += 1;
    }
  }

  return [...byName.values()].sort(
    (a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name),
  );
}

/**
 * The published "dramatis personae" (§17.2) — the frozen, reader-facing shape (name + relationship). Includes a
 * person only when they're worth naming: a graph/memory person, or someone the book actually names (mentions >
 * 0). A bare zero-mention candidate never surfaces.
 */
export function castForPublication(entries: CastEntry[]): CastMember[] {
  return entries
    .filter((e) => e.sources.includes('graph') || e.sources.includes('memory') || e.mentions > 0)
    .map((e) => ({ name: e.name, ...(e.relationship ? { relationship: e.relationship } : {}) }));
}

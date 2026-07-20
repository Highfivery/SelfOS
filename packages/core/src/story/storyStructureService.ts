import { z } from 'zod';
import { classifyParseOutcome, extractJsonObject, tolerantArray } from '../ai';
import { uuid } from '../id';
import { type AiDeps, runClaude } from '../questionnaires';
import {
  LIFE_AREAS,
  type AiFailureReason,
  type BookChapter,
  type BookOutline,
  type OutlineChapter,
  type StructuralProposal,
  type UsageEvent,
} from '../schemas';
import { getBookType } from './bookTypes';
import { buildStoryCorpus, type StoryCorpus } from './storyCorpus';
import { buildBiographerSystem, buildStructureUserMessage } from './storyPromptBuilder';
import {
  getBook,
  getChapter,
  getExclusions,
  getOutline,
  getProposals,
  saveChapter,
  saveOutline,
  saveProposals,
} from './storyService';

/**
 * The Your Story STRUCTURE engine (64-your-story §3.4/§5.4) — the freshness engine's structural half. When new
 * material arrives, a metered `story.structure` pass proposes shape changes (a new chapter, a split, a reorder,
 * a prologue rewrite) as `StructuralProposal`s that WAIT for one-tap approval — never applied silently (the
 * spec-20 merge-proposal pattern). Applying only RESTRUCTURES the outline: new/split chapters land un-written
 * (status `stale`) and are drafted on the NEXT refresh (owner decision 2026-07-16), so an approve never spends.
 *
 * Dedup is by a stable per-kind signature against BOTH pending and dismissed proposals — a dismissed idea is
 * kept (not deleted) precisely so it isn't re-proposed. `runClaude` meters before we parse (meter-before-parse);
 * zero proposals is a valid, common answer, so only an unparseable reply is an honest failure.
 */

const STRUCTURE_MAX_TOKENS = 4000;

/** A loose proposal shape — one bad element drops itself; we validate id references + build the typed proposal
 *  ourselves (never trust model ids blindly). */
const DraftProposalSchema = z.object({
  kind: z.string().catch(''),
  rationale: z.string().optional().catch(undefined),
  partId: z.string().optional().catch(undefined),
  afterChapterId: z.string().optional().catch(undefined),
  chapterId: z.string().optional().catch(undefined),
  title: z.string().optional().catch(undefined),
  brief: z.string().optional().catch(undefined),
  firstTitle: z.string().optional().catch(undefined),
  firstBrief: z.string().optional().catch(undefined),
  secondTitle: z.string().optional().catch(undefined),
  secondBrief: z.string().optional().catch(undefined),
  order: z.array(z.string()).optional().catch(undefined),
  eraFrom: z.string().optional().catch(undefined),
  eraTo: z.string().optional().catch(undefined),
  lifeAreas: z.array(z.string()).optional().catch(undefined),
});
type DraftProposal = z.infer<typeof DraftProposalSchema>;

const StructureDraftSchema = z.object({
  proposals: tolerantArray(
    DraftProposalSchema,
    { kind: '' } as DraftProposal,
    (p) => (p.kind ?? '').trim().length > 0,
  ).catch([]),
});

/** A stable identity for a proposal so an equivalent idea isn't re-proposed (dedup vs pending + dismissed). */
function proposalSignature(p: StructuralProposal): string {
  switch (p.kind) {
    case 'newChapter':
      return `new:${p.partId}:${p.title.trim().toLowerCase()}`;
    case 'splitChapter':
      return `split:${p.chapterId}`;
    case 'reorder':
      return `reorder:${p.partId}`;
    case 'prologueRewrite':
      return `prologue:${p.chapterId}`;
  }
}

/** Turn a loose draft into a validated, id-checked proposal (or null to drop it). Refs must exist in the CURRENT
 *  outline; ids/createdAt are minted here. */
function draftToProposal(
  d: DraftProposal,
  outline: BookOutline,
  now: Date,
): StructuralProposal | null {
  const validAreas = new Set<string>(LIFE_AREAS);
  const partIds = new Set(outline.parts.map((p) => p.id));
  const chapterIds = new Set(outline.parts.flatMap((p) => p.chapters.map((c) => c.id)));
  const base = {
    id: uuid(),
    rationale: (d.rationale ?? '').trim(),
    createdAt: now.toISOString(),
    status: 'pending' as const,
  };

  if (d.kind === 'newChapter') {
    if (!d.partId || !partIds.has(d.partId)) return null;
    const title = (d.title ?? '').trim();
    if (!title) return null;
    const part = outline.parts.find((p) => p.id === d.partId)!;
    const after =
      d.afterChapterId && part.chapters.some((c) => c.id === d.afterChapterId)
        ? d.afterChapterId
        : undefined;
    return {
      ...base,
      kind: 'newChapter',
      partId: d.partId,
      ...(after ? { afterChapterId: after } : {}),
      title,
      brief: (d.brief ?? '').trim(),
      lifeAreas: (d.lifeAreas ?? []).filter((a) => validAreas.has(a)),
      ...(d.eraFrom ? { eraFrom: d.eraFrom } : {}),
      ...(d.eraTo ? { eraTo: d.eraTo } : {}),
    };
  }
  if (d.kind === 'splitChapter') {
    if (!d.chapterId || !chapterIds.has(d.chapterId)) return null;
    const firstTitle = (d.firstTitle ?? '').trim();
    const secondTitle = (d.secondTitle ?? '').trim();
    if (!firstTitle || !secondTitle) return null;
    return {
      ...base,
      kind: 'splitChapter',
      chapterId: d.chapterId,
      firstTitle,
      firstBrief: (d.firstBrief ?? '').trim(),
      secondTitle,
      secondBrief: (d.secondBrief ?? '').trim(),
    };
  }
  if (d.kind === 'reorder') {
    if (!d.partId || !partIds.has(d.partId)) return null;
    const part = outline.parts.find((p) => p.id === d.partId)!;
    const ids = part.chapters.map((c) => c.id);
    if (ids.length < 2) return null;
    const proposed = (d.order ?? []).filter((id) => ids.includes(id));
    if (proposed.length < 2) return null;
    // A full permutation: the proposed ids first (deduped), then any the model omitted, in their current order.
    const seen = new Set<string>();
    const head = proposed.filter((id) => !seen.has(id) && seen.add(id));
    const order = [...head, ...ids.filter((id) => !seen.has(id))];
    if (order.every((id, i) => id === ids[i])) return null; // a no-op reorder isn't a proposal
    return { ...base, kind: 'reorder', partId: d.partId, order };
  }
  if (d.kind === 'prologueRewrite') {
    if (!d.chapterId || !chapterIds.has(d.chapterId)) return null;
    return { ...base, kind: 'prologueRewrite', chapterId: d.chapterId };
  }
  return null;
}

/** An un-written chapter shell: `stale` so the next refresh writes it (owner decision — approve never spends). */
function chapterShell(id: string, partId: string, order: number, title: string): BookChapter {
  return {
    id,
    schemaVersion: 1,
    partId,
    order,
    title,
    markdown: '',
    revision: 0,
    status: 'stale',
    sourceSignature: '',
    provenance: [],
    protectedBlocks: [],
    pinnedQuotes: [],
    imagePlacements: [],
  };
}

export type StructureGenResult =
  | { ok: true; proposals: StructuralProposal[]; added: number; usage?: UsageEvent }
  | { ok: false; reason: AiFailureReason; message: string };

/**
 * Run the structure-analysis pass and merge any NEW proposals into the stored list (deduped vs pending +
 * dismissed). Returns the PENDING proposals for display. No-ops without spending when there's no outline / no
 * chapters yet (nothing to restructure). The caller supplies `corpus` when it already built one (the refresh
 * cadence builds it once).
 */
export async function generateStructuralProposals(
  deps: AiDeps,
  args: { bookId: string; corpus?: StoryCorpus },
): Promise<StructureGenResult> {
  const book = await getBook(deps.fs, deps.key, deps.personId, args.bookId);
  if (!book) return { ok: false, reason: 'ERROR', message: 'That book is no longer here.' };
  const bookType = getBookType(book.type);
  if (!bookType) return { ok: false, reason: 'ERROR', message: 'Unknown book type.' };
  const outline = await getOutline(deps.fs, deps.key, deps.personId, args.bookId);
  const chapterCount = outline?.parts.reduce((n, p) => n + p.chapters.length, 0) ?? 0;
  const existing = await getProposals(deps.fs, deps.key, deps.personId, args.bookId);
  // Nothing to restructure yet — return the current pending list without spending.
  if (!outline || chapterCount === 0) {
    return {
      ok: true,
      proposals: existing.proposals.filter((p) => p.status === 'pending'),
      added: 0,
    };
  }

  const corpus =
    args.corpus ??
    (await buildStoryCorpus(
      deps.fs,
      deps.key,
      deps.personId,
      args.bookId,
      await getExclusions(deps.fs, deps.key, deps.personId, args.bookId),
    ));
  const system = buildBiographerSystem(bookType, book.config, corpus.personName);
  const user = buildStructureUserMessage(corpus, {
    outline,
    ...(book.essence ? { essence: book.essence } : {}),
  });

  const result = await runClaude(deps, system, user, 'story.structure', STRUCTURE_MAX_TOKENS);
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };

  // Usage is already recorded (meter-before-parse). A reply with no JSON object is an honest failure; a
  // parseable `{ proposals: [] }` (or `{}`) is a valid "no structural change needed" — the common case.
  const json = extractJsonObject(result.text);
  if (!json) {
    const { reason, message } = classifyParseOutcome(result.text, 'proposals');
    return { ok: false, reason, message };
  }
  const drafts = StructureDraftSchema.parse(json).proposals;

  const existingSigs = new Set(existing.proposals.map(proposalSignature));
  const accepted: StructuralProposal[] = [];
  for (const d of drafts) {
    const p = draftToProposal(d, outline, deps.now);
    if (!p) continue;
    const sig = proposalSignature(p);
    if (existingSigs.has(sig)) continue;
    existingSigs.add(sig);
    accepted.push(p);
  }

  // Re-read: `existing` predates the model call, so an approve/dismiss made during the pass would be
  // reverted by merging into the stale list. Append to the CURRENT proposals instead.
  const liveProposals =
    (await getProposals(deps.fs, deps.key, deps.personId, args.bookId)) ?? existing;
  const merged = {
    schemaVersion: 1 as const,
    proposals: [...liveProposals.proposals, ...accepted],
  };
  await saveProposals(deps.fs, deps.key, deps.personId, args.bookId, merged);
  return {
    ok: true,
    proposals: merged.proposals.filter((p) => p.status === 'pending'),
    added: accepted.length,
    ...(result.usage ? { usage: result.usage } : {}),
  };
}

/** The book's PENDING structural proposals (dismissed ones stay stored for dedup but aren't shown). */
export async function listStructuralProposals(
  fs: AiDeps['fs'],
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<StructuralProposal[]> {
  const list = await getProposals(fs, key, personId, bookId);
  return list.proposals.filter((p) => p.status === 'pending');
}

/** Re-sync every existing draft-head chapter in a part to the outline's order (an insert/reorder shifts them). */
async function syncPartChapterOrder(
  fs: AiDeps['fs'],
  key: Uint8Array,
  personId: string,
  bookId: string,
  part: { id: string; chapters: OutlineChapter[] },
): Promise<void> {
  for (let i = 0; i < part.chapters.length; i += 1) {
    const oc = part.chapters[i]!;
    const bc = await getChapter(fs, key, personId, bookId, oc.id);
    if (bc && (bc.order !== i || bc.partId !== part.id)) {
      await saveChapter(fs, key, personId, bookId, { ...bc, order: i, partId: part.id });
    }
  }
}

/** Apply an approved proposal — mutate the outline (+ create/mark chapter shells stale). Never writes prose. */
async function applyStructuralProposal(
  fs: AiDeps['fs'],
  key: Uint8Array,
  personId: string,
  bookId: string,
  proposal: StructuralProposal,
): Promise<{ ok: boolean; message?: string }> {
  const outline = await getOutline(fs, key, personId, bookId);
  if (!outline) return { ok: false, message: 'This book has no outline.' };
  const validAreas = new Set<string>(LIFE_AREAS);

  if (proposal.kind === 'newChapter') {
    const part = outline.parts.find((p) => p.id === proposal.partId);
    if (!part) return { ok: false, message: 'That part is no longer in the outline.' };
    const at = proposal.afterChapterId
      ? part.chapters.findIndex((c) => c.id === proposal.afterChapterId)
      : -1;
    const insertAt = at >= 0 ? at + 1 : part.chapters.length;
    const newId = uuid();
    part.chapters.splice(insertAt, 0, {
      id: newId,
      title: proposal.title,
      brief: proposal.brief,
      ...(proposal.eraFrom ? { eraFrom: proposal.eraFrom } : {}),
      ...(proposal.eraTo ? { eraTo: proposal.eraTo } : {}),
      lifeAreas: proposal.lifeAreas.filter((a) => validAreas.has(a)),
      order: insertAt,
    });
    part.chapters.forEach((c, i) => (c.order = i));
    await saveOutline(fs, key, personId, bookId, outline);
    await saveChapter(
      fs,
      key,
      personId,
      bookId,
      chapterShell(newId, part.id, insertAt, proposal.title),
    );
    await syncPartChapterOrder(fs, key, personId, bookId, part);
    return { ok: true };
  }

  if (proposal.kind === 'splitChapter') {
    const part = outline.parts.find((p) => p.chapters.some((c) => c.id === proposal.chapterId));
    if (!part) return { ok: false, message: 'That chapter is no longer in the outline.' };
    const idx = part.chapters.findIndex((c) => c.id === proposal.chapterId);
    const original = part.chapters[idx]!;
    original.title = proposal.firstTitle;
    original.brief = proposal.firstBrief;
    const secondId = uuid();
    part.chapters.splice(idx + 1, 0, {
      id: secondId,
      title: proposal.secondTitle,
      brief: proposal.secondBrief,
      ...(original.eraFrom ? { eraFrom: original.eraFrom } : {}),
      ...(original.eraTo ? { eraTo: original.eraTo } : {}),
      lifeAreas: original.lifeAreas,
      order: idx + 1,
    });
    part.chapters.forEach((c, i) => (c.order = i));
    await saveOutline(fs, key, personId, bookId, outline);
    // The original is rewritten to its narrower brief on the next pass; the new sibling is written fresh.
    const origBook = await getChapter(fs, key, personId, bookId, proposal.chapterId);
    if (origBook) {
      await saveChapter(fs, key, personId, bookId, {
        ...origBook,
        title: proposal.firstTitle,
        status: 'stale',
      });
    }
    await saveChapter(
      fs,
      key,
      personId,
      bookId,
      chapterShell(secondId, part.id, idx + 1, proposal.secondTitle),
    );
    await syncPartChapterOrder(fs, key, personId, bookId, part);
    return { ok: true };
  }

  if (proposal.kind === 'reorder') {
    const part = outline.parts.find((p) => p.id === proposal.partId);
    if (!part) return { ok: false, message: 'That part is no longer in the outline.' };
    const rank = new Map(proposal.order.map((id, i) => [id, i]));
    part.chapters.sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
    part.chapters.forEach((c, i) => (c.order = i));
    await saveOutline(fs, key, personId, bookId, outline);
    await syncPartChapterOrder(fs, key, personId, bookId, part);
    return { ok: true };
  }

  // prologueRewrite — mark the opening chapter stale so the next pass rewrites it (no prose change here).
  const inOutline = outline.parts.some((p) => p.chapters.some((c) => c.id === proposal.chapterId));
  if (!inOutline) return { ok: false, message: 'That chapter is no longer in the outline.' };
  const bc = await getChapter(fs, key, personId, bookId, proposal.chapterId);
  if (bc && bc.status !== 'stale') {
    await saveChapter(fs, key, personId, bookId, { ...bc, status: 'stale' });
  }
  return { ok: true };
}

export interface ResolveProposalResult {
  ok: boolean;
  proposals: StructuralProposal[];
  message?: string;
}

/**
 * Resolve a pending proposal: `dismiss` keeps it (status `dismissed`) so it isn't re-proposed; `approve` applies
 * the restructure then removes it. A proposal whose referenced ids have since vanished can't apply — it's dropped
 * with an honest message. Returns the remaining PENDING proposals. No AI spend (apply only restructures).
 */
export async function resolveProposal(
  fs: AiDeps['fs'],
  key: Uint8Array,
  personId: string,
  args: { bookId: string; proposalId: string; action: 'approve' | 'dismiss' },
): Promise<ResolveProposalResult> {
  const list = await getProposals(fs, key, personId, args.bookId);
  const idx = list.proposals.findIndex((p) => p.id === args.proposalId && p.status === 'pending');
  const pending = (): StructuralProposal[] => list.proposals.filter((p) => p.status === 'pending');
  if (idx < 0)
    return { ok: false, proposals: pending(), message: 'That suggestion is no longer here.' };
  const proposal = list.proposals[idx]!;

  if (args.action === 'dismiss') {
    list.proposals[idx] = { ...proposal, status: 'dismissed' };
    await saveProposals(fs, key, personId, args.bookId, list);
    return { ok: true, proposals: pending() };
  }

  const applied = await applyStructuralProposal(fs, key, personId, args.bookId, proposal);
  // Whether it applied or its refs vanished, the proposal leaves the pending list (a stale-ref one is dead).
  list.proposals.splice(idx, 1);
  await saveProposals(fs, key, personId, args.bookId, list);
  return applied.ok
    ? { ok: true, proposals: pending() }
    : { ok: false, proposals: pending(), ...(applied.message ? { message: applied.message } : {}) };
}

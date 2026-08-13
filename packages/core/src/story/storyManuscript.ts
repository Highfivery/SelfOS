import { z } from 'zod';
import { classifyParseOutcome, extractJsonObject, tolerantArray } from '../ai';
import { uuid } from '../id';
import { type AiDeps, runClaude } from '../questionnaires';
import {
  ContinuityKindSchema,
  type BookChapter,
  type ContinuityFinding,
  type StoryContinuityResult,
} from '../schemas';
import { getBookType } from './bookTypes';
import { findingSignature } from './storyContinuity';
import { manuscriptMetrics } from './manuscriptMetrics';
import { buildBiographerSystem } from './storyPromptBuilder';
import { getBook, getContinuity, listChapters, saveContinuity } from './storyService';

/**
 * The manuscript pass (72 §5.3) — the read a book gets once its chapters exist, for the defects that are
 * invisible one chapter at a time.
 *
 * The craft loop polices a chapter against itself: is this a scene, is this invented, does it narrate its
 * own sourcing. It cannot see that the same childhood image has now carried four chapters, that the
 * twenties race past in nine hundred words while a single argument gets six thousand, or that the thread
 * the book opened on is never answered. Those need the whole manuscript in one read.
 *
 * It emits REVIEW ITEMS, never edits — the same decision the continuity pass made (§17.3), for the same
 * reason: a book's shape is the author's. Findings land in the same list the continuity check writes to, so
 * there is one place to go and one lifecycle (pending → resolved/dismissed), de-duped across both passes so
 * a re-read never re-raises something already dealt with.
 */

const MANUSCRIPT_MAX_TOKENS = 6000;
/** Below this there is no manuscript to read — repetition and pacing are relations BETWEEN chapters, so
 *  they need at least two. The same floor the continuity pass uses, for the same reason. */
const MIN_CHAPTERS_FOR_MANUSCRIPT = 2;

function isWritten(chapter: BookChapter): boolean {
  return chapter.markdown.trim().length > 0;
}

/** Tolerant: one malformed finding drops itself, never the whole read (37 §3.1). */
const FindingDraftSchema = z.object({
  kind: ContinuityKindSchema.catch('other'),
  summary: z.string().catch(''),
  chapters: z.array(z.string()).catch([]),
});
const ManuscriptDraftSchema = z.object({
  findings: tolerantArray(
    FindingDraftSchema,
    { kind: 'other' as const, summary: '', chapters: [] },
    (f) => f.summary.trim().length > 0,
  ).catch([]),
});

/**
 * Read the whole book and file what only a whole-book read can see. Appends to the shared review list,
 * de-duped against every stored finding (including the continuity pass's and anything already resolved or
 * dismissed). Zero findings is a good result, not a failure — only an unparseable reply fails. Returns the
 * pending set.
 */
export async function readManuscript(deps: AiDeps, bookId: string): Promise<StoryContinuityResult> {
  const book = await getBook(deps.fs, deps.key, deps.personId, bookId);
  if (!book)
    return { ok: false, findings: [], reason: 'ERROR', message: 'That book is no longer here.' };
  const bookType = getBookType(book.type);
  if (!bookType) return { ok: false, findings: [], reason: 'ERROR', message: 'Unknown book type.' };

  const written = (await listChapters(deps.fs, deps.key, deps.personId, bookId)).filter(isWritten);
  const existing = await getContinuity(deps.fs, deps.key, deps.personId, bookId);
  // Too short to have a shape yet — return what's stored, spend nothing.
  if (written.length < MIN_CHAPTERS_FOR_MANUSCRIPT) {
    return { ok: true, findings: existing.findings.filter((f) => f.status === 'pending') };
  }

  // The deterministic length picture rides along free (`manuscriptMetrics`) so the model judges pacing
  // against real word counts instead of guessing at them from the prose.
  const metrics = manuscriptMetrics(written);
  const byId = new Map(metrics.chapters.map((m) => [m.id, m]));
  const chaptersBlock = written
    .map((c) => {
      const m = byId.get(c.id);
      const words = m ? ` (${m.words.toLocaleString()} words)` : '';
      return `### ${c.title}${words}\n\n${c.markdown.trim()}`;
    })
    .join('\n\n---\n\n');

  const system = buildBiographerSystem(bookType, book.config, book.title);
  const user = [
    `You are reading ${book.title} straight through, as a whole book, the way an editor reads a manuscript before it goes out. You are NOT rewriting it and NOT proofreading it — you are naming the few things that are wrong at the level of the WHOLE, which no one can see one chapter at a time.`,
    ...(book.essence ? ['', `What this book is about: ${book.essence}`] : []),
    '',
    chaptersBlock,
    '',
    'Look for exactly these:',
    '- repetition — an image, phrase, scene, or observation that has now been used enough times that it has stopped landing. Name it and say where.',
    '- pacing — an era or episode given far more or far less room than it earns (the word counts are above). Say which, and which way.',
    '- arc — something the book sets up and never answers, a turn that arrives without being earned, or an ending that stops rather than lands.',
    '- voice — a stretch where the prose stops sounding like this person and starts sounding like a narrator of anyone.',
    '',
    'Report only what genuinely damages the book. A strong manuscript yields one or two findings, or none — do NOT invent findings to look thorough, and do not report line-level nits, typos, or anything fixable inside a single paragraph.',
    'Return ONE JSON object: { "findings": [ { "kind": "repetition"|"pacing"|"arc"|"voice", "summary": "one plain line naming the problem and where it is", "chapters": ["chapter title", …] }, … ] }.',
    'Return ONLY the JSON — no prose, no markdown fences. An empty findings array is correct for a book that holds together.',
  ].join('\n');

  const result = await runClaude(deps, system, user, 'book.manuscript', MANUSCRIPT_MAX_TOKENS);
  if (!result.ok)
    return { ok: false, findings: [], reason: result.reason, message: result.message };

  const json = extractJsonObject(result.text);
  if (!json) {
    const { reason, message } = classifyParseOutcome(result.text, 'findings');
    return { ok: false, findings: [], reason, message };
  }
  const drafts = ManuscriptDraftSchema.parse(json).findings;

  // Re-read live: `existing` predates the model call, so merging into it would revert a resolve/dismiss made
  // during the read. Append to the CURRENT list, de-duped against every stored finding.
  const live = await getContinuity(deps.fs, deps.key, deps.personId, bookId);
  const seen = new Set(live.findings.map((f) => findingSignature(f.kind, f.summary)));
  const additions: ContinuityFinding[] = [];
  for (const d of drafts) {
    const summary = d.summary.trim();
    if (!summary) continue;
    const sig = findingSignature(d.kind, summary);
    if (seen.has(sig)) continue;
    seen.add(sig);
    additions.push({
      id: uuid(),
      kind: d.kind,
      summary,
      chapters: d.chapters.filter((t) => t.trim().length > 0),
      status: 'pending',
      createdAt: deps.now.toISOString(),
    });
  }
  const merged = { schemaVersion: 1 as const, findings: [...live.findings, ...additions] };
  await saveContinuity(deps.fs, deps.key, deps.personId, bookId, merged);
  return { ok: true, findings: merged.findings.filter((f) => f.status === 'pending') };
}

export { MIN_CHAPTERS_FOR_MANUSCRIPT };

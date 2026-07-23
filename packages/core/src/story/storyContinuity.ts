import { z } from 'zod';
import { classifyParseOutcome, extractJsonObject, tolerantArray } from '../ai';
import { type AiDeps, runClaude } from '../questionnaires';
import { uuid } from '../id';
import {
  ContinuityKindSchema,
  type AiFailureReason,
  type BookChapter,
  type ContinuityFinding,
  type StoryContinuityResult,
} from '../schemas';
import { getBookType } from './bookTypes';
import { enforceProtected } from './storyMarkup';
import { buildBiographerSystem } from './storyPromptBuilder';
import { chapterParagraphs } from './storyText';
import {
  appendChapterVersion,
  getBook,
  getChapter,
  getContinuity,
  listChapters,
  saveChapter,
  saveContinuity,
} from './storyService';

/**
 * Cross-chapter continuity + line-edit (64-your-story §17.3, #294).
 *
 * `checkContinuity` is a metered read-only pass: it hands the biographer every written chapter's prose and asks
 * for name/date/fact inconsistencies ACROSS chapters, storing them as REVIEW ITEMS the author resolves. It
 * never rewrites anything — the owner's decision was "review items", so a finding is a prompt, not an edit.
 *
 * `lineEditChapter` is an OPT-IN, per-chapter metered pass that lightly polishes ONE chapter's prose (grammar,
 * flow) while keeping its meaning, the person's voice, and their protected/pinned words verbatim (code-enforced,
 * §5.3). It archives the pre-edit text to the chapter's history (`reason:'lineEdit'`), so it is fully reversible
 * through the existing History sheet.
 */

const CONTINUITY_MAX_TOKENS = 3000;
const LINE_EDIT_MAX_TOKENS = 8000;
/** A chapter is fair game for a continuity read once it has prose (not a bare shell). */
function isWritten(chapter: BookChapter): boolean {
  return chapter.markdown.trim().length > 0;
}

/** Tolerant: one malformed finding drops itself, never the whole set (37 §3.1). */
const FindingDraftSchema = z.object({
  kind: ContinuityKindSchema.catch('other'),
  summary: z.string().catch(''),
  chapters: z.array(z.string()).catch([]),
});
const ContinuityDraftSchema = z.object({
  findings: tolerantArray(
    FindingDraftSchema,
    { kind: 'other' as const, summary: '', chapters: [] },
    (f) => f.summary.trim().length > 0,
  ).catch([]),
});

/** De-dup key — a re-run must not re-add a finding the author already resolved/dismissed. */
function findingSignature(kind: string, summary: string): string {
  return `${kind}:${summary.trim().toLowerCase()}`;
}

/**
 * Run a continuity check across the book's written chapters (§17.3). Findings are APPENDED as pending review
 * items (de-duped against everything already stored, so a resolved/dismissed one never re-surfaces). Zero
 * findings is the healthy, common result — only an unparseable reply is a failure. Returns the pending set.
 */
export async function checkContinuity(
  deps: AiDeps,
  bookId: string,
): Promise<StoryContinuityResult> {
  const book = await getBook(deps.fs, deps.key, deps.personId, bookId);
  if (!book)
    return { ok: false, findings: [], reason: 'ERROR', message: 'That book is no longer here.' };
  const bookType = getBookType(book.type);
  if (!bookType) return { ok: false, findings: [], reason: 'ERROR', message: 'Unknown book type.' };

  const written = (await listChapters(deps.fs, deps.key, deps.personId, bookId)).filter(isWritten);
  const existing = await getContinuity(deps.fs, deps.key, deps.personId, bookId);
  // Fewer than two written chapters — there is nothing to be inconsistent ACROSS. Return what's stored, no spend.
  if (written.length < 2) {
    return { ok: true, findings: existing.findings.filter((f) => f.status === 'pending') };
  }

  const system = buildBiographerSystem(bookType, book.config, book.title);
  const chaptersBlock = written
    .map((c) => `### ${c.title}\n\n${c.markdown.trim()}`)
    .join('\n\n---\n\n');
  const user = [
    'You are PROOFREADING this book for CONTINUITY across its chapters — not rewriting it.',
    'Find genuine inconsistencies BETWEEN chapters: a person’s name spelled or given differently, a date or age',
    'that contradicts another, or a fact stated one way here and another way there. Only real contradictions —',
    'not style, not repetition, not a deliberate change over time. If the book is consistent, return none.',
    '',
    chaptersBlock,
    '',
    'Return ONE JSON object: { "findings": [ { "kind": "name"|"date"|"fact"|"other", "summary": "one plain line naming the inconsistency and where", "chapters": ["chapter title", …] }, … ] }.',
    'Return ONLY the JSON — no prose, no markdown fences. An empty findings array is correct when nothing conflicts.',
  ].join('\n');

  const result = await runClaude(deps, system, user, 'story.continuity', CONTINUITY_MAX_TOKENS);
  if (!result.ok)
    return { ok: false, findings: [], reason: result.reason, message: result.message };

  const json = extractJsonObject(result.text);
  if (!json) {
    const { reason, message } = classifyParseOutcome(result.text, 'findings');
    return { ok: false, findings: [], reason, message };
  }
  const drafts = ContinuityDraftSchema.parse(json).findings;

  // Re-read live: `existing` predates the model call, so a resolve/dismiss during the pass would be reverted by
  // merging into the stale list. Append to the CURRENT findings, de-duped against every stored one.
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

/** The book's PENDING continuity findings (resolved/dismissed stay stored for de-dup but aren't shown). */
export async function listContinuityFindings(
  fs: AiDeps['fs'],
  key: Uint8Array,
  personId: string,
  bookId: string,
): Promise<ContinuityFinding[]> {
  const list = await getContinuity(fs, key, personId, bookId);
  return list.findings.filter((f) => f.status === 'pending');
}

/** Resolve or dismiss a finding (§17.3) — author-driven, no rewrite. Returns the remaining pending findings. */
export async function resolveContinuityFinding(
  fs: AiDeps['fs'],
  key: Uint8Array,
  personId: string,
  args: { bookId: string; findingId: string; action: 'resolve' | 'dismiss' },
): Promise<ContinuityFinding[]> {
  const list = await getContinuity(fs, key, personId, args.bookId);
  const next = list.findings.map((f) =>
    f.id === args.findingId
      ? { ...f, status: args.action === 'resolve' ? ('resolved' as const) : ('dismissed' as const) }
      : f,
  );
  await saveContinuity(fs, key, personId, args.bookId, { schemaVersion: 1, findings: next });
  return next.filter((f) => f.status === 'pending');
}

export type LineEditResult =
  | { ok: true; chapter: BookChapter }
  | { ok: false; reason: AiFailureReason; message: string };

/**
 * Line-edit ONE chapter (§17.3) — a light polish (grammar, flow) that keeps the meaning, the person's voice, and
 * their protected/pinned words verbatim. Archives the pre-edit text (`reason:'lineEdit'`) so it's reversible.
 * Refuses a truncated reply (a half reply would replace the whole chapter). Provenance + freshness are carried
 * forward unchanged — a polish re-words prose, it does not re-source it.
 */
export async function lineEditChapter(
  deps: AiDeps,
  args: { bookId: string; chapterId: string },
): Promise<LineEditResult> {
  const book = await getBook(deps.fs, deps.key, deps.personId, args.bookId);
  if (!book) return { ok: false, reason: 'ERROR', message: 'That book is no longer here.' };
  const bookType = getBookType(book.type);
  if (!bookType) return { ok: false, reason: 'ERROR', message: 'Unknown book type.' };
  const existing = await getChapter(deps.fs, deps.key, deps.personId, args.bookId, args.chapterId);
  if (!existing || existing.markdown.trim().length === 0) {
    return { ok: false, reason: 'ERROR', message: 'That chapter has nothing to polish yet.' };
  }

  const preserve = [
    ...existing.protectedBlocks.map((b) => b.text),
    ...existing.pinnedQuotes.map((q) => q.text),
  ].filter((t) => t.trim().length > 0);

  const system = buildBiographerSystem(bookType, book.config, book.title);
  const user = [
    `Line-edit this ONE chapter of ${book.title}. Polish only: tighten grammar, smooth the flow, fix awkward`,
    'phrasing. Keep the meaning, the facts, and the person’s own voice. Do NOT add new events or details, do',
    'NOT cut scenes, and keep the same paragraphs in the same order.',
  ];
  if (preserve.length > 0) {
    user.push(
      '',
      'Keep these exact passages verbatim (the person’s own words — never reword or drop them):',
      ...preserve.map((t) => `- «${t}»`),
    );
  }
  user.push(
    '',
    `TITLE: ${existing.title}`,
    '',
    existing.markdown.trim(),
    '',
    'Return ONLY the revised chapter as Markdown prose (short paragraphs; you may use *italics*; no headings, no lists). No preamble, no fences.',
  );

  const result = await runClaude(
    deps,
    system,
    user.join('\n'),
    'story.lineEdit',
    LINE_EDIT_MAX_TOKENS,
  );
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
  if (result.truncated) {
    return {
      ok: false,
      reason: 'TRUNCATED',
      message: 'The polish was cut off before it finished. Please try again.',
    };
  }
  const polished = result.text.trim();
  if (polished.length === 0) {
    return { ok: false, reason: 'MALFORMED', message: 'The polish came back empty — try again.' };
  }

  // Re-read live (the call is slow; a placement/pin may have landed meanwhile), enforce the person's words in
  // code, and archive the pre-edit text before overwriting — the History sheet makes it undoable.
  const live =
    (await getChapter(deps.fs, deps.key, deps.personId, args.bookId, args.chapterId)) ?? existing;
  const enforced = enforceProtected(polished, live.protectedBlocks, live.pinnedQuotes);
  // Provenance + image placements are positional (`pN` = the Nth paragraph, resolved by index only, never by
  // content). A light polish keeps the paragraph structure, so they stay aligned; but if the polish merged,
  // split, or reordered paragraphs, the carried-forward anchors would describe the OLD layout — the reader's
  // "view source" and the biographer's source answers would cite the wrong paragraph. So keep them only when
  // the paragraph COUNT is unchanged; on a reflow, drop provenance to empty (honest "no sources" beats wrong
  // sources — a polish never re-sources anyway) and keep only placements whose anchor is still in range.
  const oldParas = chapterParagraphs(live.markdown).length;
  const newParas = chapterParagraphs(enforced.markdown).length;
  const reflowed = oldParas !== newParas;
  const provenance = reflowed ? [] : live.provenance;
  const imagePlacements = reflowed
    ? live.imagePlacements.filter((p) => {
        const m = /^p(\d+)$/.exec(p.afterAnchor);
        return m ? Number(m[1]) < newParas : false;
      })
    : live.imagePlacements;
  await appendChapterVersion(deps.fs, deps.key, deps.personId, args.bookId, args.chapterId, {
    revision: live.revision,
    markdown: live.markdown,
    provenance: live.provenance,
    sourceSignature: live.sourceSignature,
    savedAt: deps.now.toISOString(),
    reason: 'lineEdit',
  });
  const chapter: BookChapter = {
    ...live,
    markdown: enforced.markdown,
    provenance,
    imagePlacements,
    revision: live.revision + 1,
    status: 'updated',
    lastGeneratedAt: deps.now.toISOString(),
    previousMarkdown: live.markdown,
  };
  await saveChapter(deps.fs, deps.key, deps.personId, args.bookId, chapter);
  return { ok: true, chapter };
}

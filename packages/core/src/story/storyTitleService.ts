import { z } from 'zod';
import { classifyParseOutcome, extractJsonObject, tolerantArray } from '../ai';
import type { AiDeps } from '../questionnaires';
import { runClaude } from '../questionnaires';
import type { AiFailureReason } from '../schemas';
import { getBookType } from './bookTypes';
import { buildStoryCorpus, corpusText } from './storyCorpus';
import { buildBiographerSystem } from './storyPromptBuilder';
import { getBook, getExclusions } from './storyService';

/**
 * The title workshop (64 §16.4) — alternatives + re-suggest, and a standalone essence regeneration.
 *
 * Today the AI title is one-shot (only while `titleAuto`), and the essence can be re-derived ONLY via a
 * full rewrite-from-scratch, which discards every chapter. So re-reading the book's through-line costs the
 * whole draft (#302). This module adds two small, bounded, metered passes: one returns N title candidates
 * (a fresh pass on "suggest again"), the other regenerates just the essence and touches nothing else.
 *
 * Neither writes anything. `suggestTitles` returns candidates for the person to pick from; the caller
 * commits the chosen one through the existing `updateBook` path (which clears `titleAuto`). `regenerateEssence`
 * returns the new line; the caller saves it via `updateBook`, so a metered pass never mutates behind a
 * failed save.
 */

const TITLE_MAX_TOKENS = 600;
const ESSENCE_MAX_TOKENS = 400;
const TITLE_COUNT = 5;

/** Tolerant: one malformed candidate drops itself, never the whole set (37 §3.1). */
const TitleDraftSchema = z.object({
  titles: tolerantArray(z.object({ title: z.string().catch('') }), { title: '' }, () => true),
});

// Service-internal outcome unions (distinct from the flat IPC `StoryTitlesResult`/`StoryEssenceResult` in
// schemas.ts — the bridge destructures these into those). Named apart so a stray `@selfos/core/story` import
// can't silently pick up a different shape than the IPC one.
export type SuggestTitlesOutcome =
  | { ok: true; titles: string[] }
  | { ok: false; reason: AiFailureReason; message: string };

export type RegenerateEssenceOutcome =
  | { ok: true; essence: string }
  | { ok: false; reason: AiFailureReason; message: string };

/** The shared read: the book + its biographer voice + the corpus, exclusion-filtered. */
async function bookContext(
  deps: AiDeps,
  bookId: string,
): Promise<
  { ok: true; system: string; corpus: string; title: string } | { ok: false; message: string }
> {
  const book = await getBook(deps.fs, deps.key, deps.personId, bookId);
  if (!book) return { ok: false, message: 'That book is no longer here.' };
  const bookType = getBookType(book.type);
  if (!bookType) return { ok: false, message: 'Unknown book type.' };
  const corpus = await buildStoryCorpus(
    deps.fs,
    deps.key,
    deps.personId,
    bookId,
    await getExclusions(deps.fs, deps.key, deps.personId, bookId),
  );
  return {
    ok: true,
    system: buildBiographerSystem(bookType, book.config, corpus.personName),
    corpus: corpusText(corpus),
    title: book.title,
  };
}

/**
 * Propose N title candidates in ONE metered pass (§16.4) — cheapest per title, and the person compares a
 * set rather than judging one at a time. "Suggest again" is simply a fresh call. De-duped (case-insensitive)
 * and stripped of the current title, so "suggest again" doesn't hand back what they already have.
 */
export async function suggestTitles(deps: AiDeps, bookId: string): Promise<SuggestTitlesOutcome> {
  const ctx = await bookContext(deps, bookId);
  if (!ctx.ok) return { ok: false, reason: 'ERROR', message: ctx.message };

  const user = [
    `Propose ${TITLE_COUNT} possible titles for this book, drawn from what is actually in it.`,
    `The current title is "${ctx.title}" — offer genuinely different alternatives, not variations on it.`,
    'Evocative, true to the material, never a cliché or a generic life-story phrase. A short subtitle is fine as part of the title.',
    '',
    ctx.corpus,
    '',
    `Return ONE JSON object: { "titles": [ { "title": "…" }, … ] } with ${TITLE_COUNT} entries. Return ONLY the JSON — no prose, no markdown fences.`,
  ].join('\n');

  const result = await runClaude(deps, ctx.system, user, 'story.title', TITLE_MAX_TOKENS);
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };

  const json = extractJsonObject(result.text);
  if (!json) {
    const { reason, message } = classifyParseOutcome(result.text, 'titles');
    return { ok: false, reason, message };
  }
  const parsed = TitleDraftSchema.safeParse(json);
  const seen = new Set([ctx.title.trim().toLowerCase()]);
  const titles: string[] = [];
  for (const entry of parsed.success ? parsed.data.titles : []) {
    const title = entry.title.trim();
    const key = title.toLowerCase();
    if (title && !seen.has(key)) {
      seen.add(key);
      titles.push(title);
    }
  }
  if (titles.length === 0) {
    return { ok: false, reason: 'MALFORMED', message: 'No usable titles came back — try again.' };
  }
  return { ok: true, titles };
}

/**
 * Regenerate JUST the essence — the book's one-line through-line — in its own bounded pass (§16.4). The
 * essence steered chapter generation at foundations, so re-reading it used to require rewrite-from-scratch;
 * this touches nothing but the returned string, and the caller decides whether to keep it.
 */
export async function regenerateEssence(
  deps: AiDeps,
  bookId: string,
): Promise<RegenerateEssenceOutcome> {
  const ctx = await bookContext(deps, bookId);
  if (!ctx.ok) return { ok: false, reason: 'ERROR', message: ctx.message };

  const user = [
    'In ONE sentence, name the through-line of this book — the thread that runs through the whole life, the thing it is really about.',
    'Plain and true, not a tagline. Draw it from the material below, not a generic life-story theme.',
    '',
    ctx.corpus,
    '',
    'Return ONE JSON object: { "essence": "…" }. Return ONLY the JSON — no prose, no markdown fences.',
  ].join('\n');

  const result = await runClaude(deps, ctx.system, user, 'story.essence', ESSENCE_MAX_TOKENS);
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };

  const json = extractJsonObject(result.text);
  if (!json) {
    const { reason, message } = classifyParseOutcome(result.text, 'essence');
    return { ok: false, reason, message };
  }
  const essence = z
    .object({ essence: z.string().catch('') })
    .safeParse(json)
    .data?.essence.trim();
  if (!essence) {
    return { ok: false, reason: 'MALFORMED', message: 'No essence came back — try again.' };
  }
  return { ok: true, essence };
}

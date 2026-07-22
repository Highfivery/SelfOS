import type { OutlineChapter, StorySourceKind } from '../schemas';
import type { CorpusItem, StoryCorpus } from './storyCorpus';

/**
 * Corpus budgeting + per-chapter relevance slicing for generation (64-your-story §17.1, #297).
 *
 * Generation used to lay the WHOLE corpus into every chapter prompt: a long life both blew the context window
 * and diluted a chapter with material from unrelated eras/areas. This module is two pure, AI-free passes:
 *
 *  - `sliceCorpusForChapter` — score each source item's relevance to the chapter (life-area, era, keyword
 *    overlap) and keep the best within a token budget. A chapter with no strong matches still fills to budget
 *    (relevance only reorders; §7 keeps a thin corpus usable), so it degrades gracefully.
 *  - `budgetCorpus` — a whole-corpus cap for the foundations pass (which needs breadth, not a single chapter's
 *    slice): keep the outline-critical distilled/dated sources first (timeline, memories, insights) and trim
 *    the bulk raw material (the giant intake blob rides in distilled as an insight anyway) so a long life can't
 *    exceed the window.
 *
 * Token counts are a rough estimate (~4 chars/token) — enough to bound the prompt, never billed on. The
 * profile is always kept in full (small, identity) and never counted against the budget.
 */

/** ~4 characters per token — the standard rough heuristic; only ever used to BOUND a prompt, never to bill. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Source material a single chapter may draw on, before relevance slicing (§17.1). */
export const CHAPTER_CORPUS_TOKEN_BUDGET = 8000;
/** Whole-corpus cap for the foundations pass — generous (it needs the whole life) but bounded (§17.1). */
export const FOUNDATIONS_CORPUS_TOKEN_BUDGET = 40000;

/** Relevance weights (§17.1) — a life-area match matters most, then the era, then keyword overlap. */
const LIFE_AREA_WEIGHT = 3;
const ERA_WEIGHT = 2;
const MAX_KEYWORD_BONUS = 3;
/** Ignore short function words when measuring keyword overlap. */
const MIN_CONTENT_WORD_LEN = 4;

/** First 4-digit year in a string (an ISO date, a bare year, "the 1990s") — null when there isn't one. */
function yearOf(value: string | undefined): number | null {
  if (!value) return null;
  const m = value.match(/\d{4}/);
  return m ? Number(m[0]) : null;
}

/** Content words (≥4 chars, lowercased) for keyword overlap — drops short function words cheaply. */
function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= MIN_CONTENT_WORD_LEN) out.add(w);
  }
  return out;
}

/**
 * Relevance of one source item to a chapter (§17.1): a life-area match weighs most, then falling in the
 * chapter's era, then keyword overlap with its title + brief. Higher is more relevant; 0 means "no signal"
 * (still eligible to fill the budget, just last).
 */
export function scoreItemForChapter(item: CorpusItem, chapter: OutlineChapter): number {
  let score = 0;
  if (item.lifeArea && chapter.lifeAreas.includes(item.lifeArea)) score += LIFE_AREA_WEIGHT;

  const from = yearOf(chapter.eraFrom);
  const to = yearOf(chapter.eraTo);
  const itemYear = yearOf(item.date);
  if (itemYear !== null && (from !== null || to !== null)) {
    const afterStart = from === null || itemYear >= from;
    const beforeEnd = to === null || itemYear <= to;
    if (afterStart && beforeEnd) score += ERA_WEIGHT;
  }

  const chapterWords = contentWords(`${chapter.title} ${chapter.brief}`);
  if (chapterWords.size > 0) {
    let overlap = 0;
    for (const w of contentWords(item.text)) if (chapterWords.has(w)) overlap += 1;
    score += Math.min(overlap, MAX_KEYWORD_BONUS);
  }
  return score;
}

/**
 * Greedily keep items (in the given, already-ranked order) whose running token total stays within budget. Two
 * properties: (1) the FIRST (top-ranked) item is always kept even if it alone exceeds the budget — the most
 * relevant material must never be dropped for nothing, or for lower-ranked filler, and a chapter is never left
 * with zero source material; (2) after that, a large mid-list item that would overflow is skipped and the scan
 * continues, so it never blocks the smaller items after it.
 */
function fillWithinBudget(items: CorpusItem[], budget: number): CorpusItem[] {
  const kept: CorpusItem[] = [];
  let used = 0;
  for (const item of items) {
    const cost = estimateTokens(item.text);
    if (kept.length > 0 && used + cost > budget) continue;
    kept.push(item);
    used += cost;
  }
  return kept;
}

/**
 * Slice the corpus for ONE chapter: keep the most relevant items within `tokenBudget`, ordered by relevance
 * then chronology (so what survives also reads in time order). The profile is always kept in full.
 */
export function sliceCorpusForChapter(
  corpus: StoryCorpus,
  chapter: OutlineChapter,
  opts: { tokenBudget?: number } = {},
): StoryCorpus {
  const budget = opts.tokenBudget ?? CHAPTER_CORPUS_TOKEN_BUDGET;
  const ranked = corpus.items
    .map((item, i) => ({ item, i, score: scoreItemForChapter(item, chapter) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ay = yearOf(a.item.date);
      const by = yearOf(b.item.date);
      if (ay !== null && by !== null && ay !== by) return ay - by; // chronological tie-break
      return a.i - b.i; // otherwise stable
    })
    .map((r) => r.item);
  return { ...corpus, items: fillWithinBudget(ranked, budget) };
}

/** Outline-criticality for the foundations budget — distilled/dated sources survive a long life; the bulk
 *  raw intake (whose distilled portrait rides in as an insight) is trimmed first. */
const FOUNDATIONS_PRIORITY: Record<StorySourceKind, number> = {
  timeline: 9,
  memory: 8,
  insight: 7,
  goal: 6,
  dream: 5,
  challenge: 4,
  together: 4,
  response: 3,
  test: 3,
  photo: 2,
  intakeAnswer: 1,
};

/**
 * Cap the whole corpus for the foundations pass (§17.1). Under budget it's returned unchanged; over budget it
 * keeps the highest-priority sources (chronologically within a priority) so the timeline/insight spine the
 * outline is built from survives, and the bulk raw material trims first. The profile is always kept.
 */
export function budgetCorpus(
  corpus: StoryCorpus,
  opts: { tokenBudget?: number } = {},
): StoryCorpus {
  const budget = opts.tokenBudget ?? FOUNDATIONS_CORPUS_TOKEN_BUDGET;
  const total = corpus.items.reduce((sum, item) => sum + estimateTokens(item.text), 0);
  if (total <= budget) return corpus;

  const ranked = corpus.items
    .map((item, i) => ({ item, i, priority: FOUNDATIONS_PRIORITY[item.sourceRef.kind] }))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const ay = yearOf(a.item.date);
      const by = yearOf(b.item.date);
      if (ay !== null && by !== null && ay !== by) return ay - by;
      return a.i - b.i;
    })
    .map((r) => r.item);
  return { ...corpus, items: fillWithinBudget(ranked, budget) };
}

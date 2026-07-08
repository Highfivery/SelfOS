import type {
  Questionnaire,
  QuestionnaireSendState,
  QuestionnaireSentOverview,
} from '@shared/channels';

/** The lifecycle bucket a sent questionnaire falls into on the landing (08 §3.1) — drives the groups. */
export type SentStatus = 'draft' | 'awaiting' | 'answered' | 'analyzed';

/** A questionnaire + the reads that describe its state, assembled once in the page. */
export interface SentEntry {
  questionnaire: Questionnaire;
  sendState?: QuestionnaireSendState;
  overview?: QuestionnaireSentOverview;
  isDraft: boolean;
}

/** Which status group an entry belongs to. Unsent ⇒ Draft; otherwise by response/analysis state. */
export function sentStatusOf(e: SentEntry): SentStatus {
  if (!e.sendState) return 'draft';
  const answered = e.overview?.answeredCount ?? 0;
  if (answered === 0) return 'awaiting';
  if (e.overview?.analyzed && !e.overview.analyzableAssignmentId) return 'analyzed';
  return 'answered';
}

/** The status groups, in display order, with their labels. */
export const SENT_GROUPS: { status: SentStatus; label: string }[] = [
  { status: 'draft', label: 'Drafts' },
  { status: 'awaiting', label: 'Awaiting responses' },
  { status: 'answered', label: 'Answered · ready to analyze' },
  { status: 'analyzed', label: 'Analyzed' },
];

export type SentSort = 'recent' | 'answered' | 'title';

/** True when the questionnaire matches the (case-insensitive) search query — by title or type. */
export function matchesQuery(q: Questionnaire, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return q.title.toLowerCase().includes(needle) || (q.type ?? '').toLowerCase().includes(needle);
}

/** The value a sort key reads for an entry (the most-recent time, or the title). */
function sortValue(e: SentEntry, sort: SentSort): string {
  if (sort === 'title') return e.questionnaire.title.toLowerCase();
  if (sort === 'answered') return e.overview?.answeredAt ?? '';
  return e.sendState?.lastSentAt ?? e.questionnaire.updatedAt ?? '';
}

/**
 * Order entries within a group: favourites first (pinned to the top, 38 §13.8), then the chosen sort —
 * titles ascending, times descending (most recent first). Pure + stable.
 */
export function sortSent(entries: SentEntry[], sort: SentSort): SentEntry[] {
  return [...entries].sort((a, b) => {
    const favDelta = (b.questionnaire.favorite ? 1 : 0) - (a.questionnaire.favorite ? 1 : 0);
    if (favDelta !== 0) return favDelta;
    const av = sortValue(a, sort);
    const bv = sortValue(b, sort);
    if (av === bv) return 0;
    return sort === 'title' ? av.localeCompare(bv) : bv.localeCompare(av);
  });
}

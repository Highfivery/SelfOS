import type {
  AnswersUpdatedSummary,
  Insight,
  Person,
  Questionnaire,
  QuestionnaireSentOverview,
  ReminderDueSummary,
  ResponsesArrivedSummary,
} from '@shared/channels';
import { QUESTIONNAIRE_TYPES } from '../questionnaires/questionnaireTypes';

/**
 * Pure derivations for the Home "Questionnaires" section (59-questionnaires-dashboard). Everything here is a
 * function of data Home already holds — no AI, no I/O, no per-load spend — so the section is unit-testable and
 * carries no raw private answers (it reads only the derived overview / signals / the sender's own Insight).
 */

/** Cross-questionnaire rollup stats for the stat strip (§3.2). */
export interface QuestionnaireRollup {
  /** Distinct questionnaires with ≥1 send. */
  sentCount: number;
  /** Distinct recipients across all sends (the denominator of the response rate). */
  totalSends: number;
  /** Distinct recipients who have answered. */
  answeredSends: number;
  /** answered ÷ total, 0..1 (0 when nothing sent). */
  responseRate: number;
  /** Submitted responses not yet analysed (the "new replies" tile). */
  newReplies: number;
}

export function rollupStats(
  sentOverview: Record<string, QuestionnaireSentOverview>,
): QuestionnaireRollup {
  const entries = Object.values(sentOverview);
  let totalSends = 0;
  let answeredSends = 0;
  let newReplies = 0;
  for (const o of entries) {
    totalSends += o.recipients.length;
    answeredSends += o.answeredCount;
    newReplies += o.newResponses;
  }
  return {
    sentCount: entries.length,
    totalSends,
    answeredSends,
    responseRate: totalSends === 0 ? 0 : answeredSends / totalSends,
    newReplies,
  };
}

/** The latest questionnaire-derived Insight + the count, for the "latest insight" card (§3.4). */
export interface QuestionnaireInsightRollup {
  count: number;
  latest: { id: string; summary: string; aboutName?: string } | null;
}

export function questionnaireInsights(
  insights: Insight[],
  subjectPersonId: string | null,
): QuestionnaireInsightRollup {
  // Own approved questionnaire insights only — return empty for a null subject (defense-in-depth: never
  // surface a related person's insight summary).
  const own =
    subjectPersonId === null
      ? []
      : insights.filter(
          (i) =>
            i.source === 'questionnaire' && i.approved && i.subjectPersonId === subjectPersonId,
        );
  // Newest first by updatedAt (ISO strings sort lexicographically).
  const sorted = [...own].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  const top = sorted[0];
  return {
    count: own.length,
    latest: top
      ? {
          id: top.id,
          summary: top.summary,
          ...(top.provenance.aboutName ? { aboutName: top.provenance.aboutName } : {}),
        }
      : null,
  };
}

/** A chartable trend forming across the person's questionnaire insights (§3.4). */
export interface QuestionnaireTrend {
  /** A human label for the metric (e.g. "connection"). */
  label: string;
  /** Direction from the earliest to the latest reading. */
  direction: 'up' | 'down' | 'steady';
  /** How many time-points feed it (≥2). */
  points: number;
}

/** camelCase / snake_case metric key → a lowercase human phrase ("moodValence" → "mood valence"). */
function humanizeMetric(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
}

/**
 * A "trend forming" from the metrics on the person's own approved questionnaire insights (§3.4) — a metric key
 * that appears across ≥2 insights over time. Picks the metric with the most readings (tie → the most recently
 * updated), and reports its direction earliest→latest. Pure over already-loaded insights — no per-questionnaire
 * trends read, no spend. `null` when no metric has ≥2 readings (the trend half self-hides).
 */
export function questionnaireTrend(
  insights: Insight[],
  subjectPersonId: string | null,
): QuestionnaireTrend | null {
  if (subjectPersonId === null) return null;
  const own = insights.filter(
    (i) => i.source === 'questionnaire' && i.approved && i.subjectPersonId === subjectPersonId,
  );
  // metric key → time-ordered readings.
  const byMetric = new Map<string, { at: string; value: number }[]>();
  for (const i of own) {
    for (const [key, value] of Object.entries(i.metrics ?? {})) {
      const list = byMetric.get(key) ?? [];
      list.push({ at: i.updatedAt, value });
      byMetric.set(key, list);
    }
  }
  let best: { key: string; readings: { at: string; value: number }[] } | null = null;
  for (const [key, readings] of byMetric) {
    if (readings.length < 2) continue;
    if (
      !best ||
      readings.length > best.readings.length ||
      (readings.length === best.readings.length && latestAt(readings) > latestAt(best.readings))
    ) {
      best = { key, readings };
    }
  }
  if (!best) return null;
  const ordered = [...best.readings].sort((a, b) => a.at.localeCompare(b.at));
  const first = ordered[0]?.value ?? 0;
  const last = ordered[ordered.length - 1]?.value ?? 0;
  const direction = last > first ? 'up' : last < first ? 'down' : 'steady';
  return { label: humanizeMetric(best.key), direction, points: ordered.length };
}

function latestAt(readings: { at: string }[]): string {
  return readings.reduce((m, r) => (r.at > m ? r.at : m), '');
}

/** One actionable item in the "Needs you" list (§3.3). */
export type NeedsYouItem =
  | {
      kind: 'analyze';
      questionnaireId: string;
      assignmentId: string;
      title: string;
      recipientName: string;
    }
  | { kind: 'answer'; count: number }
  | {
      kind: 'reAnalyze';
      questionnaireId: string;
      assignmentId: string;
      title: string;
      recipientName: string;
    }
  | { kind: 'resend'; questionnaireId: string; title: string; recipientName: string };

/**
 * The ranked "Needs you" actions (§3.3), capped: analyze new responses > answer > re-analyze edited answers >
 * resend a stale link. Each signal is already gated + derived server-side (empty when the person lacks the
 * capability); `canAnswer` gates the inbox row. Analyze/re-analyze join the notification summary (title +
 * recipient) to `sentOverview` for the assignment id — so an already-analysed send (no `analyzableAssignmentId`)
 * never produces an analyze row.
 */
export function needsYou(input: {
  sentOverview: Record<string, QuestionnaireSentOverview>;
  responsesArrived: ResponsesArrivedSummary[];
  answersUpdated: AnswersUpdatedSummary[];
  remindersDue: ReminderDueSummary[];
  inboxCount: number;
  canAnswer: boolean;
  max?: number;
}): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];

  for (const r of input.responsesArrived) {
    const assignmentId = input.sentOverview[r.questionnaireId]?.analyzableAssignmentId;
    if (assignmentId) {
      items.push({
        kind: 'analyze',
        questionnaireId: r.questionnaireId,
        assignmentId,
        title: r.title,
        recipientName: r.latestRecipientName,
      });
    }
  }

  if (input.canAnswer && input.inboxCount > 0) {
    items.push({ kind: 'answer', count: input.inboxCount });
  }

  for (const a of input.answersUpdated) {
    items.push({
      kind: 'reAnalyze',
      questionnaireId: a.questionnaireId,
      assignmentId: a.assignmentId,
      title: a.title,
      recipientName: a.recipientName,
    });
  }

  for (const r of input.remindersDue) {
    items.push({
      kind: 'resend',
      questionnaireId: r.questionnaireId,
      title: r.title,
      recipientName: r.recipientName,
    });
  }

  return items.slice(0, input.max ?? 3);
}

/** An inviting subset of the starter taxonomy the variety nudge draws from (§3.5 / §11.3). `scenario` is
 * deliberately excluded — it's the "fun" idea's seed, so listing it here too would double-suggest it. */
const VARIETY_TYPES = ['appreciation', 'perspective', 'blind-spots', 'role-feedback'];

/**
 * The starter types (from the inviting subset) the person has authored+sent NONE of — drives the variety nudge
 * ("you haven't sent an Appreciation one yet"). Data-true, never manufactured.
 */
export function unsentTypes(
  questionnaires: Questionnaire[],
  sentOverview: Record<string, QuestionnaireSentOverview>,
): { value: string; label: string }[] {
  const sentTypes = new Set<string>();
  for (const q of questionnaires) {
    if (sentOverview[q.id]) sentTypes.add(q.type);
  }
  return QUESTIONNAIRE_TYPES.filter(
    (t) => VARIETY_TYPES.includes(t.value) && !sentTypes.has(t.value),
  );
}

/** The number of distinct starter types (the coverage denominator for "N of M tried", §3.6). */
export const STARTER_TYPE_COUNT = QUESTIONNAIRE_TYPES.length;

/** How many distinct starter types the person has actually SENT (the coverage numerator). */
export function sentTypeCount(
  questionnaires: Questionnaire[],
  sentOverview: Record<string, QuestionnaireSentOverview>,
): number {
  const sent = new Set<string>();
  for (const q of questionnaires) {
    if (sentOverview[q.id] && QUESTIONNAIRE_TYPES.some((t) => t.value === q.type)) sent.add(q.type);
  }
  return sent.size;
}

/** The warm engagement banner (§3.1a): what you've learned + who you haven't asked yet. */
export interface EngagementSummary {
  /** Own approved questionnaire insights — "you've gathered N insights". */
  insightCount: number;
  /** Distinct people those insights are about — "about N people". */
  peopleCount: number;
  /** Household people (excluding yourself) you've never sent a questionnaire to — the gentle "ask them" nudge. */
  notAsked: string[];
}

export function engagementSummary(
  insights: Insight[],
  people: Person[],
  sentOverview: Record<string, QuestionnaireSentOverview>,
  subjectPersonId: string | null,
): EngagementSummary {
  const nameById = new Map(people.map((p) => [p.id, p.displayName]));
  const own =
    subjectPersonId === null
      ? []
      : insights.filter(
          (i) =>
            i.source === 'questionnaire' && i.approved && i.subjectPersonId === subjectPersonId,
        );
  // The distinct people the insights are ABOUT — resolve a household `aboutPersonId` to its display NAME so an
  // external + a household reference to the same person don't count twice (a name-only namespace); self → "you".
  const aboutPeople = new Set<string>();
  for (const i of own) {
    const p = i.provenance;
    aboutPeople.add(
      p.aboutName ?? (p.aboutPersonId ? (nameById.get(p.aboutPersonId) ?? p.aboutPersonId) : 'you'),
    );
  }
  // Who you've sent to (recipient display names across all sends).
  const sentNames = new Set<string>();
  for (const o of Object.values(sentOverview)) {
    for (const r of o.recipients) sentNames.add(r.name);
  }
  const notAsked = people
    .filter((p) => p.id !== subjectPersonId && !sentNames.has(p.displayName))
    .map((p) => p.displayName);
  return { insightCount: own.length, peopleCount: aboutPeople.size, notAsked };
}

/** A rich "fresh insight" card (§3.4) — who it's about, which questionnaire, the finding, its life-area. */
export interface RichInsight {
  insightId: string;
  /** The questionnaire it came from. */
  title: string;
  /** Who the insight is ABOUT (the recipient); `null` for a self check-in ("from your answers"). */
  aboutName: string | null;
  summary: string;
  /** The life-area tag (first category), if any. */
  area: string | null;
  /** When it was answered/updated (ISO) — orders the cards. */
  at: string;
}

/**
 * The person's most recent analysed sends as rich insight cards (§3.4): join `sentOverview` (analysed entries,
 * with the recipient + insight id + summary) to the questionnaire TITLE and the derived Insight's life-area.
 * `aboutName` = the recipient a foreign send is about, or `null` for a self check-in (`aboutName`/`aboutPersonId`
 * both absent). Own insights only. Pure over already-loaded data — no raw answers, no per-send fetch.
 */
export function richInsights(
  sentOverview: Record<string, QuestionnaireSentOverview>,
  questionnaires: Questionnaire[],
  insights: Insight[],
  people: Person[],
  subjectPersonId: string | null,
  max = 2,
): RichInsight[] {
  if (subjectPersonId === null) return [];
  const titleById = new Map(questionnaires.map((q) => [q.id, q.title]));
  const insightById = new Map(insights.map((i) => [i.id, i]));
  const nameById = new Map(people.map((p) => [p.id, p.displayName]));
  const subjectName = nameById.get(subjectPersonId) ?? null;
  const out: RichInsight[] = [];
  for (const [qid, o] of Object.entries(sentOverview)) {
    if (!o.analyzed || !o.insightId || !o.insightSummary) continue;
    const insight = insightById.get(o.insightId);
    if (insight && insight.subjectPersonId !== subjectPersonId) continue; // own only
    if (insight && !insight.approved) continue; // match the approved-only "Insights" count
    const prov = insight?.provenance;
    const recipientName =
      o.recipients.find((r) => r.answered)?.name ?? o.recipients[0]?.name ?? null;
    // Who the insight is ABOUT: an external send carries `aboutName`; a household send carries `aboutPersonId`
    // (resolve to the display NAME so a multi-recipient send names the right person, not the first answerer);
    // else the recipient. A self check-in (about the subject) → null → "from your answers".
    const aboutName =
      prov?.aboutName ??
      (prov?.aboutPersonId ? (nameById.get(prov.aboutPersonId) ?? recipientName) : recipientName);
    const isSelf =
      (insight != null && !prov?.aboutName && !prov?.aboutPersonId) ||
      (aboutName != null && aboutName === subjectName);
    out.push({
      insightId: o.insightId,
      title: titleById.get(qid) ?? 'a questionnaire',
      aboutName: isSelf ? null : aboutName,
      summary: o.insightSummary,
      area: insight?.categories?.[0] ?? null,
      at: o.answeredAt ?? o.lastSentAt,
    });
  }
  return out.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')).slice(0, max);
}

/** A "go deeper from your recent activity" thread (§3.5a) — a session theme, a recurring dream, or a partner. */
export type GoDeeperTheme =
  | { kind: 'session'; area: string }
  | { kind: 'dream'; symbol: string }
  | { kind: 'together'; partnerName: string };

/**
 * Threads worth turning into a questionnaire, drawn from the person's recent activity (§3.5a) — pure over data
 * Home already holds (no AI, no spend): the most common life-area across recent SESSION insights, a recurring
 * DREAM symbol, and a Together partner. Each is a themed starting point; the specific AI-tailored draft happens
 * on tap in the builder ("Draft with AI"), so this covers both the free theme and the AI-specific path.
 */
export function goDeeperThemes(input: {
  sessionInsights: Insight[];
  dreamSymbols: { label: string; count: number }[];
  togetherPartnerName?: string;
}): GoDeeperTheme[] {
  const themes: GoDeeperTheme[] = [];
  // The most-mentioned life-area across recent session insights (a real recurring thread).
  const areaCounts = new Map<string, number>();
  for (const i of input.sessionInsights) {
    for (const c of i.categories ?? []) areaCounts.set(c, (areaCounts.get(c) ?? 0) + 1);
  }
  const topArea = [...areaCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topArea && topArea[1] >= 2) themes.push({ kind: 'session', area: topArea[0] });
  const symbol = input.dreamSymbols.find((s) => s.count >= 2);
  if (symbol) themes.push({ kind: 'dream', symbol: symbol.label });
  if (input.togetherPartnerName)
    themes.push({ kind: 'together', partnerName: input.togetherPartnerName });
  return themes.slice(0, 3);
}

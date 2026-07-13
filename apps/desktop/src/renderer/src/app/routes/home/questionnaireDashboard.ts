import type {
  AnswersUpdatedSummary,
  Insight,
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

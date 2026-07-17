import type { Insight, InsightSource } from '@shared/schemas';

/**
 * Where an insight came from + where its "view source" link goes (20-memory-dashboard §3.3). Sessions and
 * dreams deep-link to the specific item (via router state the target screen reads); questionnaires open
 * Results, onboarding opens the intake surface. A merged insight names how many moments it folds in.
 */
export interface ProvenanceTarget {
  /** Human label, e.g. "From a session" / "From onboarding" / "From “Intimacy check-in”" / "From 3 moments". */
  label: string;
  /** The route (with query for a questionnaire Results deep-link) to navigate to. */
  to: string;
  /** Router state the target screen reads to open the exact item (sessions/dreams/onboarding section). */
  state?: { focusConversationId?: string; focusDreamId?: string; openSection?: string };
  /** The originating id, if any — used to detect "source removed" against the loaded per-person stores. */
  source: { kind: 'session'; id: string } | { kind: 'dream'; id: string } | { kind: 'other' };
  /** The source questionnaire's title, when known — lets the card render the linked "From “<title>”". */
  sourceTitle?: string;
}

const SOURCE_NOUN: Record<InsightSource, string> = {
  session: 'a session',
  dream: 'a dream',
  questionnaire: 'a questionnaire',
  intake: 'onboarding',
  test: 'a self-assessment',
  together: 'a Together session',
};

export function provenanceTarget(insight: Insight): ProvenanceTarget {
  const extra = insight.contributingSources?.length ?? 0;
  const base = SOURCE_NOUN[insight.source];
  // After a merge, several moments fold into one ("from N moments"); otherwise name the single source.
  const label = extra > 0 ? `From ${extra + 1} moments` : `From ${base}`;

  if (insight.source === 'session' && insight.provenance.conversationId) {
    return {
      label,
      to: '/sessions',
      state: { focusConversationId: insight.provenance.conversationId },
      source: { kind: 'session', id: insight.provenance.conversationId },
    };
  }
  if (insight.source === 'dream' && insight.provenance.dreamId) {
    return {
      label,
      to: '/dreams',
      state: { focusDreamId: insight.provenance.dreamId },
      source: { kind: 'dream', id: insight.provenance.dreamId },
    };
  }
  if (insight.source === 'intake') {
    // "Edit answer" deep-links to the originating onboarding section (44 §3.4) — the Onboarding screen reads
    // `openSection` from router state and jumps there. Absent `intakeSection` → opens onboarding at the top.
    return {
      label,
      to: '/onboarding',
      ...(insight.provenance.intakeSection
        ? { state: { openSection: insight.provenance.intakeSection } }
        : {}),
      source: { kind: 'other' },
    };
  }
  if (insight.source === 'test') {
    // A self-assessment result deep-links to its result profile (50 §4.4) — the You hub reads `/you/:testId`.
    return {
      label,
      to: insight.provenance.testId ? `/you/${insight.provenance.testId}` : '/you',
      source: { kind: 'other' },
    };
  }
  // questionnaire + compatibility → the specific questionnaire's Results (62 §context). `insightsList`
  // enriches provenance with the as-sent title + live id (read-time); the Questionnaires route reads
  // `?focus=<id>&view=results`. Falls back to the generic Results list when the send/def is gone.
  if (insight.source === 'questionnaire') {
    const title = insight.provenance.sourceTitle?.trim();
    const qid = insight.provenance.sourceQuestionnaireId;
    return {
      label: title ? `From “${title}”` : label,
      to: qid ? `/questionnaires?focus=${encodeURIComponent(qid)}&view=results` : '/questionnaires',
      ...(title ? { sourceTitle: title } : {}),
      source: { kind: 'other' },
    };
  }
  return { label, to: '/questionnaires', source: { kind: 'other' } };
}

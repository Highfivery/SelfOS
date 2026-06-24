import type { Insight, InsightSource } from '@shared/schemas';

/**
 * Where an insight came from + where its "view source" link goes (20-memory-dashboard §3.3). Sessions and
 * dreams deep-link to the specific item (via router state the target screen reads); questionnaires open
 * Results, onboarding opens the intake surface. A merged insight names how many moments it folds in.
 */
export interface ProvenanceTarget {
  /** Human label, e.g. "From a session" / "From onboarding" / "From 3 moments". */
  label: string;
  /** The route to navigate to. */
  to: string;
  /** Router state the target screen reads to open the exact item (sessions/dreams/onboarding section). */
  state?: { focusConversationId?: string; focusDreamId?: string; openSection?: string };
  /** The originating id, if any — used to detect "source removed" against the loaded per-person stores. */
  source: { kind: 'session'; id: string } | { kind: 'dream'; id: string } | { kind: 'other' };
}

const SOURCE_NOUN: Record<InsightSource, string> = {
  session: 'a session',
  dream: 'a dream',
  questionnaire: 'a questionnaire',
  intake: 'onboarding',
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
  // questionnaire + compatibility → the questionnaire Results surface.
  return { label, to: '/questionnaires', source: { kind: 'other' } };
}

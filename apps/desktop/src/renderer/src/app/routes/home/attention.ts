import type {
  AgreementSummary,
  Goal,
  QuestionnaireSentOverview,
  TestResult,
  TogetherSessionSummary,
} from '@shared/schemas';
import { isGoalStale } from '@shared/schemas';
import { daysSince, RECHECKABLE_INSTRUMENTS } from './wellbeing';

/** Weekly cadence for the "you haven't checked in" nudge (the owner's ask — "at least once a week"). */
export const CHECK_IN_ATTENTION_DAYS = 7;
/** How long since your last questionnaire send before the soft "ask someone — it's been a while" nudge. */
export const SEND_QUESTIONNAIRE_STALE_DAYS = 30;

export type AttentionKind =
  | 'together-turn'
  | 'together-invite'
  | 'analyze-responses'
  | 'review-insights'
  | 'agreement'
  | 'check-in'
  | 'stale-goals'
  | 'send-questionnaire';

export interface AttentionItem {
  kind: AttentionKind;
  label: string;
  detail: string;
  route: string;
  state?: Record<string, unknown>;
  count?: number;
  /** A gentle NUDGE (not a genuinely-pending action from someone else) — suppressed under crisis / proactivity-off (§8). */
  nudge?: boolean;
}

export interface AttentionInput {
  now: number;
  activePersonId: string | null;
  goals: Goal[];
  /** Standing Together agreements across the person's pairs (spec 61) — surfaced as a gentle follow-through. */
  agreements: AgreementSummary[];
  sentOverview: Record<string, QuestionnaireSentOverview>;
  togetherSessions: TogetherSessionSummary[];
  resultsByTest: Record<string, TestResult[]>;
  insightDraftCount: number;
  otherPeopleCount: number;
  /** When true (recurring crisis OR proactivity off), the gentle nudges are dropped, leaving only genuinely-pending items (§8). */
  suppressNudges: boolean;
  can: {
    memory: boolean;
    tests: boolean;
    questionnaires: boolean;
    viewResults: boolean;
    together: boolean;
  };
}

/** The other participant's display name for a Together session (viewer excluded). */
function partnerName(session: TogetherSessionSummary, myId: string | null): string {
  return session.participants.find((p) => p.personId !== myId)?.displayName ?? 'your partner';
}

/**
 * The "Needs attention" queue (60-home-dashboard §3.1.2a) — the concrete things WAITING on the person, split
 * from the growth-oriented "For you" band so the same item never nags in two places. Ordered by urgency:
 * a Together turn / invite (someone's waiting) → a response to analyze → insights to review → the weekly
 * check-in nudge → stale goals → a soft "ask someone" nudge. The last three are gentle NUDGES, dropped when
 * `suppressNudges` (recurring crisis or proactivity off, §8), leaving only genuinely-pending actions. Pure.
 */
export function needsAttention(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const { now, activePersonId, can } = input;

  // Together — it's your turn (someone's waiting on you), else a pending invitation.
  if (can.together) {
    const yourTurn = input.togetherSessions.find((s) => s.yourTurn && s.status !== 'complete');
    if (yourTurn) {
      const name = partnerName(yourTurn, activePersonId);
      items.push({
        kind: 'together-turn',
        label: `It’s your turn with ${name}`,
        detail: 'Continue your Together session',
        route: '/together',
      });
    } else {
      const invite = input.togetherSessions.find(
        (s) => s.status === 'invited' && s.initiatorPersonId !== activePersonId,
      );
      if (invite) {
        const name = partnerName(invite, activePersonId);
        items.push({
          kind: 'together-invite',
          label: `${name} invited you to a session`,
          detail: 'Accept or decline',
          route: '/together',
        });
      }
    }
  }

  // Responses waiting to be turned into insight (a send was answered, not yet analysed).
  if (can.viewResults) {
    let toAnalyze = 0;
    for (const ov of Object.values(input.sentOverview)) toAnalyze += ov.newResponses;
    if (toAnalyze > 0) {
      items.push({
        kind: 'analyze-responses',
        label:
          toAnalyze === 1
            ? 'A response to turn into insight'
            : `${toAnalyze} responses to turn into insight`,
        detail: 'Analyze to see what it means',
        route: '/questionnaires',
        count: toAnalyze,
      });
    }
  }

  // Draft insights awaiting the person's review in Memory.
  if (can.memory && input.insightDraftCount > 0) {
    items.push({
      kind: 'review-insights',
      label:
        input.insightDraftCount === 1
          ? 'An insight to review'
          : `${input.insightDraftCount} insights to review`,
      detail: 'Approve or refine it in Memory',
      route: '/memory',
      count: input.insightDraftCount,
    });
  }

  // Standing Together agreements — a gentle follow-through reminder (spec 61). Clears as they're marked
  // done/retired (the actions live on the Goals card + /goals). A nudge, so it respects proactivity-off / crisis.
  if (can.together && input.agreements.length > 0) {
    const partners = new Set(input.agreements.map((a) => a.partnerPersonId));
    const only = input.agreements[0];
    const n = input.agreements.length;
    items.push({
      kind: 'agreement',
      label:
        partners.size === 1 && only
          ? `Following through with ${only.partnerName}`
          : 'Following through on your agreements',
      detail: n === 1 ? '1 standing agreement to keep up' : `${n} standing agreements to keep up`,
      route: '/goals',
      count: n,
      nudge: true,
    });
  }

  // The weekly mood/anxiety check-in nudge — only for someone who HAS checked in (opted in), never a first nag.
  if (can.tests) {
    let last: string | undefined;
    for (const id of RECHECKABLE_INSTRUMENTS) {
      const latest = input.resultsByTest[id]?.[0];
      if (latest && (last === undefined || latest.takenAt > last)) last = latest.takenAt;
    }
    if (last !== undefined) {
      const days = daysSince(last, now);
      if (days >= CHECK_IN_ATTENTION_DAYS) {
        items.push({
          kind: 'check-in',
          label: 'Check in on how you’re doing',
          detail: `It’s been ${days} days since your last check-in`,
          route: '/you/phq9/take',
          nudge: true,
        });
      }
    }
  }

  // Stale goals — a gentle "still on this?" (the actions live on the Goals card + /goals).
  if (can.memory) {
    const nowDate = new Date(now);
    const stale = input.goals.filter((g) => isGoalStale(g, nowDate));
    if (stale.length > 0) {
      items.push({
        kind: 'stale-goals',
        label:
          stale.length === 1 ? 'A goal needs a check-in' : `${stale.length} goals need a check-in`,
        detail: stale[0]?.text ?? '',
        route: '/goals',
        count: stale.length,
        nudge: true,
      });
    }
  }

  // Soft "it's been a while — ask someone" (only once they've sent before AND it's genuinely stale).
  if (can.questionnaires && input.otherPeopleCount > 0) {
    let lastSent = '';
    for (const ov of Object.values(input.sentOverview)) {
      if (ov.lastSentAt > lastSent) lastSent = ov.lastSentAt;
    }
    if (lastSent !== '' && daysSince(lastSent, now) >= SEND_QUESTIONNAIRE_STALE_DAYS) {
      items.push({
        kind: 'send-questionnaire',
        label: 'Ask someone what they think',
        detail: 'It’s been a while since you sent a questionnaire',
        route: '/questionnaires',
        state: { startNew: true },
        nudge: true,
      });
    }
  }

  return input.suppressNudges ? items.filter((i) => i.nudge !== true) : items;
}

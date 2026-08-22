import type { EmailClient, FileSystem } from '../host';
import type {
  EmailActivityEntry,
  EmailAnswerStance,
  EmailDeliveryStatus,
  EmailFamily,
  EmailPrefs,
  EmailReconcileResult,
} from '../schemas';
import { listConversations } from '../conversations/conversationService';
import { listDreams } from '../dreams/dreamService';
import { listGoals } from '../goals/goalService';
import { listInsightsForPerson, ownSubjectInsights } from '../insights/insightStore';
import { listAssignments } from '../questionnaires/assignmentService';
import { gatherRecipientFeedbackGuidance } from '../questionnaires/recipientHistory';
import { readLedger } from '../questionnaires/askLedger';
import { readProfile } from '../questionnaires/personalizationProfile';
import { buildTopicSteering, ensureTopics, topicStatuses } from '../questionnaires/topicMap';
import { listCoveredTopics } from '../questionnaires/coveredTopicsStore';
import { getSynthesis } from '../coaching/coachingSynthesisService';
import { computeMomentum } from '../recommendations/momentum';
import { stalestOpenGoal } from '../recommendations/providers';
import { buildActivityFeed } from '../home/feed';
import { computeStreak } from '../home/streak';
import { computeLifeRings } from '../home/rings';
import { generateRelayToken } from '../relay';
import { uuid } from '../id';
import { saveQuestionnaire, validateQuestionnaire } from '../questionnaires/questionnaireService';
import { createAssignment } from '../questionnaires/assignmentService';
import type { AiDeps } from '../questionnaires/aiCall';
import type { QuestionnaireInput } from '../schemas';
import { effectiveFamilyEnabled, readEmailPrefs } from './emailPrefs';
import { fromLineOf, readEmailConfig } from './emailConfig';
import { drainEmailTaps, mintEmailToken, type TapDrainer } from './emailResponse';
import { applyEmailCheckinAnswers } from './emailResponseEffects';
import { resolveIntimacyEmailTarget } from './emailIntimacy';
import { detectMilestones } from './emailMilestones';
import {
  buildAvoidSet,
  gatherSuggestionSignals,
  generateSuggestion,
  hasNewSuggestionData,
  listSentSuggestions,
  recordSentSuggestion,
  suggestionLookbackFloor,
  SUGGESTION_MAX_PER_WEEK,
  SUGGESTION_MIN_GAP_DAYS,
} from './emailSuggestionService';
import {
  buildDigestEmail,
  buildMilestoneEmail,
  buildQuestionnaireReminderEmail,
  buildReEngagementEmail,
  buildSuggestionEmail,
  type DigestContent,
  type ReEngagementContent,
} from './emailComposer';
import {
  listEmailActivity,
  sendFamilyEmail,
  sendQuestionnaireDeliveryEmail,
  updateEmailActivity,
} from './emailSend';

/** Phase-3 scheduling constants (67 §3.4; owner-confirmed thresholds). */
export const RE_ENGAGEMENT_AWAY_DAYS = 7;
export const RE_ENGAGEMENT_MIN_GAP_DAYS = 14;
export const QUESTIONNAIRE_REMINDER_DAYS = 3;
export const RECONCILE_THROTTLE_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 14;

const TIME_OF_DAY_HOUR: Record<EmailPrefs['digestTime'], number> = {
  morning: 8,
  afternoon: 14,
  evening: 19,
};

/** The de-dup source keys for each scheduled family (so the reconcile can find + cancel its own sends). */
const digestKey = (scheduledAt: string): string => `digest:${scheduledAt}`;
const REENGAGEMENT_KEY = 'reengagement:pending';
export const questionnaireReminderKey = (assignmentId: string): string =>
  `questionnaire-reminder:${assignmentId}`;

const iso = (ms: number): string => new Date(ms).toISOString();
const withinDays = (at: string | undefined, now: number, days: number): boolean =>
  at !== undefined && now - new Date(at).getTime() <= days * DAY_MS;

/**
 * Statuses that are NOT terminal — worth polling Resend for an update (67 §3.4).
 *
 * `opened` is in here because a click comes AFTER an open: Resend reports only the latest event, so an
 * entry that reached `opened` and stopped being polled could never progress to `clicked`. That, plus
 * the missing `clickedAt` stamp below, is why the owner view's Clicked column was permanently empty
 * despite `mapResendStatus` having always mapped the event.
 */
const POLLABLE_STATUSES = new Set<EmailDeliveryStatus>([
  'scheduled',
  'sent',
  'delivered',
  'opened',
]);
/** Only poll entries this recent — an old entry that never progressed is abandoned, not re-polled forever. */
const POLL_WINDOW_DAYS = 30;
/**
 * A scheduled email still pending delivery + not yet due to fire — the only kind the reconcile may
 * cancel/replace. The `scheduledAt > now` guard is load-bearing: once its time has passed Resend has
 * already sent it (even if the status poll hasn't caught up), so it must NOT be canceled or overwritten.
 */
const isLivePending = (e: EmailActivityEntry, nowMs: number): boolean =>
  e.status === 'scheduled' &&
  e.resendMessageId !== undefined &&
  e.scheduledAt !== undefined &&
  new Date(e.scheduledAt).getTime() > nowMs;

/** Map Resend's raw delivery-status string onto our `EmailDeliveryStatus` (67 §5.1; no webhook). */
export function mapResendStatus(raw: string): EmailDeliveryStatus | null {
  switch (raw) {
    case 'delivered':
      return 'delivered';
    case 'opened':
      return 'opened';
    case 'clicked':
      return 'clicked';
    case 'bounced':
    case 'bounce':
      return 'bounced';
    case 'complained':
    case 'complaint':
      return 'complained';
    case 'canceled':
    case 'cancelled':
      return 'canceled';
    case 'failed':
      return 'failed';
    case 'sent':
    case 'delivery_delayed':
      return 'sent';
    default:
      return null; // unknown/queued/scheduled — leave the entry as-is
  }
}

/**
 * The next weekly-digest send time (67 §3.2a) — the coming `digestDay` at the `digestTime` hour in the
 * person's LOCAL time, strictly in the future. Note: computed with the RECONCILING device's local clock,
 * which is the person's device in the single-user-per-device model.
 */
export function nextDigestAt(prefs: EmailPrefs, now: Date): string {
  const target = new Date(now.getTime());
  target.setHours(TIME_OF_DAY_HOUR[prefs.digestTime], 0, 0, 0);
  let deltaDays = (prefs.digestDay - target.getDay() + 7) % 7;
  if (deltaDays === 0 && target.getTime() <= now.getTime()) deltaDays = 7; // today's slot passed → next week
  target.setDate(target.getDate() + deltaDays);
  return target.toISOString();
}

/**
 * Gather the weekly digest's deterministic (no-AI) content host-side (67 §3.2 family C): the coaching
 * insight-of-the-week, a momentum line, a streak, a life-rings glance, and the recent activity. Returns
 * `null` when there's genuinely nothing to say (a brand-new/quiet week) — no empty digest is sent.
 */
export async function gatherDigestContent(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  now: Date,
): Promise<DigestContent | null> {
  const nowMs = now.getTime();
  const [synthesis, conversations, dreams, insights, goals] = await Promise.all([
    getSynthesis(fs, key, personId),
    listConversations(fs, key, personId),
    listDreams(fs, key, personId),
    listInsightsForPerson(fs, key, personId),
    listGoals(fs, key, personId),
  ]);

  // The "areas explored" momentum stat is about THIS person, so it counts own-subject only (#129).
  const sessionsRecent = conversations.filter((c) => withinDays(c.updatedAt, nowMs, 7)).length;
  const dreamsRecent = dreams.filter((d) => withinDays(d.createdAt, nowMs, 7)).length;
  const areasExplored = new Set(ownSubjectInsights(insights).flatMap((i) => i.categories)).size;
  const goalsMoving = goals.filter(
    (g) =>
      (g.status === 'open' || g.status === 'inProgress') &&
      withinDays(g.lastTouchedAt ?? g.updatedAt, nowMs, WINDOW_DAYS),
  ).length;

  const momentum = computeMomentum({
    showedUpThisWeek: sessionsRecent + dreamsRecent,
    areasExplored,
    goalsMovingForward: goalsMoving,
  });

  const streak = computeStreak({
    now,
    activity: [
      ...conversations.map((c) => c.updatedAt),
      ...dreams.map((d) => d.createdAt),
      ...goals.map((g) => g.lastTouchedAt ?? g.updatedAt),
    ],
  });

  const rings = computeLifeRings({
    signals: { sessionsRecent, dreamsRecent, areasExplored, goalsMoving },
  }).map((r) => ({ label: r.label, levelLabel: r.levelLabel, pct: r.pct }));

  const feed = buildActivityFeed({
    now,
    windowDays: WINDOW_DAYS,
    limit: 6,
    sessions: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status ?? 'inProgress',
      updatedAt: c.updatedAt,
    })),
    dreams: dreams.map((d) => ({
      id: d.id,
      ...(d.title ? { title: d.title } : {}),
      createdAt: d.createdAt,
    })),
    insights: insights.map((i) => ({
      id: i.id,
      summary: i.summary,
      approved: i.approved,
      createdAt: i.createdAt,
    })),
    goals: goals.map((g) => ({ id: g.id, text: g.text, status: g.status, updatedAt: g.updatedAt })),
  });

  const content: DigestContent = {
    ...(synthesis?.observation ? { insightOfWeek: synthesis.observation } : {}),
    ...(momentum.line ? { momentumLine: momentum.line } : {}),
    ...(streak.days > 0 ? { streakDays: streak.days } : {}),
    ...(rings.length > 0 ? { rings } : {}),
    ...(feed.length > 0
      ? {
          activity: feed.map((e) => ({
            title: e.title,
            ...(e.detail ? { detail: e.detail } : {}),
          })),
        }
      : {}),
  };

  // Nothing worth sending this week (brand-new / quiet) → no empty digest.
  const hasContent =
    content.insightOfWeek || content.momentumLine || content.streakDays || content.activity?.length;
  return hasContent ? content : null;
}

/**
 * Gather the single most relevant "something waiting" for a re-engagement nudge (67 §3.2 family D): a
 * waiting check-in the person hasn't answered, else a stale goal. Returns `null` when nothing's waiting
 * (so no nudge is sent to someone with a clean slate).
 */
export async function gatherReEngagement(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  now: Date,
): Promise<ReEngagementContent | null> {
  const [assignments, goals] = await Promise.all([
    listAssignments(fs, key, { recipientPersonId: personId }),
    listGoals(fs, key, personId),
  ]);

  const waiting = assignments.filter(
    (a) => a.status === 'sent' || a.status === 'opened' || a.status === 'inProgress',
  ).length;
  if (waiting > 0) {
    return {
      headline:
        waiting === 1
          ? 'You have a check-in waiting in SelfOS'
          : `You have ${waiting} check-ins waiting in SelfOS`,
      detail: 'They’re ready whenever you are — no rush.',
    };
  }

  const stale = stalestOpenGoal(goals, now);
  if (stale) {
    return {
      headline: 'A goal worth revisiting',
      detail: `A while back you set: “${stale.text}”. Still on your mind?`,
    };
  }

  return null;
}

/**
 * Family A — schedule a delivery reminder (67 §3.2 / Phase 3) for `QUESTIONNAIRE_REMINDER_DAYS` after a
 * questionnaire-delivery email, so it fires even if the sender's app is closed; the reconcile cancels it
 * once the recipient answers. Logged under the SENDER (like the delivery), to the recipient's contact
 * address. Idempotent on the assignment (a second delivery for the same assignment won't double-schedule).
 * Best-effort — a failure to schedule the reminder never fails the delivery.
 */
export async function scheduleQuestionnaireReminder(deps: {
  fs: FileSystem;
  key: Uint8Array;
  email: EmailClient;
  resendKey: string | undefined;
  senderPersonId: string;
  toAddress: string;
  originalSubject: string;
  assignmentId: string;
  now: Date;
}): Promise<void> {
  const sourceKey = questionnaireReminderKey(deps.assignmentId);
  const prior = await listEmailActivity(deps.fs, deps.key, deps.senderPersonId, {
    family: 'questionnaire-delivery',
  });
  // Already scheduled (or sent, or delivered) a reminder for this assignment → don't double up.
  if (
    prior.some((e) => e.sourceKey === sourceKey && e.status !== 'failed' && e.status !== 'canceled')
  )
    return;

  await sendQuestionnaireDeliveryEmail({
    fs: deps.fs,
    key: deps.key,
    email: deps.email,
    resendKey: deps.resendKey,
    senderPersonId: deps.senderPersonId,
    toAddress: deps.toAddress,
    composed: buildQuestionnaireReminderEmail({ originalSubject: deps.originalSubject }),
    scheduledAt: iso(deps.now.getTime() + QUESTIONNAIRE_REMINDER_DAYS * DAY_MS),
    sourceKey,
    now: deps.now,
  });
}

/** Cancel a scheduled Resend email + mark its activity entry canceled. Returns 1 when it canceled one. */
async function cancelScheduled(
  deps: {
    fs: FileSystem;
    key: Uint8Array;
    email: EmailClient;
    resendKey: string;
    personId: string;
  },
  entry: EmailActivityEntry,
): Promise<number> {
  if (!entry.resendMessageId) return 0;
  await deps.email.cancel(deps.resendKey, entry.resendMessageId);
  await updateEmailActivity(deps.fs, deps.key, deps.personId, (e) =>
    e.id === entry.id ? { ...e, status: 'canceled' } : e,
  );
  return 1;
}

/** How far ahead an AI suggestion is scheduled (67 §3.4) — a gentle delay so it reaches a closed app. */
const SUGGESTION_SCHEDULE_HOURS = 20;

/** Whether a suggestion body ASKS something — the bodies worth capturing as a real check-in (67 §3.3a). */
const asksAQuestion = (body: string): boolean => body.includes('?');

/**
 * Try to compose + schedule ONE AI Coach Suggestion for a family (67 §3.3 / Phase 5). Returns 1 when it
 * scheduled an email, else 0 (family off / no new data / de-dup'd / intimacy not eligible / model declined).
 * A `check-in` type mints a real self auto check-in assignment whose tappable options drain back + analyze.
 */
async function trySuggestion(ctx: {
  fs: FileSystem;
  key: Uint8Array;
  email: EmailClient;
  resendKey: string;
  personId: string;
  aiDeps: AiDeps;
  prefs: EmailPrefs;
  family: 'ai-suggestion' | 'ai-suggestion-intimacy';
  recipientName?: string | undefined;
  relay?: TapDrainer | undefined;
  relayEndpoint?: string | undefined;
  now: Date;
}): Promise<number> {
  const { fs, key, personId, family, prefs, aiDeps, now } = ctx;
  const nowMs = now.getTime();
  const intimacy = family === 'ai-suggestion-intimacy';

  if (!effectiveFamilyEnabled(prefs, family)) return 0;
  let intimacyTarget: Awaited<ReturnType<typeof resolveIntimacyEmailTarget>> = null;
  if (intimacy) {
    if (!prefs.intimacyEmailOptIn) return 0; // the distinct intimacy-email consent (§8.2)
    intimacyTarget = await resolveIntimacyEmailTarget(fs, key, personId);
    if (!intimacyTarget) return 0; // no eligible partner / no shared, consented signal
  }

  const history = await listSentSuggestions(fs, key, personId, family);
  const sinceAt = history[0]?.sentAt ? new Date(history[0].sentAt) : suggestionLookbackFloor(now);
  const signals = await gatherSuggestionSignals(fs, key, personId, sinceAt, now);
  if (!hasNewSuggestionData(signals, intimacyTarget?.overlap.length ?? 0)) return 0;

  const avoid = await buildAvoidSet(fs, key, personId, family, now);
  // Spec 69 P4 — email joins the ONE steering universe: the recipient's shared coverage + feedback guidance
  // (steer to new ground + honor declines) and the covered-topics worked elsewhere (questionnaires / story).
  // The email `avoid`-set (past suggestions + not-for-me/maybe-later) stays email-only on top.
  const [feedbackGuidance, covered] = await Promise.all([
    gatherRecipientFeedbackGuidance(fs, key, personId, now),
    // Covered-topics are keyed by (author, recipient); an email suggestion is self-directed, so both are the
    // person — the topics they've marked "already covered" for themselves.
    listCoveredTopics(fs, key, personId, personId),
  ]);
  // spec 71 §5.5 — `gatherRecipientFeedbackGuidance` is now BOUNDARIES ONLY (choosing ground moved to the
  // questionnaire planner, which an email suggestion doesn't run). Email keeps its novelty pressure by
  // building the same block from the ask ledger instead — now backed by REAL ask counts rather than an
  // AI-estimated depth, and across every life area since a suggestion isn't type-scoped.
  const [ledger, profile] = await Promise.all([
    readLedger(fs, key, personId),
    readProfile(fs, key, personId),
  ]);
  const statuses = topicStatuses({ topics: ensureTopics(profile.topics), ledger, now });
  const topicSteering = buildTopicSteering(statuses);
  // The intimacy families still open with this person — the subject matter for an intimacy suggestion, so it
  // can't nudge toward ground they have worked through (spec 71 §5.3). Same source as the steering above.
  const openIntimacy = statuses
    .filter((s) => s.open && s.topic.lifeArea === 'Intimacy')
    .map((s) => ({ label: s.topic.label, ...(s.topic.blurb ? { blurb: s.topic.blurb } : {}) }));
  const combinedGuidance = [feedbackGuidance, topicSteering]
    .filter((s) => s.trim() !== '')
    .join('\n\n');
  const steering = {
    ...(combinedGuidance.trim() ? { feedbackGuidance: combinedGuidance } : {}),
    ...(covered.length ? { coveredTopics: covered.map((t) => t.note) } : {}),
  };
  const generated = await generateSuggestion(aiDeps, {
    family,
    signals,
    avoid,
    ...(Object.keys(steering).length ? { steering } : {}),
    // ALWAYS passed, empty included: empty means "everything worked through", which the prompt states
    // plainly. Omitting it in that case is what let the seeded families back in.
    openGround: openIntimacy,
    ...(ctx.recipientName ? { recipientName: ctx.recipientName } : {}),
    ...(intimacyTarget
      ? {
          intimacyOverlap: intimacyTarget.overlap,
          partnerName: intimacyTarget.partnerName,
          partnerPersonId: intimacyTarget.partnerId,
          sharedSuggestionKey: intimacyTarget.sharedSuggestionKey,
        }
      : {}),
  });
  if (!generated) return 0;
  // NOTE: `runClaude` already records the `email.suggest` usage event internally — do NOT re-record it here
  // (that would double-count against the person's budget). `generated.usage` is returned only for tests.

  const { suggestion, sent } = generated;
  const interactionId = uuid();
  // A tap spends every token minted for the SAME interaction (its siblings are the other answers to one
  // question). "More / less like this" is a different interaction entirely — it says nothing about the
  // body — so it gets its own id; otherwise tapping "More like this" would throw away the answer buttons
  // and leave the minted check-in unanswerable from the email.
  const tuningInteractionId = uuid();
  const endpoint = ctx.relayEndpoint?.replace(/\/+$/, '');
  const mintedTokens: string[] = [];

  // Mint one interactive tap → a { label, url } button, when a relay is provisioned (§3.5). Without a relay
  // the suggestion still sends as a plain nudge (no buttons).
  const mintTap = async (
    kind: 'reaction' | 'intimacy-reaction' | 'checkin-answer' | 'tuning',
    answer: string,
    label: string,
    extra?: { questionId?: string; assignmentId?: string; stance?: EmailAnswerStance },
  ): Promise<{ label: string; url: string } | null> => {
    if (!ctx.relay || !endpoint) return null;
    const token = generateRelayToken();
    await mintEmailToken(fs, key, personId, {
      token,
      schemaVersion: 1,
      interactionId: kind === 'tuning' ? tuningInteractionId : interactionId,
      family,
      suggestionId: sent.id,
      ...(extra?.questionId ? { questionId: extra.questionId } : {}),
      ...(extra?.assignmentId ? { assignmentId: extra.assignmentId } : {}),
      kind,
      answer,
      // What the tap MEANS, since the words on it are written per email now (67 §3.3a).
      ...(extra?.stance ? { stance: extra.stance } : {}),
      ...(suggestion.sharedSuggestionKey
        ? { sharedSuggestionKey: suggestion.sharedSuggestionKey }
        : {}),
      mintedAt: now.toISOString(),
    });
    mintedTokens.push(token);
    return { label, url: `${endpoint}/t/${token}` };
  };

  let answers: { label: string; url: string }[] = [];
  let tuning: { label: string; url: string }[] = [];

  // The ONLY buttons a suggestion email carries are the model's own answers to its own body (67 §3.3a).
  // Reported twice (#459, #523): a question went out under "I'm game / Maybe later / Not for me". The first
  // fix added this answer path but left the fixed set as a fallback BELOW it, so any suggestion whose
  // answers were missing — every open question, the common case — fell straight back onto the reported
  // email. There is no fallback now: `generateSuggestion` refuses to return a suggestion without usable
  // answers, so by here there are always at least two, written for this body.
  if (ctx.relay && endpoint) {
    if (intimacy) {
      // An intimacy suggestion keeps its taps as reactions rather than minting a questionnaire: nothing
      // explicit should land in the Inbox as a check-in, and the drained response must stay at the
      // `intimacy` sensitivity tier (§8.2), which is derived from this kind.
      for (const answer of suggestion.options) {
        const tap = await mintTap('intimacy-reaction', answer.label, answer.label, {
          stance: answer.stance,
        });
        if (tap) answers.push(tap);
      }
    } else if (!asksAQuestion(suggestion.body)) {
      // A body that proposes rather than asks ("Notice one good moment today.") is answered, not filed:
      // minting a check-in for it would put a statement in the Inbox as a question, and bill an analysis
      // for it. Its answers are still the model's own, written for this body — only the capture differs.
      for (const answer of suggestion.options) {
        const tap = await mintTap('reaction', answer.label, answer.label, {
          stance: answer.stance,
        });
        if (tap) answers.push(tap);
      }
    } else {
      // A QUESTION is worth capturing: delivered as a real one-question self check-in, so the tap submits
      // a genuine answer that is analyzed like any other rather than merely acknowledged (§3.5).
      const questionId = uuid();
      const labels = suggestion.options.map((o) => o.label);
      const draft: QuestionnaireInput = {
        title: suggestion.headline,
        type: 'general',
        sensitivity: 'standard',
        recipient: { kind: 'person', personId },
        questions: [
          {
            id: questionId,
            type: 'singleChoice',
            prompt: suggestion.body,
            required: false,
            options: labels,
          },
        ],
      };
      try {
        // Defense in depth at the PRODUCER (#459). The options are already validated upstream by
        // `normalizeOptions` in the suggestion service, but this was the one questionnaire producer that ran
        // no validator of its own — every other (`autoCheckins`, `dreams`, `story`, the bridge) goes through
        // `generateQuestions`, which validates. A malformed draft is dropped rather than emailed.
        if (validateQuestionnaire(draft).length > 0) throw new Error('invalid check-in draft');
        const questionnaire = await saveQuestionnaire(fs, key, draft, personId);
        const assignment = await createAssignment(fs, key, {
          questionnaireId: questionnaire.id,
          senderPersonId: personId,
          recipient: { kind: 'person', personId },
          channel: 'inApp',
          privacy: 'standard',
          senderVisibleToRecipient: true,
        });
        for (const answer of suggestion.options) {
          const tap = await mintTap('checkin-answer', answer.label, answer.label, {
            questionId,
            assignmentId: assignment.id,
            stance: answer.stance,
          });
          if (tap) answers.push(tap);
        }
      } catch {
        // Minting the check-in failed. The answers still go out — as plain reactions carrying the SAME
        // labels, so the email always answers its own body; only the in-app capture is lost.
        answers = [];
        for (const answer of suggestion.options) {
          const tap = await mintTap('reaction', answer.label, answer.label, {
            stance: answer.stance,
          });
          if (tap) answers.push(tap);
        }
      }
    }
    // "More / less like this" is about the EMAIL, not the body — it never stands in for an answer, so it
    // rides alongside every suggestion rather than only the ones that had no answers.
    const t1 = await mintTap('tuning', 'more', 'More like this');
    const t2 = await mintTap('tuning', 'less', 'Less like this');
    tuning = [t1, t2].filter((t): t is { label: string; url: string } => t !== null);
  }

  await recordSentSuggestion(fs, key, personId, { ...sent, tokens: mintedTokens });

  const composed = buildSuggestionEmail({
    ...(ctx.recipientName ? { recipientName: ctx.recipientName } : {}),
    headline: suggestion.headline,
    body: suggestion.body,
    // The intimacy family's consent-aware secondary line (67 §8.2) — reassures WHY this reached the inbox.
    ...(intimacy
      ? {
          detail:
            'Built only from what you and your partner have both said you’re into — you can turn these off in Settings → Email.',
        }
      : {}),
    ...(answers.length > 0 ? { reactions: answers } : {}),
    ...(tuning.length > 0 ? { tuning } : {}),
  });
  const res = await sendFamilyEmail({
    fs,
    key,
    email: ctx.email,
    resendKey: ctx.resendKey,
    personId,
    family,
    composed,
    scheduledAt: iso(nowMs + SUGGESTION_SCHEDULE_HOURS * 60 * 60 * 1000),
    sourceKey: `suggestion:${sent.id}`,
    now,
  });
  return res.ok ? 1 : 0;
}

/**
 * The no-backend email cadence (67 §3.4 / Phase 3) — run on launch/focus while the app is open. It (1)
 * polls Resend for the delivery status of recently-sent emails and records it, (2) reconciles the weekly
 * digest (C) — schedules the coming one, cancels a stale/opted-out one, (3) reconciles the re-engagement
 * nudge (D) — (re)schedules it for `awayDays` out so it only fires if the app stays closed, respecting a
 * min-gap and only when something's waiting, and (4) cancels any questionnaire reminder (A) whose send has
 * since been answered. Scheduled sends use Resend's native `scheduledAt`, so they reach a closed app.
 */
export async function reconcileEmailSchedule(deps: {
  fs: FileSystem;
  key: Uint8Array;
  email: EmailClient;
  resendKey: string | undefined;
  personId: string;
  prefs: EmailPrefs | null;
  recipientName?: string;
  /** The relay tap-drain transport (Phase 4) — present only when a relay is provisioned. Enables the
   *  one-click interactive re-engagement email + draining its taps back into responses. */
  relay?: TapDrainer;
  /** The relay endpoint base (Phase 4) — for building `<endpoint>/t/<token>` one-click links. */
  relayEndpoint?: string;
  /** The AI bundle (Phase 5) — enables family E AI Coach Suggestions + analyzing an emailed check-in.
   *  Absent (AI off / no key) ⇒ no suggestion email is generated (never a dead surface). */
  ai?: { client: AiDeps['client']; apiKey: string | null; model: string; override?: boolean };
  now: Date;
}): Promise<EmailReconcileResult> {
  const { fs, key, email, resendKey, personId, now } = deps;
  const nowMs = now.getTime();

  const config = await readEmailConfig(fs, key);
  const from = fromLineOf(config);
  if (!resendKey || !from) return { ok: false, reason: 'NOT_CONFIGURED' };

  // The AI bundle for family E generation + analyzing an emailed check-in (Phase 5); null when AI is off.
  const aiDeps: AiDeps | null =
    deps.ai && deps.ai.apiKey
      ? {
          fs,
          key,
          client: deps.ai.client,
          apiKey: deps.ai.apiKey,
          model: deps.ai.model,
          personId,
          now,
          ...(deps.ai.override ? { override: true } : {}),
        }
      : null;

  // 0) Drain any one-click email taps back into responses (Phase 4) BEFORE gating — a `pause` tap that
  // turned off the re-engagement family must be reflected this same run, so re-read prefs after a drain.
  // A drained embedded check-in answer (Phase 5) is then submitted + analyzed like an in-app answer.
  let prefs = deps.prefs;
  if (deps.relay) {
    // The drain reaches the household's deployed Worker, so it can fail for reasons that have nothing to
    // do with the rest of the cadence — a relay that is offline, or (the common one) deployed at an older
    // RELAY_VERSION whose routes predate `/api/admin/drainTaps` (404). That must NOT abort the whole
    // reconcile: delivery-status polling, the digest, the re-engagement nudge and the reminder cancels are
    // all independent of taps. Taps are never lost — they stay in the relay's KV until a later run drains
    // them. The user-facing signal is Settings → Relay, which flags a stale relay + offers "Update relay".
    try {
      const drained = await drainEmailTaps(fs, key, personId, deps.relay, now);
      if (drained.length > 0) prefs = await readEmailPrefs(fs, key, personId);
      if (aiDeps) await applyEmailCheckinAnswers(aiDeps, personId);
    } catch {
      // fall through — the rest of the cadence still runs
    }
  }

  const scoped = { fs, key, email, resendKey, personId };
  let polled = 0;
  let scheduled = 0;
  let canceled = 0;

  // 1) Status poll — update recently-sent, non-terminal entries from Resend (no webhook). Bounded to a
  // recency window so an entry that never progressed isn't re-polled forever.
  const preActivity = await listEmailActivity(fs, key, personId);
  const pollable = preActivity.filter(
    (e) =>
      e.resendMessageId !== undefined &&
      POLLABLE_STATUSES.has(e.status) &&
      withinDays(e.sentAt ?? e.scheduledAt, nowMs, POLL_WINDOW_DAYS),
  );
  if (pollable.length > 0) {
    const polls = await email.status(
      resendKey,
      pollable.map((e) => e.resendMessageId as string),
    );
    const byId = new Map(polls.map((p) => [p.id, mapResendStatus(p.status)]));
    polled = await updateEmailActivity(fs, key, personId, (e) => {
      if (!e.resendMessageId) return e;
      const next = byId.get(e.resendMessageId);
      if (!next || next === e.status) return e;
      return {
        ...e,
        status: next,
        ...(next === 'delivered' && !e.deliveredAt ? { deliveredAt: now.toISOString() } : {}),
        ...(next === 'opened' && !e.openedAt ? { openedAt: now.toISOString() } : {}),
        // A click is a deliberate act and the only trustworthy engagement signal we get (an "open" can
        // be Apple Mail or Gmail pre-fetching the pixel). It was declared, rendered, and written by
        // nothing.
        ...(next === 'clicked' && !e.clickedAt ? { clickedAt: now.toISOString() } : {}),
      };
    });
  }

  // Re-read AFTER the poll — steps 2–4 must see the post-poll state (a just-fired scheduled email is now
  // `delivered`, not `scheduled`), so they never relabel a fired email or re-count it.
  const activity = await listEmailActivity(fs, key, personId);

  // 4) Cancel any not-yet-fired questionnaire reminder (A) whose assignment has since been answered.
  const scheduledReminders = activity.filter(
    (e) =>
      e.family === 'questionnaire-delivery' &&
      isLivePending(e, nowMs) &&
      e.sourceKey?.startsWith('questionnaire-reminder:'),
  );
  if (scheduledReminders.length > 0) {
    const answered = new Set(
      (await listAssignments(fs, key, {}))
        .filter((a) => a.status === 'submitted' || a.status === 'analyzed')
        .map((a) => a.id),
    );
    for (const reminder of scheduledReminders) {
      const assignmentId = reminder.sourceKey?.slice('questionnaire-reminder:'.length);
      if (assignmentId && answered.has(assignmentId)) {
        canceled += await cancelScheduled(scoped, reminder);
      }
    }
  }

  const engagementReady = Boolean(prefs?.address) && !prefs?.paused;

  // 2) Digest (C).
  const existingDigest = activity.find((e) => e.family === 'digest' && isLivePending(e, nowMs));
  if (engagementReady && prefs && effectiveFamilyEnabled(prefs, 'digest')) {
    const targetAt = nextDigestAt(prefs, now);
    if (existingDigest && existingDigest.scheduledAt !== targetAt) {
      canceled += await cancelScheduled(scoped, existingDigest);
    }
    if (!existingDigest || existingDigest.scheduledAt !== targetAt) {
      const content = await gatherDigestContent(fs, key, personId, now);
      if (content) {
        const composed = buildDigestEmail({
          ...content,
          ...(deps.recipientName ? { recipientName: deps.recipientName } : {}),
        });
        const res = await sendFamilyEmail({
          fs,
          key,
          email,
          resendKey,
          personId,
          family: 'digest',
          composed,
          scheduledAt: targetAt,
          sourceKey: digestKey(targetAt),
          now,
        });
        if (res.ok) scheduled += 1;
      }
    }
  } else if (existingDigest) {
    canceled += await cancelScheduled(scoped, existingDigest); // opted out / paused → cancel
  }

  // 3) Re-engagement (D) — (re)schedule for `awayDays` out; opening again pushes it back.
  const existingReeng = activity.find(
    (e) => e.family === 're-engagement' && isLivePending(e, nowMs),
  );
  // A re-engagement FIRED (its scheduledAt is in the past + it wasn't canceled before it fired) within the
  // min-gap → don't nudge again yet. Keyed on `scheduledAt` (the fire time), robust to the poll status +
  // to `sentAt` being the schedule-creation time. Canceled ones never fired, so they don't count.
  const reengFiredRecently = activity.some(
    (e) =>
      e.family === 're-engagement' &&
      e.status !== 'canceled' &&
      e.scheduledAt !== undefined &&
      new Date(e.scheduledAt).getTime() <= nowMs &&
      nowMs - new Date(e.scheduledAt).getTime() <= RE_ENGAGEMENT_MIN_GAP_DAYS * DAY_MS,
  );
  const reengContent =
    engagementReady &&
    prefs &&
    effectiveFamilyEnabled(prefs, 're-engagement') &&
    !reengFiredRecently
      ? await gatherReEngagement(fs, key, personId, now)
      : null;
  if (existingReeng) canceled += await cancelScheduled(scoped, existingReeng); // reschedule the pending one fresh
  if (reengContent) {
    // When a relay is provisioned, the nudge is tap-to-respond (Phase 4): mint one-click tokens for
    // "Come back" + "Pause these" and render them as buttons; a tap drains back on the next reconcile.
    let taps: { label: string; url: string }[] | undefined;
    if (deps.relay && deps.relayEndpoint) {
      const interactionId = uuid();
      const endpoint = deps.relayEndpoint.replace(/\/+$/, '');
      const mint = async (
        answer: string,
        label: string,
      ): Promise<{ label: string; url: string }> => {
        const token = generateRelayToken();
        await mintEmailToken(fs, key, personId, {
          token,
          schemaVersion: 1,
          interactionId,
          family: 're-engagement',
          kind: 'reaction',
          answer,
          mintedAt: now.toISOString(),
        });
        return { label, url: `${endpoint}/t/${token}` };
      };
      taps = [
        await mint('im-here', 'Come back to SelfOS'),
        await mint('pause', 'Pause these nudges'),
      ];
    }
    const composed = buildReEngagementEmail({
      ...reengContent,
      ...(deps.recipientName ? { recipientName: deps.recipientName } : {}),
      ...(taps ? { taps } : {}),
    });
    const res = await sendFamilyEmail({
      fs,
      key,
      email,
      resendKey,
      personId,
      family: 're-engagement',
      composed,
      scheduledAt: iso(nowMs + RE_ENGAGEMENT_AWAY_DAYS * DAY_MS),
      sourceKey: REENGAGEMENT_KEY,
      now,
    });
    if (res.ok) scheduled += 1;
  }

  // 5) AI Coach Suggestions (E / E-int) — at most SUGGESTION_MAX_PER_WEEK per person across BOTH E families,
  // spaced by SUGGESTION_MIN_GAP_DAYS, only when there's genuinely-new data + a metered call succeeds.
  const E_FAMILIES: EmailFamily[] = ['ai-suggestion', 'ai-suggestion-intimacy'];
  const eRecent = activity.filter(
    (e) =>
      E_FAMILIES.includes(e.family) &&
      e.status !== 'canceled' &&
      withinDays(e.sentAt ?? e.scheduledAt, nowMs, 7),
  );
  const eLivePending = activity.some(
    (e) => E_FAMILIES.includes(e.family) && isLivePending(e, nowMs),
  );
  const eGapClear = !eRecent.some((e) =>
    withinDays(e.sentAt ?? e.scheduledAt, nowMs, SUGGESTION_MIN_GAP_DAYS),
  );
  if (
    engagementReady &&
    aiDeps &&
    prefs &&
    !eLivePending &&
    eRecent.length < SUGGESTION_MAX_PER_WEEK &&
    eGapClear
  ) {
    // Prefer a non-intimacy suggestion; fall back to the gated intimacy slot. Only ONE E email per run.
    const sent =
      (await trySuggestion({
        fs,
        key,
        email,
        resendKey,
        personId,
        aiDeps,
        prefs,
        family: 'ai-suggestion',
        ...(deps.recipientName ? { recipientName: deps.recipientName } : {}),
        relay: deps.relay,
        relayEndpoint: deps.relayEndpoint,
        now,
      })) ||
      (await trySuggestion({
        fs,
        key,
        email,
        resendKey,
        personId,
        aiDeps,
        prefs,
        family: 'ai-suggestion-intimacy',
        ...(deps.recipientName ? { recipientName: deps.recipientName } : {}),
        relay: deps.relay,
        relayEndpoint: deps.relayEndpoint,
        now,
      }));
    scheduled += sent;
  }

  // 6) Milestones (F) — a deterministic celebration when a goal is reached / a streak crossed / a Story book
  // published. Sent immediately (the app is open), de-dup'd by sourceKey. Capped at ONE per run for restraint
  // (the rest trickle out over later runs), so a person who reached several at once isn't flooded.
  if (engagementReady && prefs && effectiveFamilyEnabled(prefs, 'milestone')) {
    const milestones = await detectMilestones(fs, key, personId, now);
    // "Sent exactly once" means once SUCCESSFULLY — a `failed` (or canceled) prior attempt is retryable, so a
    // transient Resend error never permanently swallows the celebration (the transactional-path rule).
    const alreadySent = new Set(
      activity
        .filter(
          (e): e is typeof e & { sourceKey: string } =>
            e.family === 'milestone' &&
            e.status !== 'canceled' &&
            e.status !== 'failed' &&
            e.sourceKey !== undefined,
        )
        .map((e) => e.sourceKey),
    );
    const next = milestones.find((m) => !alreadySent.has(m.sourceKey));
    if (next) {
      const composed = buildMilestoneEmail({
        ...(deps.recipientName ? { recipientName: deps.recipientName } : {}),
        headline: next.headline,
        detail: next.detail,
      });
      const res = await sendFamilyEmail({
        fs,
        key,
        email,
        resendKey,
        personId,
        family: 'milestone',
        composed,
        sourceKey: next.sourceKey,
        now,
      });
      if (res.ok) scheduled += 1;
    }
  }

  return { ok: true, polled, scheduled, canceled };
}

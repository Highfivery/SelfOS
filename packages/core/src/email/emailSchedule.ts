import type { EmailClient, FileSystem } from '../host';
import type {
  EmailActivityEntry,
  EmailDeliveryStatus,
  EmailPrefs,
  EmailReconcileResult,
} from '../schemas';
import { listConversations } from '../conversations/conversationService';
import { listDreams } from '../dreams/dreamService';
import { listGoals } from '../goals/goalService';
import { listInsightsForPerson } from '../insights/insightStore';
import { listAssignments } from '../questionnaires/assignmentService';
import { getSynthesis } from '../coaching/coachingSynthesisService';
import { aggregateCrisisSignal } from '../coaching/crisisSignal';
import { computeMomentum } from '../recommendations/momentum';
import { stalestOpenGoal } from '../recommendations/providers';
import { buildActivityFeed } from '../home/feed';
import { computeStreak } from '../home/streak';
import { computeLifeRings } from '../home/rings';
import { generateRelayToken } from '../relay';
import { uuid } from '../id';
import { effectiveFamilyEnabled, readEmailPrefs } from './emailPrefs';
import { fromLineOf, readEmailConfig } from './emailConfig';
import { drainEmailTaps, mintEmailToken, type TapDrainer } from './emailResponse';
import {
  buildDigestEmail,
  buildQuestionnaireReminderEmail,
  buildReEngagementEmail,
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

/** Statuses that are NOT terminal — worth polling Resend for an update (67 §3.4). */
const POLLABLE_STATUSES = new Set<EmailDeliveryStatus>(['scheduled', 'sent', 'delivered']);
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

  const crisis = aggregateCrisisSignal({ insights, now, nightmareNudge: false }).recurring;

  const sessionsRecent = conversations.filter((c) => withinDays(c.updatedAt, nowMs, 7)).length;
  const dreamsRecent = dreams.filter((d) => withinDays(d.createdAt, nowMs, 7)).length;
  const areasExplored = new Set(insights.flatMap((i) => i.categories)).size;
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
    crisis,
  });

  const rings = crisis
    ? []
    : computeLifeRings({
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
  crisisSuppressed: boolean;
  /** The relay tap-drain transport (Phase 4) — present only when a relay is provisioned. Enables the
   *  one-click interactive re-engagement email + draining its taps back into responses. */
  relay?: TapDrainer;
  /** The relay endpoint base (Phase 4) — for building `<endpoint>/t/<token>` one-click links. */
  relayEndpoint?: string;
  now: Date;
}): Promise<EmailReconcileResult> {
  const { fs, key, email, resendKey, personId, now } = deps;
  const nowMs = now.getTime();

  const config = await readEmailConfig(fs, key);
  const from = fromLineOf(config);
  if (!resendKey || !from) return { ok: false, reason: 'NOT_CONFIGURED' };

  // 0) Drain any one-click email taps back into responses (Phase 4) BEFORE gating — a `pause` tap that
  // turned off the re-engagement family must be reflected this same run, so re-read prefs after a drain.
  let prefs = deps.prefs;
  if (deps.relay) {
    const drained = await drainEmailTaps(fs, key, personId, deps.relay, now);
    if (drained.length > 0) prefs = await readEmailPrefs(fs, key, personId);
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

  const engagementReady = Boolean(prefs?.address) && !prefs?.paused && !deps.crisisSuppressed;

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
          crisisSuppressed: false, // gated above by engagementReady (crisis already excluded)
          scheduledAt: targetAt,
          sourceKey: digestKey(targetAt),
          now,
        });
        if (res.ok) scheduled += 1;
      }
    }
  } else if (existingDigest) {
    canceled += await cancelScheduled(scoped, existingDigest); // opted out / crisis / paused → cancel
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
      crisisSuppressed: false,
      scheduledAt: iso(nowMs + RE_ENGAGEMENT_AWAY_DAYS * DAY_MS),
      sourceKey: REENGAGEMENT_KEY,
      now,
    });
    if (res.ok) scheduled += 1;
  }

  return { ok: true, polled, scheduled, canceled };
}

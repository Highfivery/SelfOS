import type { ActivityEvent, ActivityFeedInput } from './schemas';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 14;
const DEFAULT_LIMIT = 8;

/** Trim a long detail line so a feed row stays compact (the renderer also clamps). */
function short(text: string, max = 80): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Build an event, omitting `detail`/`route` when undefined (exactOptionalPropertyTypes). */
function make(e: {
  id: string;
  domain: ActivityEvent['domain'];
  title: string;
  at: string;
  actionable: boolean;
  detail: string | undefined;
  route: string | undefined;
}): ActivityEvent {
  return {
    id: e.id,
    domain: e.domain,
    title: e.title,
    at: e.at,
    actionable: e.actionable,
    ...(e.detail ? { detail: e.detail } : {}),
    ...(e.route ? { route: e.route } : {}),
  };
}

/**
 * Merge recent cross-feature events into one "recent across everything" stream (60 §3.1.6). Pure: it maps
 * each already-loaded store slice into `ActivityEvent`s, keeps only those within the rolling window (default
 * 14d, never future), sorts newest-first, dedupes by id, and caps (default 8). Actionable entries (needs
 * review / your turn / check-in due / someone answered) are flagged so the renderer can emphasize them.
 *
 * Routes come from the confirmed router paths; a challenge check-in has no dedicated route (it's handled by
 * the on-page Challenge card) so its `route` is omitted and the renderer renders it non-navigating.
 */
export function buildActivityFeed(input: ActivityFeedInput): ActivityEvent[] {
  const nowMs = input.now.getTime();
  const windowMs = (input.windowDays ?? DEFAULT_WINDOW_DAYS) * MS_PER_DAY;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const events: ActivityEvent[] = [];

  for (const c of input.sessions ?? []) {
    events.push(
      make({
        id: `session:${c.id}`,
        domain: 'session',
        title: c.status === 'complete' ? 'You wrapped up a session' : 'You worked on a session',
        detail: c.title ? short(c.title) : undefined,
        at: c.updatedAt,
        route: '/sessions',
        actionable: false,
      }),
    );
  }

  for (const d of input.dreams ?? []) {
    events.push(
      make({
        id: `dream:${d.id}`,
        domain: 'dream',
        title: 'You logged a dream',
        detail: d.title ? short(d.title) : undefined,
        at: d.createdAt,
        route: '/dreams',
        actionable: false,
      }),
    );
  }

  for (const i of input.insights ?? []) {
    if (i.approved) continue; // approved = captured memory; only drafts are "needs review"
    events.push(
      make({
        id: `insight:${i.id}`,
        domain: 'insight',
        title: 'New insight to review',
        detail: i.summary ? short(i.summary) : undefined,
        at: i.createdAt,
        route: '/memory',
        actionable: true,
      }),
    );
  }

  for (const item of input.inbox ?? []) {
    if (!item.answerable || item.fromSelf) continue;
    events.push(
      make({
        id: `inbox:${item.assignmentId}`,
        domain: 'inbox',
        title: `${item.senderName} sent you a check-in`,
        detail: item.title ? short(item.title) : undefined,
        at: item.createdAt,
        route: '/inbox',
        actionable: true,
      }),
    );
  }

  for (const o of input.sentOverview ?? []) {
    if (o.newResponses <= 0) continue;
    events.push(
      make({
        id: `questionnaire:${o.questionnaireId}`,
        domain: 'questionnaire',
        title: o.recipientName
          ? `${o.recipientName} answered your questionnaire`
          : 'New questionnaire responses',
        detail: o.newResponses > 1 ? `${o.newResponses} new answers` : undefined,
        at: o.answeredAt ?? o.lastSentAt,
        route: '/questionnaires',
        actionable: true,
      }),
    );
  }

  for (const t of input.together ?? []) {
    if (!t.yourTurn) continue;
    events.push(
      make({
        id: `together:${t.id}`,
        domain: 'together',
        title: t.partnerName ? `${t.partnerName} replied` : 'Your turn in a session',
        detail: t.unreadCount > 0 ? `Your turn · ${t.unreadCount} unread` : 'Your turn',
        at: t.lastMessageAt ?? t.createdAt,
        route: '/together',
        actionable: true,
      }),
    );
  }

  for (const c of input.challenges ?? []) {
    if (c.status !== 'active' || !c.checkInAt) continue;
    const due = Date.parse(c.checkInAt);
    if (Number.isNaN(due) || due > nowMs) continue; // only surface once actually due
    events.push(
      make({
        id: `challenge:${c.id}`,
        domain: 'challenge',
        title: 'Challenge check-in due',
        detail: c.action ? short(c.action) : undefined,
        at: c.checkInAt,
        route: undefined, // no dedicated route — the on-page Challenge card handles it
        actionable: true,
      }),
    );
  }

  for (const g of input.goals ?? []) {
    if (g.status !== 'done') continue;
    events.push(
      make({
        id: `goal:${g.id}`,
        domain: 'goal',
        title: 'You completed a goal',
        detail: g.text ? short(g.text) : undefined,
        at: g.updatedAt,
        route: '/memory',
        actionable: false,
      }),
    );
  }

  for (const m of input.moodCheckIns ?? []) {
    events.push(
      make({
        id: `wellbeing:${m.at}`,
        domain: 'wellbeing',
        title: 'You checked in on your mood',
        detail: undefined,
        at: m.at,
        route: '/you',
        actionable: false,
      }),
    );
  }

  // Keep only parseable, in-window, non-future events; sort newest-first; dedupe by id; cap.
  const seen = new Set<string>();
  return events
    .filter((e) => {
      const t = Date.parse(e.at);
      return !Number.isNaN(t) && t <= nowMs && nowMs - t <= windowMs;
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .slice(0, limit);
}

import type { FileSystem } from '../host';
import { effectiveGoalStatus } from '../schemas';
import { listGoals } from '../goals/goalService';
import { listConversations } from '../conversations/conversationService';
import { listDreams } from '../dreams/dreamService';
import { listBooks } from '../books/storyService';
import { listInsightsForPerson } from '../insights/insightStore';
import { computeStreak } from '../home/streak';
import { aggregateCrisisSignal } from '../coaching/crisisSignal';

/**
 * Milestone detection for family F (67 §3.2) — deterministic, no AI. A milestone is a genuine, celebratory
 * moment worth an email: a goal reached, a streak crossed, a Story book published ("ready to read"). Each
 * carries a STABLE `sourceKey` so `sendFamilyEmail`'s idempotency sends it exactly once. Nothing is sent
 * here — the reconcile does that, gated on the family opt-in + engagement readiness (crisis-suppressed, §7).
 */

/** The streak lengths worth celebrating (days). */
export const STREAK_MILESTONES = [7, 30, 100, 365];

export interface EmailMilestone {
  kind: 'goal' | 'streak' | 'story';
  /** Stable de-dup key (67 §4.3) — the reconcile sends each milestone once. */
  sourceKey: string;
  headline: string;
  detail: string;
}

/**
 * Detect the person's currently-reached milestones (67 §3.2 family F). Deterministic. A crisis suppresses
 * the streak (a struggling person is never streak-shamed, §8); goals + a published book still count (they're
 * unambiguously positive, and the reconcile's own crisis gate suppresses the SEND anyway).
 */
export async function detectMilestones(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  now: Date,
): Promise<EmailMilestone[]> {
  const [goals, conversations, dreams, books, insights] = await Promise.all([
    listGoals(fs, key, personId),
    listConversations(fs, key, personId),
    listDreams(fs, key, personId),
    listBooks(fs, key, personId),
    listInsightsForPerson(fs, key, personId),
  ]);
  const crisis = aggregateCrisisSignal({ insights, now, nightmareNudge: false }).recurring;
  const out: EmailMilestone[] = [];

  // Goals reached — one celebration per done goal.
  for (const g of goals) {
    if (effectiveGoalStatus(g, now) === 'done')
      out.push({
        kind: 'goal',
        sourceKey: `milestone:goal:${g.id}`,
        headline: 'You reached a goal',
        detail: g.text,
      });
  }

  // Streak — only the HIGHEST threshold reached (never a retroactive burst of 7/30/… at once).
  const streak = computeStreak({
    now,
    activity: [
      ...conversations.map((c) => c.updatedAt),
      ...dreams.map((d) => d.createdAt),
      ...goals.map((g) => g.lastTouchedAt ?? g.updatedAt),
    ],
    crisis,
  });
  const top = STREAK_MILESTONES.filter((t) => streak.days >= t).pop();
  if (top !== undefined)
    out.push({
      kind: 'streak',
      sourceKey: `milestone:streak:${top}`,
      headline: `A ${top}-day streak`,
      detail: `You’ve shown up on SelfOS ${streak.days} day${streak.days === 1 ? '' : 's'} in a row.`,
    });

  // Published Story book — "ready to read". Keyed by publishedAt so a re-publish re-celebrates.
  for (const b of books) {
    if (b.publishedAt)
      out.push({
        kind: 'story',
        sourceKey: `milestone:story:${b.id}:${b.publishedAt}`,
        headline: 'Your book is ready to read',
        detail: b.title,
      });
  }

  return out;
}

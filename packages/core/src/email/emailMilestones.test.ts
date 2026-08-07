import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { saveGoal } from '../goals/goalService';
import { saveConversation } from '../conversations/conversationService';
import { saveInsight } from '../insights/insightStore';
import type { Conversation, Goal, Insight } from '../schemas';
import { detectMilestones } from './emailMilestones';

const key = generateMasterKey();
const now = new Date('2026-09-15T12:00:00.000Z');
const PERSON = 'me';

function doneGoal(id: string, text: string): Goal {
  return {
    id,
    schemaVersion: 1,
    subjectPersonId: PERSON,
    text,
    status: 'done',
    provenance: { at: '2026-09-01T00:00:00.000Z' },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
  };
}

function conversationOn(id: string, iso: string): Conversation {
  return {
    id,
    schemaVersion: 1,
    personId: PERSON,
    title: id,
    createdAt: iso,
    updatedAt: iso,
    messages: [],
  };
}

function crisisInsight(id: string, iso: string): Insight {
  return {
    id,
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: PERSON,
    summary: 's',
    facts: [],
    confidence: 'medium',
    categories: ['Emotions & patterns'],
    approved: true,
    crisisFlag: true,
    provenance: { at: iso },
    createdAt: iso,
    updatedAt: iso,
  };
}

/** Seed N consecutive days of activity ending today, so `computeStreak` reads a streak of >= N. */
async function seedStreak(fs: ReturnType<typeof memFileSystem>, days: number) {
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    await saveConversation(fs, key, conversationOn(`c${i}`, d.toISOString()));
  }
}

describe('detectMilestones (67 §3.2 family F)', () => {
  it('celebrates a reached goal', async () => {
    const fs = memFileSystem();
    await saveGoal(fs, key, doneGoal('g1', 'Run a 5k'));
    const ms = await detectMilestones(fs, key, PERSON, now);
    expect(ms.some((m) => m.kind === 'goal' && m.detail === 'Run a 5k')).toBe(true);
    expect(ms.find((m) => m.kind === 'goal')?.sourceKey).toBe('milestone:goal:g1');
  });

  it('emits only the HIGHEST streak threshold reached (never a retroactive burst)', async () => {
    const fs = memFileSystem();
    await seedStreak(fs, 35); // past both 7 and 30
    const ms = await detectMilestones(fs, key, PERSON, now);
    const streaks = ms.filter((m) => m.kind === 'streak');
    expect(streaks).toHaveLength(1);
    expect(streaks[0]?.sourceKey).toBe('milestone:streak:30');
  });

  it('suppresses the streak under crisis but still celebrates a goal', async () => {
    const fs = memFileSystem();
    await seedStreak(fs, 35);
    await saveGoal(fs, key, doneGoal('g2', 'Journal daily'));
    // Two crisis-flagged insights in the window → aggregateCrisisSignal.recurring → streak suppressed.
    await saveInsight(fs, key, crisisInsight('i1', '2026-09-13T00:00:00.000Z'));
    await saveInsight(fs, key, crisisInsight('i2', '2026-09-14T00:00:00.000Z'));
    const ms = await detectMilestones(fs, key, PERSON, now);
    expect(ms.some((m) => m.kind === 'streak')).toBe(false);
    expect(ms.some((m) => m.kind === 'goal')).toBe(true);
  });
});

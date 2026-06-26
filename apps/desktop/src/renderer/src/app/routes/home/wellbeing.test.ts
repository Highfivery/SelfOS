import { describe, expect, it } from 'vitest';
import type { Insight, TestResult } from '@shared/schemas';
import { checkInMoodPoints, sessionMoodPoints, wellbeingCheckin, wellbeingRead } from './wellbeing';

function insight(over: Partial<Insight> & { id: string }): Insight {
  return {
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'me',
    summary: 's',
    facts: [],
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { at: '2026-06-01T00:00:00.000Z' },
    createdAt: 'now',
    updatedAt: 'now',
    ...over,
  };
}

describe('sessionMoodPoints', () => {
  it('keeps only approved session insights for the person, with mood, oldest→newest', () => {
    const points = sessionMoodPoints(
      [
        insight({
          id: 'b',
          provenance: { at: '2026-06-03T00:00:00.000Z' },
          metrics: { moodValence: 0.5, moodEnergy: 0.2 },
        }),
        insight({
          id: 'a',
          provenance: { at: '2026-06-01T00:00:00.000Z' },
          metrics: { moodValence: -0.4, moodEnergy: -0.1 },
        }),
        insight({ id: 'other-person', subjectPersonId: 'someone', metrics: { moodValence: 0.9 } }),
        insight({ id: 'unapproved', approved: false, metrics: { moodValence: 0.9 } }),
        insight({ id: 'dream', source: 'dream', metrics: { moodValence: 0.9 } }),
        insight({ id: 'no-mood' }), // session insight without a mood metric → excluded
      ],
      'me',
    );
    expect(points.map((p) => p.valence)).toEqual([-0.4, 0.5]);
    expect(points[0]?.energy).toBe(-0.1);
  });
});

describe('wellbeingRead', () => {
  it('returns empty with fewer than two points', () => {
    expect(wellbeingRead([{ at: '1', valence: 0.3, energy: 0 }])).toBe('');
  });

  it('reads a clear upward move as lifting', () => {
    const read = wellbeingRead([
      { at: '1', valence: -0.5, energy: 0 },
      { at: '2', valence: -0.4, energy: 0 },
      { at: '3', valence: 0.3, energy: 0 },
      { at: '4', valence: 0.5, energy: 0 },
    ]);
    expect(read).toMatch(/lifting/i);
  });

  it('reads a clear downward move gently', () => {
    const read = wellbeingRead([
      { at: '1', valence: 0.6, energy: 0 },
      { at: '2', valence: 0.4, energy: 0 },
      { at: '3', valence: -0.3, energy: 0 },
      { at: '4', valence: -0.5, energy: 0 },
    ]);
    expect(read).toMatch(/heavier|gentle/i);
  });

  it('reads a flat signal as steady', () => {
    const read = wellbeingRead([
      { at: '1', valence: 0.1, energy: 0 },
      { at: '2', valence: 0.1, energy: 0 },
    ]);
    expect(read).toMatch(/steady/i);
  });
});

describe('checkInMoodPoints (51 §5.3 — the sibling check-in series)', () => {
  function moodResult(over: {
    id: string;
    testId: string;
    takenAt: string;
    normalized: number;
  }): TestResult {
    return {
      id: over.id,
      schemaVersion: 1,
      testId: over.testId,
      testVersion: 1,
      subjectPersonId: 'me',
      answers: [],
      scores: [{ key: 'phq9.total', raw: 0, normalized: over.normalized }],
      takenAt: over.takenAt,
      createdAt: over.takenAt,
      updatedAt: over.takenAt,
    };
  }

  it('keeps every dated PHQ-9 mood result (oldest→newest), maps severity → a valence-like value, ignores other tests', () => {
    const points = checkInMoodPoints([
      // A heavy check-in (severity 1 → valence −1), out of order.
      moodResult({ id: 'c2', testId: 'phq9', takenAt: '2026-06-05T00:00:00.000Z', normalized: 1 }),
      // A light check-in (severity 0 → valence +1).
      moodResult({ id: 'c1', testId: 'phq9', takenAt: '2026-06-02T00:00:00.000Z', normalized: 0 }),
      // A non-mood test is ignored.
      moodResult({ id: 'x', testId: 'gad7', takenAt: '2026-06-06T00:00:00.000Z', normalized: 0.5 }),
    ]);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ valence: 1 }); // oldest first
    expect(points[1]).toMatchObject({ valence: -1 });
  });
});

describe('wellbeingCheckin (53 §5.1 / 51 §3.4 — the gentle, never-escalating re-check signal)', () => {
  const NOW = Date.parse('2026-06-26T12:00:00.000Z');
  function result(id: string, testId: string, takenAt: string): TestResult {
    return {
      id,
      schemaVersion: 1,
      testId,
      testVersion: 1,
      subjectPersonId: 'me',
      answers: [],
      scores: [],
      takenAt,
      createdAt: takenAt,
      updatedAt: takenAt,
    };
  }

  it('is NOT due for someone who has never checked in (the You hub invites a first one, not Home)', () => {
    expect(wellbeingCheckin({}, NOW)).toEqual({ due: false });
  });

  it('is NOT due when the most recent recheckable check-in is within the window', () => {
    const out = wellbeingCheckin({ phq9: [result('a', 'phq9', '2026-06-20T00:00:00.000Z')] }, NOW);
    expect(out.due).toBe(false);
    expect(out.lastAt).toBe('2026-06-20T00:00:00.000Z');
  });

  it('is due when the most recent recheckable check-in is ≥14 days old', () => {
    const out = wellbeingCheckin({ gad7: [result('a', 'gad7', '2026-06-01T00:00:00.000Z')] }, NOW);
    expect(out.due).toBe(true);
    expect(out.lastAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('uses the MOST RECENT check-in across mood + anxiety (a recent check-in keeps it calm)', () => {
    // GAD-7 is old, but PHQ-9 is recent → not due (they checked in recently on something).
    const out = wellbeingCheckin(
      {
        phq9: [result('p', 'phq9', '2026-06-25T00:00:00.000Z')],
        gad7: [result('g', 'gad7', '2026-05-01T00:00:00.000Z')],
      },
      NOW,
    );
    expect(out.due).toBe(false);
    expect(out.lastAt).toBe('2026-06-25T00:00:00.000Z');
  });

  it('ignores non-recheckable instruments (a personality test is not a check-in)', () => {
    expect(
      wellbeingCheckin(
        { 'bigfive-ipip-120': [result('b', 'bigfive-ipip-120', '2026-01-01')] },
        NOW,
      ),
    ).toEqual({ due: false });
  });
});

// Cross-insight crisis awareness moved to @selfos/core/coaching `aggregateCrisisSignal` (40 §3.5) — the
// deterministic threshold (≥2 crisis flags in 14 days OR the dream nightmare nudge). Tested in core.

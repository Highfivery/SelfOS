import { describe, expect, it } from 'vitest';
import type { Insight } from '@shared/schemas';
import { sessionMoodPoints, wellbeingRead } from './wellbeing';

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

// Cross-insight crisis awareness moved to @selfos/core/coaching `aggregateCrisisSignal` (40 §3.5) — the
// deterministic threshold (≥2 crisis flags in 14 days OR the dream nightmare nudge). Tested in core.

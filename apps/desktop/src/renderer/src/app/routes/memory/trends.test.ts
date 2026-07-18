import { describe, expect, it } from 'vitest';
import type { Insight } from '@shared/schemas';
import { buildTrendSeries, prettifyMetricKey } from './trends';

function insight(over: Partial<Insight> & { id: string }): Insight {
  return {
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'p1',
    summary: `s-${over.id}`,
    facts: [],
    confidence: 'medium',
    categories: ['Other'],
    approved: true,
    provenance: { at: '2026-06-20T12:00:00.000Z' },
    createdAt: '2026-06-20T12:00:00.000Z',
    updatedAt: '2026-06-20T12:00:00.000Z',
    ...over,
  };
}

describe('prettifyMetricKey (65 §3.5)', () => {
  it('maps known metric keys to human labels', () => {
    expect(prettifyMetricKey('moodValence')).toBe('Mood');
    expect(prettifyMetricKey('moodEnergy')).toBe('Energy');
    expect(prettifyMetricKey('emotionalIntensity')).toBe('Emotional intensity');
    expect(prettifyMetricKey('connection')).toBe('Connection');
    expect(prettifyMetricKey('desire')).toBe('Desire');
  });

  it('prettifies an unknown camelCase / snake / kebab key — never a raw machine name', () => {
    expect(prettifyMetricKey('stressLevel')).toBe('Stress level');
    expect(prettifyMetricKey('sleep_quality')).toBe('Sleep quality');
    expect(prettifyMetricKey('overall-focus')).toBe('Overall focus');
    expect(prettifyMetricKey('mood')).toBe('Mood'); // a bare single word is capitalized
  });
});

describe('buildTrendSeries', () => {
  it('humanizes labels + carries the stable key; mood/energy lead; drops <2-point series', () => {
    const series = buildTrendSeries(
      [
        insight({
          id: 'a',
          provenance: { at: '2026-06-01T00:00:00.000Z' },
          metrics: { moodValence: 0.1, moodEnergy: 0.3, emotionalIntensity: 0.5 },
        }),
        insight({
          id: 'b',
          provenance: { at: '2026-06-02T00:00:00.000Z' },
          metrics: { moodValence: 0.2, moodEnergy: 0.28, emotionalIntensity: 0.6, oneOff: 0.9 },
        }),
      ],
      'p1',
    );
    const label = Object.fromEntries(series.map((s) => [s.key, s.label]));
    expect(label['moodValence']).toBe('Mood');
    expect(label['moodEnergy']).toBe('Energy');
    expect(label['emotionalIntensity']).toBe('Emotional intensity'); // humanized, not "emotionalIntensity"
    expect(label['oneOff']).toBeUndefined(); // only 1 reading → dropped
    expect(series[0]?.key).toBe('moodValence'); // reliable session signals lead
    expect(series[1]?.key).toBe('moodEnergy');
  });

  it("only reads the active person's approved insights (needs ≥2 points)", () => {
    const series = buildTrendSeries(
      [
        insight({ id: 'mine', metrics: { moodValence: 0.1 } }),
        insight({ id: 'theirs', subjectPersonId: 'other', metrics: { moodValence: 0.2 } }),
      ],
      'p1',
    );
    expect(series).toHaveLength(0); // p1 has only one point
  });
});

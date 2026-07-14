import { describe, expect, it } from 'vitest';
import { computeLifeRings } from './rings';
import type { LifeRingKey } from './schemas';

const keys = (input: Parameters<typeof computeLifeRings>[0]): LifeRingKey[] =>
  computeLifeRings(input).map((r) => r.key);

describe('computeLifeRings', () => {
  it('omits a ring when its contributing signal is absent (no false zeros)', () => {
    expect(keys({ signals: {} })).toEqual([]);
    expect(keys({ signals: { moodValenceMean: 0.5 } })).toEqual(['wellbeing']);
    expect(keys({ signals: { hasRelationships: true } })).toEqual(['connection']);
    expect(keys({ signals: { sessionsRecent: 1 } })).toEqual(['reflection']);
    expect(keys({ signals: { goalsMoving: 1 } })).toEqual(['growth']);
  });

  it('maps a high positive mood to a high wellbeing fill with a level word + pct', () => {
    const [ring] = computeLifeRings({ signals: { moodValenceMean: 1, checkInCount: 3 } });
    expect(ring?.key).toBe('wellbeing');
    expect(ring?.value).toBe(1);
    expect(ring?.pct).toBe(100);
    expect(ring?.levelLabel).toBe('Thriving');
    expect(ring?.softened).toBe(false);
  });

  it('a low mood reads as a gentle low band, never a negative/failing word', () => {
    const [ring] = computeLifeRings({ signals: { moodValenceMean: -1, checkInCount: 0 } });
    expect(ring?.value).toBe(0);
    expect(ring?.levelLabel).toBe('Quiet');
  });

  it('reflection scales with sessions + dreams and caps at 1', () => {
    const [ring] = computeLifeRings({ signals: { sessionsRecent: 5, dreamsRecent: 5 } });
    expect(ring?.value).toBe(1); // 10 capped at 8/8
    expect(ring?.pct).toBe(100);
  });

  it('returns all four rings when every signal is present', () => {
    expect(
      keys({
        signals: {
          moodValenceMean: 0.4,
          hasRelationships: true,
          sessionsRecent: 2,
          areasExplored: 3,
        },
      }),
    ).toEqual(['wellbeing', 'connection', 'reflection', 'growth']);
  });

  it('softens every ring during a crisis (score hidden by the caller)', () => {
    const rings = computeLifeRings({
      crisis: true,
      signals: {
        moodValenceMean: 0.9,
        hasRelationships: true,
        sessionsRecent: 4,
        areasExplored: 5,
      },
    });
    expect(rings).toHaveLength(4);
    expect(rings.every((r) => r.softened)).toBe(true);
    // levelLabel is still present so the caller can show a supportive word without a number.
    expect(rings.every((r) => r.levelLabel.length > 0)).toBe(true);
  });
});

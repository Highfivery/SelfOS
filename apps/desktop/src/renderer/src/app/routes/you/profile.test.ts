import { describe, expect, it } from 'vitest';
import type { TestSummary } from '@selfos/core/tests';
import type { TestSubscaleScore } from '@shared/schemas';
import { topSubscales } from './profile';

/** A minimal TestSummary carrying just the subscale metadata `topSubscales` reads. */
function summary(subscales: { key: string; label: string; signed: boolean }[]): TestSummary {
  return {
    id: 't',
    group: 'intimacy',
    title: 'T',
    instrument: 'SelfOS',
    blurb: '',
    framing: '',
    estimatedMinutes: 10,
    itemCount: 10,
    adult: false,
    sensitive: false,
    wellbeing: false,
    subscales,
  };
}

const score = (key: string, normalized: number): TestSubscaleScore => ({ key, raw: 0, normalized });

describe('topSubscales — the profile-card highlight ranking', () => {
  it('a non-signed (interest) scale headlines the HIGHEST draws, never a 0% (the kink-card bug)', () => {
    // Mirrors the reported result: many 0% subscales + a few strong draws. Definition order puts a 0% first.
    const test = summary([
      { key: 'k.sensual', label: 'Sensual & sensory', signed: false },
      { key: 'k.manual', label: 'Manual & toys', signed: false },
      { key: 'k.roleplay', label: 'Roleplay & fantasy', signed: false },
      { key: 'k.exhib', label: 'Exhibitionism & voyeurism', signed: false },
    ]);
    const scores = [
      score('k.sensual', 0), // 0% — must NOT headline
      score('k.manual', 0.91),
      score('k.roleplay', 0), // 0% — must NOT headline
      score('k.exhib', 1.0),
    ];
    const top = topSubscales(test, scores, 2).map((s) => s.label);
    expect(top).toEqual(['Exhibitionism & voyeurism', 'Manual & toys']);
  });

  it('a signed (bipolar) scale headlines the most pronounced pole (furthest from neutral)', () => {
    const test = summary([
      { key: 'a.anx', label: 'Attachment anxiety', signed: true },
      { key: 'a.avo', label: 'Attachment avoidance', signed: true },
    ]);
    // A strong (negative) anxiety lean beats a near-neutral avoidance.
    const top = topSubscales(test, [score('a.anx', -0.8), score('a.avo', 0.1)], 1).map(
      (s) => s.label,
    );
    expect(top).toEqual(['Attachment anxiety']);
  });
});

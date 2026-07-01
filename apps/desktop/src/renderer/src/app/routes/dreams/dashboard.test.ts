import { describe, expect, it } from 'vitest';
import type { Dream } from '@shared/channels';
import type { DreamTrendPoint } from '@shared/schemas';
import { groupDreamsByRecency, matchesFilter, moodCue } from './dashboard';

const NOW = Date.UTC(2026, 6, 15); // 2026-07-15

function dream(overrides: Partial<Dream>): Dream {
  return {
    id: 'd',
    schemaVersion: 1,
    personId: 'owner-1',
    narrative: 'n',
    lucid: false,
    nightmare: false,
    tags: [],
    people: [],
    sensitivity: 'standard',
    status: 'captured',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('matchesFilter', () => {
  it('all matches everything; the others gate on their flag/status', () => {
    const lucid = dream({ id: 'l', lucid: true });
    const nightmare = dream({ id: 'n', nightmare: true });
    const analyzed = dream({ id: 'a', status: 'analyzed' });
    const plain = dream({ id: 'p' });
    for (const d of [lucid, nightmare, analyzed, plain]) {
      expect(matchesFilter(d, 'all')).toBe(true);
    }
    expect(matchesFilter(lucid, 'lucid')).toBe(true);
    expect(matchesFilter(plain, 'lucid')).toBe(false);
    expect(matchesFilter(nightmare, 'nightmares')).toBe(true);
    expect(matchesFilter(plain, 'nightmares')).toBe(false);
    expect(matchesFilter(analyzed, 'analyzed')).toBe(true);
    expect(matchesFilter(plain, 'analyzed')).toBe(false);
  });
});

describe('groupDreamsByRecency', () => {
  it('buckets by dreamDate (falling back to createdAt), newest first, omitting empty groups', () => {
    const thisWeek = dream({ id: 'w', dreamDate: '2026-07-12' }); // 3 days ago
    const thisMonth = dream({ id: 'm', dreamDate: '2026-06-30' }); // 15 days ago
    const earlier = dream({ id: 'e', dreamDate: '2026-01-01' }); // long ago
    const groups = groupDreamsByRecency([earlier, thisMonth, thisWeek], NOW);
    expect(groups.map((g) => g.key)).toEqual(['week', 'month', 'earlier']);
    expect(groups.map((g) => g.label)).toEqual(['This week', 'This month', 'Earlier']);
    expect(groups[0]?.dreams.map((d) => d.id)).toEqual(['w']);
    expect(groups[1]?.dreams.map((d) => d.id)).toEqual(['m']);
    expect(groups[2]?.dreams.map((d) => d.id)).toEqual(['e']);
  });

  it('omits empty buckets and sorts within a group newest-first', () => {
    const older = dream({ id: 'o', dreamDate: '2026-07-10' });
    const newer = dream({ id: 'x', dreamDate: '2026-07-14' });
    const groups = groupDreamsByRecency([older, newer], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('week');
    expect(groups[0]?.dreams.map((d) => d.id)).toEqual(['x', 'o']);
  });

  it('a future-dated dream still lands in This week', () => {
    const future = dream({ id: 'f', dreamDate: '2026-07-20' });
    const groups = groupDreamsByRecency([future], NOW);
    expect(groups[0]?.key).toBe('week');
  });
});

describe('moodCue', () => {
  const points = (values: number[]): DreamTrendPoint[] =>
    values.map((value, i) => ({ date: `2026-07-0${i + 1}`, value }));

  it('returns null with fewer than three points (a two-point diff is too thin)', () => {
    expect(moodCue([])).toBeNull();
    expect(moodCue(points([0.5]))).toBeNull();
    expect(moodCue(points([0.5, -0.5]))).toBeNull();
  });

  it('reads a rising trend as brighter, a falling one as heavier, else steady', () => {
    expect(moodCue(points([-0.6, -0.5, 0.4, 0.6]))).toMatch(/brighter/);
    expect(moodCue(points([0.6, 0.5, -0.4, -0.6]))).toMatch(/heavier/);
    expect(moodCue(points([0.1, 0.0, 0.1, 0.0]))).toMatch(/steady/);
  });
});

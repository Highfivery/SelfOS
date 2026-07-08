import { describe, expect, it } from 'vitest';
import type { Insight } from '@shared/schemas';
import { areaGist, knowsYouRead, summarizeAreas } from './overview';
import { confidenceStats } from './stats';

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

const many = (n: number, confidence: Insight['confidence']): Insight[] =>
  Array.from({ length: n }, (_, i) => insight({ id: `${confidence}-${i}`, confidence }));

describe('knowsYouRead', () => {
  it('reads no data as "just getting started" (level 0)', () => {
    expect(knowsYouRead(confidenceStats([]))).toEqual({ label: 'Just getting started', level: 0 });
  });

  it('reads a little data as "getting to know you" (level 1)', () => {
    expect(knowsYouRead(confidenceStats(many(3, 'medium')))).toEqual({
      label: 'Getting to know you',
      level: 1,
    });
  });

  it('reads a fair amount of solid insight as "getting there" (level 2)', () => {
    expect(knowsYouRead(confidenceStats(many(8, 'high'))).level).toBe(2);
  });

  it('reads plentiful, corroborated insight as "knows you well" (level 3)', () => {
    expect(knowsYouRead(confidenceStats(many(14, 'high')))).toEqual({
      label: 'Knows you well',
      level: 3,
    });
  });

  it('holds a large but low-confidence memory back from level 3', () => {
    expect(knowsYouRead(confidenceStats(many(14, 'low'))).level).toBeLessThan(3);
  });
});

describe('summarizeAreas', () => {
  it('groups by primary life-area in LIFE_AREAS order, counting live facts, with a gist + best confidence', () => {
    const areas = summarizeAreas([
      insight({
        id: 'work',
        categories: ['Work & purpose'],
        confidence: 'medium',
        summary: 'Work summary',
        facts: [
          { id: 'a', text: 'Leads a team', shareable: false },
          { id: 'b', text: 'flagged', shareable: false, flaggedInaccurate: true }, // excluded from count
        ],
      }),
      insight({
        id: 'rel1',
        categories: ['Relationships'],
        confidence: 'low',
        summary: 'weaker',
        facts: [{ id: 'c', text: 'x', shareable: false }],
      }),
      insight({
        id: 'rel2',
        categories: ['Relationships'],
        confidence: 'high',
        summary: 'Shows love through acts',
        facts: [{ id: 'd', text: 'y', shareable: false }],
      }),
    ]);
    // LIFE_AREAS order: Relationships before Work & purpose.
    expect(areas.map((a) => a.area)).toEqual(['Relationships', 'Work & purpose']);
    const rel = areas[0]!;
    expect(rel.factCount).toBe(2);
    expect(rel.confidenceLevel).toBe(3); // best (high) insight in the area
    expect(rel.gist).toBe('Shows love through acts'); // the salient (high-confidence) insight's summary
    const work = areas[1]!;
    expect(work.factCount).toBe(1); // the flagged fact is not counted
  });

  it('treats an untagged insight as "Other"', () => {
    const areas = summarizeAreas([insight({ id: 'x', categories: [] })]);
    expect(areas.map((a) => a.area)).toEqual(['Other']);
  });
});

describe('areaGist', () => {
  it('prefers the salient insight summary, else its first live fact', () => {
    expect(
      areaGist([
        insight({
          id: 'a',
          confidence: 'high',
          summary: '',
          facts: [
            { id: 'f0', text: 'flagged', shareable: false, flaggedInaccurate: true },
            { id: 'f1', text: 'First real fact', shareable: false },
          ],
        }),
      ]),
    ).toBe('First real fact');
  });

  it('is empty for no insights', () => {
    expect(areaGist([])).toBe('');
  });
});

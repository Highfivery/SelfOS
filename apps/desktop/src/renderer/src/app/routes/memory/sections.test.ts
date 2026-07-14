import { describe, expect, it } from 'vitest';
import type { Insight } from '@shared/schemas';
import { memorySections } from './sections';

function insight(over: Partial<Insight> & { id: string }): Insight {
  return {
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'p1',
    summary: `s-${over.id}`,
    facts: [{ id: `${over.id}-f`, text: 'a fact', shareable: false }],
    confidence: 'medium',
    categories: ['Other'],
    approved: true,
    provenance: { conversationId: 'c1', at: '2026-06-11T12:00:00.000Z' },
    createdAt: '2026-06-11T12:00:00.000Z',
    updatedAt: '2026-06-11T12:00:00.000Z',
    ...over,
  };
}

describe('memorySections (spec 62)', () => {
  it('groups by life area and flags Intimacy + restricted-bearing sections as sensitive', () => {
    const sections = memorySections([
      insight({ id: 'a', categories: ['Health & body'] }),
      insight({ id: 'b', categories: ['Intimacy'] }),
      insight({
        id: 'c',
        categories: ['Emotions & patterns'],
        facts: [{ id: 'cf', text: 'trauma detail', shareable: false, restricted: true }],
      }),
    ]);
    const byArea = new Map(sections.map((s) => [s.area, s]));

    expect(byArea.get('Health & body')?.sensitive).toBe(false);
    // The Intimacy area is always sensitive…
    expect(byArea.get('Intimacy')?.sensitive).toBe(true);
    // …and so is any section carrying a restricted fact.
    expect(byArea.get('Emotions & patterns')?.sensitive).toBe(true);
  });

  it('carries the fact count and returns no sections for an empty set', () => {
    expect(memorySections([])).toEqual([]);
    const [section] = memorySections([
      insight({
        id: 'a',
        categories: ['Work & purpose'],
        facts: [
          { id: '1', text: 'x', shareable: false },
          { id: '2', text: 'y', shareable: false },
        ],
      }),
    ]);
    expect(section?.area).toBe('Work & purpose');
    expect(section?.factCount).toBe(2);
  });
});

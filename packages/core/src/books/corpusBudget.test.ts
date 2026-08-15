import { describe, expect, it } from 'vitest';
import type { OutlineChapter } from '../schemas';
import {
  budgetCorpus,
  estimateTokens,
  scoreItemForChapter,
  sliceCorpusForChapter,
} from './corpusBudget';
import type { CorpusItem, StoryCorpus } from './storyCorpus';

function item(over: Partial<CorpusItem> & Pick<CorpusItem, 'sourceRef' | 'text'>): CorpusItem {
  return { label: 'x', ...over };
}

/** A ~`tokens`-token item (≈4 chars/token) of a given kind/area/date. */
function sized(id: string, tokens: number, over: Partial<CorpusItem> = {}): CorpusItem {
  return item({
    sourceRef: { kind: 'insight', id },
    text: 'w'.repeat(tokens * 4),
    ...over,
  });
}

const chapter = (over: Partial<OutlineChapter> = {}): OutlineChapter => ({
  id: 'c1',
  title: 'The Garage',
  brief: 'He learns a machine obeys.',
  lifeAreas: [],
  order: 0,
  ...over,
});

const corpusOf = (items: CorpusItem[]): StoryCorpus => ({
  personName: 'Ben',
  profile: ['Ben, 40, engineer'],
  items,
});

describe('corpus budgeting (64 §17.1)', () => {
  it('estimateTokens is ~4 chars/token and never zero', () => {
    expect(estimateTokens('')).toBe(1);
    expect(estimateTokens('w'.repeat(400))).toBe(100);
  });

  describe('scoreItemForChapter', () => {
    it('rewards a life-area match, an in-era date, and keyword overlap', () => {
      const ch = chapter({ lifeAreas: ['Work'], eraFrom: '1990', eraTo: '2000' });
      const strong = item({
        sourceRef: { kind: 'insight', id: 'a' },
        text: 'The garage and the machine at his first job.',
        lifeArea: 'Work',
        date: '1995',
      });
      const weak = item({
        sourceRef: { kind: 'insight', id: 'b' },
        text: 'Unrelated musings about the sea.',
        lifeArea: 'Health',
        date: '2020',
      });
      expect(scoreItemForChapter(strong, ch)).toBeGreaterThan(scoreItemForChapter(weak, ch));
      // No signal at all → 0 (still eligible, just last).
      expect(
        scoreItemForChapter(item({ sourceRef: { kind: 'goal', id: 'c' }, text: 'zzz' }), ch),
      ).toBe(0);
    });

    it('an out-of-era date scores no era bonus', () => {
      const ch = chapter({ eraFrom: '1990', eraTo: '2000', lifeAreas: [] });
      const inEra = item({ sourceRef: { kind: 'insight', id: 'a' }, text: 'zzz', date: '1995' });
      const outEra = item({ sourceRef: { kind: 'insight', id: 'b' }, text: 'zzz', date: '2010' });
      expect(scoreItemForChapter(inEra, ch)).toBe(2);
      expect(scoreItemForChapter(outEra, ch)).toBe(0);
    });
  });

  describe('sliceCorpusForChapter', () => {
    it('keeps the most relevant items within the token budget, profile untouched', () => {
      const ch = chapter({ lifeAreas: ['Work'] });
      const relevant = sized('rel', 100, { lifeArea: 'Work' });
      const filler1 = sized('f1', 100);
      const filler2 = sized('f2', 100);
      const sliced = sliceCorpusForChapter(corpusOf([filler1, relevant, filler2]), ch, {
        tokenBudget: 150,
      });
      // Only ~150 tokens fit — the relevant item leads and one filler tags along; the third is dropped.
      expect(sliced.items[0]!.sourceRef.id).toBe('rel');
      expect(sliced.items).toHaveLength(1); // 100 fits, a second 100 would exceed 150
      expect(sliced.profile).toEqual(['Ben, 40, engineer']);
    });

    it('a large mid-list item never blocks smaller ones after it (best-effort packing)', () => {
      const ch = chapter({ lifeAreas: ['Work'] });
      const lead = sized('lead', 40, { lifeArea: 'Work' }); // top-ranked, fits
      const huge = sized('huge', 500);
      const small1 = sized('s1', 40);
      const small2 = sized('s2', 40);
      const sliced = sliceCorpusForChapter(corpusOf([lead, huge, small1, small2]), ch, {
        tokenBudget: 120,
      });
      // lead kept; huge overflows and is skipped; the two smalls still pack into the remaining budget.
      expect(sliced.items.map((i) => i.sourceRef.id)).toEqual(['lead', 's1', 's2']);
    });

    it('keeps the top-ranked item even if it alone exceeds budget — a chapter is never left empty', () => {
      const ch = chapter({ lifeAreas: ['Work'] });
      const onlyBig = sized('big', 5000, { lifeArea: 'Work' });
      const sliced = sliceCorpusForChapter(corpusOf([onlyBig]), ch, { tokenBudget: 100 });
      expect(sliced.items.map((i) => i.sourceRef.id)).toEqual(['big']);
    });

    it('with no relevance signal, still fills to budget in chronological order (§7 thin corpus)', () => {
      const ch = chapter({ lifeAreas: [], eraFrom: undefined, eraTo: undefined });
      const a = sized('a', 40, { date: '2001' });
      const b = sized('b', 40, { date: '1999' });
      const sliced = sliceCorpusForChapter(corpusOf([a, b]), ch, { tokenBudget: 1000 });
      // Both score 0 → chronological tie-break: 1999 before 2001.
      expect(sliced.items.map((i) => i.sourceRef.id)).toEqual(['b', 'a']);
    });
  });

  describe('budgetCorpus (foundations)', () => {
    it('returns the corpus unchanged when it is under budget', () => {
      const c = corpusOf([sized('a', 10), sized('b', 10)]);
      expect(budgetCorpus(c, { tokenBudget: 1000 })).toBe(c);
    });

    it('over budget, keeps the outline-critical spine and trims the bulk raw intake first', () => {
      const timeline = item({ sourceRef: { kind: 'timeline', id: 't' }, text: 'w'.repeat(200) }); // 50 tok
      const insight = sized('i', 50);
      const intake = item({
        sourceRef: { kind: 'intakeAnswer', id: 'raw' },
        text: 'w'.repeat(400),
      }); // 100 tok
      const budgeted = budgetCorpus(corpusOf([intake, insight, timeline]), { tokenBudget: 120 });
      const kinds = budgeted.items.map((i) => i.sourceRef.kind);
      // timeline + insight (100 tok) fit and lead by priority; the 100-tok raw intake is dropped.
      expect(kinds).toContain('timeline');
      expect(kinds).toContain('insight');
      expect(kinds).not.toContain('intakeAnswer');
    });

    it('is total: an empty corpus stays empty', () => {
      expect(budgetCorpus(corpusOf([]), { tokenBudget: 10 }).items).toEqual([]);
    });
  });
});

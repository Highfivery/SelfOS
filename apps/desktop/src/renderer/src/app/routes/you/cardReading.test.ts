import { describe, expect, it } from 'vitest';
import { NO_SIGNAL_BAND } from '@shared/schemas';
import type { TestSummary } from '@selfos/core/tests';
import type { TestSubscaleScore } from '@shared/schemas';
import { barsReading, drawsReading, readingKindFor, spectrumReading } from './cardReading';

const SPECTRUM_BANDS = [
  'mostly other-sex',
  'leans other-sex',
  'fairly balanced',
  'leans same-sex',
  'mostly same-sex',
];

function summary(over: Partial<TestSummary> & Pick<TestSummary, 'id' | 'subscales'>): TestSummary {
  return {
    group: 'intimacy',
    title: over.id,
    instrument: 'X',
    blurb: 'A blurb.',
    framing: 'A reflection.',
    estimatedMinutes: 8,
    itemCount: 22,
    adult: true,
    sensitive: true,
    wellbeing: false,
    ...over,
  };
}

const sexuality = summary({
  id: 'kinsey-klein',
  subscales: [
    {
      key: 'kinsey.orientation',
      label: 'Overall orientation',
      signed: true,
      bands: SPECTRUM_BANDS,
    },
    {
      key: 'klein.attraction',
      label: 'Who you’re sexually attracted to',
      signed: true,
      bands: SPECTRUM_BANDS,
    },
    {
      key: 'klein.fantasy',
      label: 'Who appears in your sexual fantasies',
      signed: true,
      bands: SPECTRUM_BANDS,
    },
  ],
});

const kink = summary({
  id: 'kink-interests',
  subscales: Array.from({ length: 8 }, (_, i) => ({
    key: `kink.c${i}`,
    label: `Category ${i}`,
    signed: false,
  })),
});

const score = (key: string, normalized: number, band?: string): TestSubscaleScore => ({
  key,
  raw: 0,
  normalized,
  ...(band !== undefined ? { band } : {}),
});

describe('readingKindFor — chosen by shape, not by id', () => {
  it('reads an all-signed instrument as a spectrum', () => {
    expect(readingKindFor(sexuality)).toBe('spectrum');
  });

  it('reads a many-facet unipolar instrument as a draws list', () => {
    expect(readingKindFor(kink)).toBe('draws');
  });

  it('falls back to bars for a small unipolar instrument', () => {
    const ecr = summary({
      id: 'ecr-r',
      subscales: [
        { key: 'ecr.anxiety', label: 'Attachment anxiety', signed: false },
        { key: 'ecr.avoidance', label: 'Attachment avoidance', signed: false },
      ],
    });
    expect(readingKindFor(ecr)).toBe('bars');
  });
});

describe('spectrumReading', () => {
  it('leads with the instrument’s own headline and names both poles from the definition', () => {
    const reading = spectrumReading(sexuality, [
      score('kinsey.orientation', -1, 'mostly other-sex'),
      score('klein.attraction', -1, 'mostly other-sex'),
      score('klein.fantasy', -1, 'mostly other-sex'),
    ]);
    expect(reading?.band).toBe('mostly other-sex');
    expect(reading?.position).toBe(0); // −1 maps to the far left
    // A bipolar bar is unreadable without its ends — and they come from the instrument, not a second copy.
    expect(reading?.poles).toEqual({ left: 'mostly other-sex', right: 'mostly same-sex' });
  });

  it('says the variables agree when they do, instead of printing the same reading twice', () => {
    // This is the exact case that made the old card useless: everything at the same pole.
    const reading = spectrumReading(sexuality, [
      score('kinsey.orientation', -1, 'mostly other-sex'),
      score('klein.attraction', -1, 'mostly other-sex'),
      score('klein.fantasy', -0.9, 'mostly other-sex'),
    ]);
    expect(reading?.divergence).toBe('Everything else you answered sits with it.');
  });

  it('names the variable that diverges — the finding the grid exists to produce', () => {
    const reading = spectrumReading(sexuality, [
      score('kinsey.orientation', -1, 'mostly other-sex'),
      score('klein.attraction', -1, 'mostly other-sex'),
      score('klein.fantasy', 0.6, 'leans same-sex'),
    ]);
    // The label is quoted verbatim, not folded into the sentence in lower case.
    expect(reading?.divergence).toBe(
      'Except “Who appears in your sexual fantasies” — leans same-sex.',
    );
  });

  it('ignores unrated variables entirely, and falls back when the headline itself was skipped', () => {
    const reading = spectrumReading(sexuality, [
      score('kinsey.orientation', -1, NO_SIGNAL_BAND), // skipped
      score('klein.attraction', 0.5, 'leans same-sex'), // answered
      score('klein.fantasy', -1, NO_SIGNAL_BAND), // skipped
    ]);
    // The skipped ones floor to −1, the most extreme value there is — they must not be the headline.
    expect(reading?.band).toBe('leans same-sex');
    // …and with nothing else answered there is no divergence to claim.
    expect(reading?.divergence).toBe('');
  });

  it('is null when nothing at all was answered', () => {
    expect(
      spectrumReading(sexuality, [
        score('kinsey.orientation', -1, NO_SIGNAL_BAND),
        score('klein.attraction', -1, NO_SIGNAL_BAND),
        score('klein.fantasy', -1, NO_SIGNAL_BAND),
      ]),
    ).toBeNull();
  });
});

describe('drawsReading', () => {
  it('ranks the leading facets by name and counts only what was rated', () => {
    const reading = drawsReading(kink, [
      score('kink.c0', 1, 'a strong draw'),
      score('kink.c1', 0.91, 'a strong draw'),
      score('kink.c2', 0.78, 'a strong draw'),
      score('kink.c3', 0.4, 'some curiosity'),
      // Four categories never opened — they floor to 0 and must not be counted or listed.
      score('kink.c4', 0, NO_SIGNAL_BAND),
      score('kink.c5', 0, NO_SIGNAL_BAND),
      score('kink.c6', 0, NO_SIGNAL_BAND),
      score('kink.c7', 0, NO_SIGNAL_BAND),
    ]);
    expect(reading?.draws.map((d) => d.label)).toEqual(['Category 0', 'Category 1', 'Category 2']);
    // The honest denominator: four rated, not eight.
    expect(reading?.rated).toBe(4);
  });

  it('never lists a category that was never opened, at any rank', () => {
    const reading = drawsReading(kink, [
      score('kink.c0', 0.3, 'some curiosity'),
      ...Array.from({ length: 7 }, (_, i) => score(`kink.c${i + 1}`, 0, NO_SIGNAL_BAND)),
    ]);
    expect(reading?.draws).toHaveLength(1);
    expect(reading?.rated).toBe(1);
  });

  it('is null when nothing was rated', () => {
    expect(
      drawsReading(
        kink,
        kink.subscales.map((s) => score(s.key, 0, NO_SIGNAL_BAND)),
      ),
    ).toBeNull();
  });
});

describe('barsReading', () => {
  it('drops unrated subscales rather than charting their floor', () => {
    const ecr = summary({
      id: 'ecr-r',
      subscales: [
        { key: 'a', label: 'Attachment anxiety', signed: false },
        { key: 'b', label: 'Attachment avoidance', signed: false },
      ],
    });
    const bars = barsReading(ecr, [score('a', 0.6, 'leans higher'), score('b', 0, NO_SIGNAL_BAND)]);
    expect(bars.map((b) => b.key)).toEqual(['a']);
  });
});

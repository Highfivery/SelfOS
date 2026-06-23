import { describe, expect, it } from 'vitest';
import { lifeAreasFromText } from './lifeAreaKeywords';

describe('lifeAreasFromText (28 §13)', () => {
  it('maps money talk to Money', () => {
    expect(lifeAreasFromText('I am so stressed about my debt and rent')).toContain('Money');
  });

  it('maps work talk to Work & purpose', () => {
    expect(lifeAreasFromText('my boss gave me a brutal deadline at the office')).toContain(
      'Work & purpose',
    );
  });

  it('catches multiple areas in one message, in canonical order', () => {
    const areas = lifeAreasFromText('my husband and I keep fighting about money');
    expect(areas).toContain('Relationships');
    expect(areas).toContain('Money');
    // canonical order: Relationships comes before Money in LIFE_AREAS
    expect(areas.indexOf('Relationships')).toBeLessThan(areas.indexOf('Money'));
  });

  it('returns [] when nothing clearly maps (the safe "no signal" reading)', () => {
    expect(lifeAreasFromText('the sky was a nice colour today')).toEqual([]);
    expect(lifeAreasFromText('')).toEqual([]);
  });

  it('matches at a word boundary — "god" does not fire on "good"', () => {
    expect(lifeAreasFromText('I had a really good day')).not.toContain('Faith');
    expect(lifeAreasFromText('I prayed to god last night')).toContain('Faith');
  });

  it('catches stem prefixes (anxie → anxiety/anxious)', () => {
    expect(lifeAreasFromText('I feel so anxious lately')).toContain('Emotions & patterns');
    expect(lifeAreasFromText('my anxiety is spiking')).toContain('Emotions & patterns');
  });
});

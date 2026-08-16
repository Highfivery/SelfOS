import { describe, expect, it } from 'vitest';

import { EROTICA_BOOK_TYPE, BIOGRAPHY_BOOK_TYPE } from './bookTypes';
import { buildBiographerSystem } from './storyPromptBuilder';
import type { BookConfig } from '../schemas';

const CONFIG: BookConfig = {
  voice: 'first',
  style: 'raunchy',
  length: 'standard',
  autoRefresh: false,
} as BookConfig;

const LEXICON = 'Loves to hear: good girl · mine.\nNEVER use: whore.';

describe('the book prompt takes their own vocabulary (74 §5.8)', () => {
  it('refines the register for an ADULT-GATED book, without softening it', () => {
    const system = buildBiographerSystem(
      EROTICA_BOOK_TYPE,
      CONFIG,
      'Angel',
      undefined,
      {},
      LEXICON,
    );
    expect(system).toContain('THEIR OWN VOCABULARY');
    expect(system).toContain('good girl');
    // It refines the WORDS; the register still decides how explicit the book is.
    expect(system).toContain('never overrides how explicit the book is');
    // …and it sits after the register it refines, before the closing directive that outranks everything.
    expect(system.indexOf('REGISTER')).toBeLessThan(system.indexOf('THEIR OWN VOCABULARY'));
  });

  it('never reaches a book that is not adult-gated', () => {
    const system = buildBiographerSystem(
      BIOGRAPHY_BOOK_TYPE,
      CONFIG,
      'Angel',
      undefined,
      {},
      LEXICON,
    );
    expect(system).not.toContain('THEIR OWN VOCABULARY');
    expect(system).not.toContain('good girl');
  });

  it('leaves the prompt byte-unchanged when there is no lexicon', () => {
    const withOut = buildBiographerSystem(EROTICA_BOOK_TYPE, CONFIG, 'Angel', undefined, {});
    const withEmpty = buildBiographerSystem(EROTICA_BOOK_TYPE, CONFIG, 'Angel', undefined, {}, '');
    expect(withEmpty).toBe(withOut);
  });
});

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

  it('carries the hard-no list into a book that is NOT adult-gated (74 §5.8a)', () => {
    /*
     * The two halves have different rules, and this layer used to re-test `gates.adult` over the MERGED
     * value — so a biography, which `subjectLexiconBlocks` deliberately hands suppression alone, had that
     * thrown away one layer down and went near a marriage with no idea what its subject had ruled out.
     */
    const system = buildBiographerSystem(
      BIOGRAPHY_BOOK_TYPE,
      CONFIG,
      'Angel',
      undefined,
      {},
      {
        suppression: 'NEVER use: whore.',
      },
    );
    expect(system).toContain('NEVER use: whore.');
    // …and still no positive steer on a non-adult book: the halves are separate, not merged.
    expect(system).not.toContain('THEIR OWN VOCABULARY');
  });

  it('does not repeat the hard nos on an adult book, whose steer already ends with them', () => {
    const system = buildBiographerSystem(
      EROTICA_BOOK_TYPE,
      CONFIG,
      'Angel',
      undefined,
      {},
      {
        steer: LEXICON,
      },
    );
    expect(system).toContain('THEIR OWN VOCABULARY');
    expect(system.split('NEVER use: whore.').length - 1).toBe(1);
  });

  it('leaves the prompt byte-unchanged when there is no lexicon', () => {
    const withOut = buildBiographerSystem(EROTICA_BOOK_TYPE, CONFIG, 'Angel', undefined, {});
    const withEmpty = buildBiographerSystem(EROTICA_BOOK_TYPE, CONFIG, 'Angel', undefined, {}, '');
    expect(withEmpty).toBe(withOut);
  });
});

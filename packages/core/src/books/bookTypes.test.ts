import { describe, expect, it } from 'vitest';
import { BookStyleSchema } from '../schemas';
import {
  BOOK_TYPES,
  BIOGRAPHY_BOOK_TYPE,
  CHILDRENS_BOOK_TYPE,
  MCADAMS_SCENES,
  OUR_STORY_BOOK_TYPE,
  getBookType,
  listBookTypes,
  resolveSpine,
  SYMBOLIC_IMAGE_FRAMING,
} from './bookTypes';

describe('BookType registry (64)', () => {
  it('registers all eight book types (72 §3.2 — P6 complete)', () => {
    expect(BOOK_TYPES.map((t) => t.id)).toEqual([
      'biography',
      'memoir',
      'yearInReview',
      'portrait',
      'ourStory',
      'childrens',
      'dreamBook',
      'erotica',
    ]);
    expect(getBookType('biography')).toBe(BIOGRAPHY_BOOK_TYPE);
    expect(listBookTypes()).toBe(BOOK_TYPES);
  });

  it('every type says what it draws on, its shape, and what it asks about (72 §3.2)', () => {
    // The picker card is built entirely from this, so a type that ships without it describes itself as
    // three blanks — and the person choosing between six of them has nothing to compare.
    for (const t of listBookTypes()) {
      expect(t.summary.drawsOn.length, `${t.id} drawsOn`).toBeGreaterThan(0);
      expect(t.summary.shape.length, `${t.id} shape`).toBeGreaterThan(0);
      expect(t.summary.asksAbout.length, `${t.id} asksAbout`).toBeGreaterThan(0);
    }
  });

  it('splits into both truth modes — the picker groups by it, so neither group may be empty', () => {
    const modes = new Set(listBookTypes().map((t) => t.truthMode));
    expect(modes).toEqual(new Set(['true', 'fictionalized']));
  });

  it('returns undefined for an unknown type (never throws)', () => {
    expect(getBookType('notARealBookType')).toBeUndefined();
  });

  it('the biography is not adult-gated (own private data)', () => {
    expect(BIOGRAPHY_BOOK_TYPE.gates.adult).toBe(false);
  });

  it('has exactly one default structure template', () => {
    const defaults = BIOGRAPHY_BOOK_TYPE.structures.filter((s) => s.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe('chronicle');
  });

  /**
   * `BookStyle` is the UNION across every type; each type offers a subset via `stylePresets` (erotica's
   * registers are not on offer for a biography, and vice versa). So the invariant is two-way: no type may
   * offer a style the enum doesn't know, and no enum entry may be offered by nothing — a style nothing
   * offers is dead, and a preset id outside the enum won't survive a config round-trip.
   */
  it('every style is offered by some type, and every offered style is a real BookStyle', () => {
    const offered = new Set(listBookTypes().flatMap((t) => t.stylePresets.map((p) => p.id)));
    expect([...offered].sort()).toEqual([...BookStyleSchema.options].sort());
    for (const type of listBookTypes()) {
      for (const preset of type.stylePresets) {
        expect(preset.directive.length, `${type.id}/${preset.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('carries the eight McAdams key scenes with unique keys', () => {
    expect(MCADAMS_SCENES).toHaveLength(8);
    const keys = MCADAMS_SCENES.map((s) => s.key);
    expect(new Set(keys).size).toBe(8);
    expect(keys).toContain('highPoint');
    expect(keys).toContain('lowPoint');
    expect(keys).toContain('turningPoint');
    for (const scene of MCADAMS_SCENES) {
      expect(scene.prompt.length).toBeGreaterThan(0);
      expect(scene.label.length).toBeGreaterThan(0);
    }
    expect(BIOGRAPHY_BOOK_TYPE.interview.scenes).toBe(MCADAMS_SCENES);
  });

  it('the interview framework has categories and a six-step deepening ladder', () => {
    expect(BIOGRAPHY_BOOK_TYPE.interview.categories.length).toBeGreaterThanOrEqual(5);
    expect(BIOGRAPHY_BOOK_TYPE.interview.deepeningLadder).toHaveLength(6);
    for (const cat of BIOGRAPHY_BOOK_TYPE.interview.categories) {
      expect(cat.examplePrompts.length).toBeGreaterThan(0);
    }
    expect(BIOGRAPHY_BOOK_TYPE.interview.framing).toMatch(/no right or wrong answers/i);
  });

  it('every style preset carries a first- and third-person specimen (§13.3 live preview)', () => {
    for (const type of BOOK_TYPES) {
      for (const preset of type.stylePresets) {
        expect(preset.specimen.first.trim().length).toBeGreaterThan(0);
        expect(preset.specimen.third.trim().length).toBeGreaterThan(0);
        // The two voices genuinely differ (so switching voice actually re-renders the preview).
        expect(preset.specimen.first).not.toBe(preset.specimen.third);
      }
    }
  });

  it('the doctrine states the load-bearing craft rules and forbids the AI-prose tells', () => {
    const d = BIOGRAPHY_BOOK_TYPE.doctrine.toLowerCase();
    // Craft anchors
    expect(d).toContain('scene');
    expect(d).toContain('never invent');
    expect(d).toContain('portrait, not autopsy');
    // Safety: no clinical labels in prose (spec-51 invariant carried into the doctrine)
    expect(d).toMatch(/never name instruments, scores, bands, or diagnoses/);
    // The banned-tell inventory is present (so the model is told what NOT to write)
    expect(d).toContain('tapestry');
    expect(d).toContain('delve');
    expect(d).toContain('not just x, but y');
    expect(d).toContain('i learned that');
  });

  /**
   * 72 §5.1 — the measured defect. The doctrine's honest-epistemics rule used to hand the model a literal
   * script (`say so on the page ("the record doesn't say", …)`), and it adopted the example as house style:
   * measured on the real vault, Ben's 50,006-word book breaks frame once every 168 words — "the record" ×188,
   * "the biographer" ×34, "doesn't say" ×52. The rule (never assert what the material doesn't support) stays;
   * the example that taught the tic is gone, and narrating the book's own construction is now forbidden
   * outright. This test fails against the pre-72 doctrine.
   */
  it('never teaches the model to narrate its own sourcing (the meta-narration defect)', () => {
    for (const type of BOOK_TYPES) {
      const d = type.doctrine.toLowerCase();
      // The old INSTRUCTION — "say so on the page" — is what taught the tic. It must be gone, everywhere.
      expect(d).not.toContain('say so on the page');
      // The offending phrase may still appear, but ONLY inside the forbidding clause.
      expect(d).toContain('never as a fact about your sources');
      if (type.truthMode !== 'true') continue;
      // A told-true book keeps the honest-epistemics CONSTRAINT — only its example changed — and attributes
      // the doubt to a person rather than to a researcher. A fictionalized book has a different contract:
      // it MAY invent the events, so "never assert what the material does not support" would be wrong there.
      expect(d).toContain('never assert what the material does not support');
      expect(d).toContain('in character');
    }
  });

  it('forbids narrating the book’s own construction', () => {
    for (const type of BOOK_TYPES) {
      const d = type.doctrine.toLowerCase();
      expect(d).toContain('never narrate the book');
      // Every phrase the real books actually leaked is named explicitly.
      for (const banned of [
        '"the record"',
        '"the material"',
        '"the biographer"',
        '"this chapter"',
        '"this book"',
      ]) {
        expect(d).toContain(banned);
      }
    }
  });

  /**
   * 72 §4.1 — the four declarative slots. They exist so nothing downstream has to ask "is this a biography?":
   * the type says what it is, and the pipeline reads it.
   */
  it('every registered type declares how it is shaped, how true it is, and how people appear', () => {
    for (const type of listBookTypes()) {
      expect(['true', 'fictionalized']).toContain(type.truthMode);
      expect(['eras', 'span', 'pages', 'vignettes']).toContain(type.spine.kind);
      expect(['realNames', 'renamed', 'childrenAsHeroes']).toContain(type.castPolicy);
      expect(type.imageFraming.trim().length).toBeGreaterThan(0);
      // A fictionalized book must not default to naming real people inside invented events.
      if (type.truthMode === 'fictionalized') expect(type.castPolicy).not.toBe('realNames');
      // An audience is only meaningful when the book is FOR someone other than its subject.
      if (type.audience) {
        expect(type.audience.ageFrom).toBeLessThan(type.audience.ageTo);
      }
    }
  });

  it('the default image framing never permits a likeness of a real person (§8.5)', () => {
    for (const type of listBookTypes()) {
      if (type.imageFraming !== SYMBOLIC_IMAGE_FRAMING) continue;
      expect(type.imageFraming).toMatch(/never a likeness/i);
      expect(type.imageFraming).toMatch(/never a photograph/i);
    }
  });

  /**
   * The §8.5 boundary guard. Relaxing the likeness rule is a ONE-TYPE exception the owner signed off on, and
   * the thing that must never happen quietly is a second type acquiring it. This fails the moment any other
   * type stops using the symbolic default — which is exactly when someone should have to come back to §8.5.
   */
  it('EXACTLY ONE type departs from the symbolic framing, and it is the children’s book (§8.5)', () => {
    const departs = listBookTypes().filter((t) => t.imageFraming !== SYMBOLIC_IMAGE_FRAMING);
    expect(departs.map((t) => t.id)).toEqual(['childrens']);
    // …and only for a type that names children as its heroes.
    expect(departs[0]?.castPolicy).toBe('childrenAsHeroes');
    // The relaxation is bounded: illustration only, and still no text in the image.
    expect(CHILDRENS_BOOK_TYPE.imageFraming).toMatch(/non-photorealistic/i);
    expect(CHILDRENS_BOOK_TYPE.imageFraming).toMatch(/NO text/i);
  });

  it('the children’s book is a picture book for children, told in pages (§4.1)', () => {
    expect(CHILDRENS_BOOK_TYPE.spine).toEqual({ kind: 'pages', count: 32, wordsPerPage: 40 });
    expect(CHILDRENS_BOOK_TYPE.truthMode).toBe('fictionalized');
    expect(CHILDRENS_BOOK_TYPE.gates.adult).toBe(false);
    expect(CHILDRENS_BOOK_TYPE.audience?.ageFrom).toBe(3);
    // The page count is a commission answer, and it must actually change the shape.
    expect(resolveSpine(CHILDRENS_BOOK_TYPE, { length: '16' })).toEqual({
      kind: 'pages',
      count: 16,
      wordsPerPage: 40,
    });
    // A missing or junk answer falls back to the standard 32, never NaN pages.
    expect(resolveSpine(CHILDRENS_BOOK_TYPE, {})).toEqual({
      kind: 'pages',
      count: 32,
      wordsPerPage: 40,
    });
    expect(resolveSpine(CHILDRENS_BOOK_TYPE, { length: 'nonsense' })).toEqual({
      kind: 'pages',
      count: 32,
      wordsPerPage: 40,
    });
  });

  it('asks the parent about the CHILD, not about themselves (§4.1 — the framework is the only source)', () => {
    // The reason `scenes` stopped being the McAdams tuple. Asking a parent for "a low point — a hard time
    // that stayed with you" in order to write a bedtime story is the wrong interview.
    expect(CHILDRENS_BOOK_TYPE.interview.scenes).not.toBe(MCADAMS_SCENES);
    const keys = CHILDRENS_BOOK_TYPE.interview.scenes.map((s) => s.key);
    expect(keys).not.toContain('lowPoint');
    expect(keys).toContain('delight');
    expect(new Set(keys).size).toBe(keys.length);
    for (const scene of CHILDRENS_BOOK_TYPE.interview.scenes) {
      expect(scene.prompt.trim().length).toBeGreaterThan(0);
      expect(scene.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('demos its OWN voice — never the biography’s literary-memoir specimen', () => {
    // The panel is labelled "how your biographer will sound", so a picture book showing a line of adult
    // memoir prose is the product lying about itself before a word is written.
    const ids = CHILDRENS_BOOK_TYPE.stylePresets.map((p) => p.id);
    expect(ids).toContain('warm'); // BookConfig.style's default must resolve to a real directive
    expect(ids).not.toContain('journalistic');
    for (const preset of CHILDRENS_BOOK_TYPE.stylePresets) {
      expect(preset.directive.trim().length).toBeGreaterThan(0);
      const biography = BIOGRAPHY_BOOK_TYPE.stylePresets.find((p) => p.id === preset.id);
      expect(preset.specimen.third).not.toBe(biography?.specimen.third);
      // Picture-book sentences are short by nature — a 30-word specimen is the wrong demonstration.
      expect(preset.specimen.third.split(/\s+/).length).toBeLessThan(30);
    }
  });

  /**
   * 72 §5.8 — the one type whose books belong to two people. The flag is what routes a book to the pair
   * root, so exactly one type may carry it until another shared kind is designed.
   */
  it('EXACTLY ONE type is shared with a partner, and it asks who', () => {
    const shared = listBookTypes().filter((t) => t.sharedWithPartner);
    expect(shared.map((t) => t.id)).toEqual(['ourStory']);
    // It has to ask, or there is no pair to resolve.
    expect(shared[0]?.options?.find((o) => o.id === 'partner')).toMatchObject({
      kind: 'person',
      required: true,
    });
    // A couple's own history is the last thing that should be invented or pseudonymous.
    expect(shared[0]?.truthMode).toBe('true');
    expect(shared[0]?.castPolicy).toBe('realNames');
  });

  it('asks about the RELATIONSHIP, not about one life', () => {
    // The McAdams scenes are questions about an individual; this book's subject is the two of them.
    expect(OUR_STORY_BOOK_TYPE.interview.scenes).not.toBe(MCADAMS_SCENES);
    const keys = OUR_STORY_BOOK_TYPE.interview.scenes.map((s) => s.key);
    expect(keys).toContain('meeting');
    expect(keys).not.toContain('lowPoint');
    // Either partner may answer any of them (owner decision, 2026-08-14).
    expect(OUR_STORY_BOOK_TYPE.interview.framing).toMatch(/either partner/i);
    // And the doctrine must not let two people be flattened into one agreeing voice.
    expect(OUR_STORY_BOOK_TYPE.doctrine).toMatch(/never take a side/i);
  });

  it('the picture-book doctrine overrides the craft rules that do not apply to it', () => {
    const d = CHILDRENS_BOOK_TYPE.doctrine;
    // It still inherits the shared IP…
    expect(d).toContain('NEVER NARRATE THE BOOK’S OWN CONSTRUCTION'.replace('’', "'"));
    expect(d).toContain('FORBIDDEN AI-PROSE TELLS');
    // …but says plainly which general rules it supersedes, so the model isn't left to reconcile
    // "one voice, present tense, no hindsight" against "run the double perspective".
    expect(d).toMatch(/THIS wins/i);
    expect(d).toMatch(/NO double perspective/i);
    expect(d).toMatch(/read ALOUD/i);
  });

  /**
   * The bookshelf resolves a book's unit from `type.spine` alone — it has the type id but not the book's
   * commission answers (72 §3.1). That is only correct while no type's `spineFor` can cross INTO or OUT OF a
   * `pages` spine. Pin it: if a future type breaks the assumption, this fails and names the shelf.
   */
  it('no type’s commission answers can turn a page book into a chapter book, or the reverse', () => {
    for (const type of listBookTypes()) {
      const answerSets: Record<string, string>[] = [{}];
      for (const option of type.options ?? []) {
        for (const choice of option.choices ?? []) answerSets.push({ [option.id]: choice.value });
      }
      for (const answers of answerSets) {
        expect(
          resolveSpine(type, answers).kind === 'pages',
          `${type.id} with ${JSON.stringify(answers)}`,
        ).toBe(type.spine.kind === 'pages');
      }
    }
  });
});

describe('erotica has its own registers (72 §3.2)', () => {
  const erotica = getBookType('erotica')!;

  it('offers voices written for it, and none of the biography’s', () => {
    const ids = erotica.stylePresets.map((p) => p.id);
    expect(ids).toEqual([
      'sensory',
      'slowBurn',
      'raunchy',
      'tender',
      'confessional',
      'filthyTalk',
      'playful',
      'aching',
      'hardcore',
      'cinematic',
      'literary',
    ]);
    // The bug this replaced: it borrowed the biography list, so an erotic book was offered
    // "Journalistic — reportorial and evidence-led" and "Warm — dinner-table narration".
    expect(ids).not.toContain('journalistic');
    expect(ids).not.toContain('warm');
    expect(ids).not.toContain('plain');
  });

  /** Style is VOICE; how explicit the book is belongs to `tier`. Two dials for one outcome is the failure. */
  it('keeps voice and heat as separate controls', () => {
    const tier = erotica.options?.find((o) => o.id === 'tier');
    expect(tier?.choices?.map((c) => c.value)).toEqual(['unfiltered', 'explicit']);
    // No style promises a heat level — that would compete with the tier rather than being governed by it.
    for (const preset of erotica.stylePresets) {
      expect(preset.directive.toLowerCase()).not.toMatch(/\bmore explicit\b|\bless explicit\b/);
    }
  });

  /** Kink and taboo name CONTENT. As a one-tap style they'd push material regardless of what the person's
   *  own recorded desire says — the inverse of this type's premise. Subject matter comes from their
   *  material plus the optional `focus`. */
  it('offers no style that picks the subject matter for them', () => {
    const ids = erotica.stylePresets.map((p) => p.id);
    expect(ids).not.toContain('kinky');
    expect(ids).not.toContain('taboo');
    const focus = erotica.options?.find((o) => o.id === 'focus');
    expect(focus?.kind).toBe('text'); // free text, not a fixed kink taxonomy (71 §5.3)
    expect(focus?.required).toBeFalsy(); // blank = draw on everything they've said they want
  });

  it('every preset carries a directive and a specimen in both voices', () => {
    for (const preset of erotica.stylePresets) {
      expect(preset.directive.length, `${preset.id} directive`).toBeGreaterThan(20);
      expect(preset.specimen.first.length, `${preset.id} first`).toBeGreaterThan(0);
      expect(preset.specimen.third.length, `${preset.id} third`).toBeGreaterThan(0);
      // The commission screen shows one or the other, so they must actually differ.
      expect(preset.specimen.first).not.toBe(preset.specimen.third);
    }
  });

  it('asks about desire, not a life story', () => {
    // It borrowed the biography's interview too, so it asked for "a low point that stayed with you".
    const keys = erotica.interview.scenes.map((s) => s.key);
    expect(keys).not.toContain('lowPoint');
    expect(keys).not.toContain('highPoint');
    expect(keys).toContain('charge');
    // A type whose doctrine makes hard limits absolute must actually ask what they are.
    expect(keys).toContain('limits');
  });

  it('every style id is a real BookStyle', () => {
    for (const preset of erotica.stylePresets) {
      expect(BookStyleSchema.safeParse(preset.id).success, preset.id).toBe(true);
    }
  });
});

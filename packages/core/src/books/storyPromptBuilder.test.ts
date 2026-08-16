import { describe, expect, it } from 'vitest';
import { BookConfigSchema } from '../schemas';
import { BIOGRAPHY_BOOK_TYPE, getBookType } from './bookTypes';
import type { StoryCorpus } from './storyCorpus';
import type { BookChapter, BookOutline, ExclusionItem, MarkupMark } from '../schemas';
import {
  buildBiographerSystem,
  buildChapterUserMessage,
  buildChapterPlanMessage,
  buildCritiqueMessage,
  buildFoundationsUserMessage,
  buildRevisionUserMessage,
  renderCorpusForPrompt,
  renderTaggedCorpus,
  tagCorpusItems,
} from './storyPromptBuilder';

const cfg = (over: Partial<ReturnType<typeof BookConfigSchema.parse>> = {}) => ({
  ...BookConfigSchema.parse({}),
  ...over,
});

const corpus: StoryCorpus = {
  personName: 'Ben',
  profile: ['Occupation: teacher', 'Location: Denver'],
  items: [
    {
      sourceRef: { kind: 'insight', id: 'i1' },
      label: 'From a coaching session',
      text: 'He learned to sit with silence.',
      lifeArea: 'Emotions & patterns',
      date: '2026-05-12',
    },
  ],
};

describe('buildBiographerSystem (64 §5.2)', () => {
  it('leads with SAFETY, then the doctrine — the boundary always leads', () => {
    const sys = buildBiographerSystem(BIOGRAPHY_BOOK_TYPE, cfg(), 'Ben');
    const safetyAt = sys.indexOf('wellness');
    const doctrineAt = sys.indexOf('professional biographer');
    expect(safetyAt).toBeGreaterThanOrEqual(0);
    expect(doctrineAt).toBeGreaterThan(safetyAt); // doctrine comes AFTER safety
  });

  /**
   * 72 §5.1/§10 — assert the PROMPT, not just the constant. The doctrine is only worth fixing if the fix
   * actually reaches the model: a doctrine edit that never lands in the assembled system prompt would pass a
   * constant-only test while the live app keeps writing "the record doesn't say". (The spec-71 lesson: a green
   * suite that asserts the outcome, not the prompt, hid a fix that had been neutered entirely.)
   */
  it('carries the no-meta-narration rule into the assembled system prompt', () => {
    const sys = buildBiographerSystem(BIOGRAPHY_BOOK_TYPE, cfg(), 'Ben');
    expect(sys).toMatch(/NEVER NARRATE THE BOOK'S OWN CONSTRUCTION/);
    expect(sys).toMatch(/never assert what the material does not support/i);
    // And the instruction that taught the tic is not in the prompt the model actually receives.
    expect(sys.toLowerCase()).not.toContain('say so on the page');
  });

  it('third-person voice is the default and names the biographer as not-"I"', () => {
    const sys = buildBiographerSystem(BIOGRAPHY_BOOK_TYPE, cfg(), 'Ben');
    expect(sys).toMatch(/THIRD person about Ben/);
    expect(sys).not.toMatch(/FIRST person/);
  });

  it('first-person voice builds from the subject and forbids putting words in their mouth', () => {
    const sys = buildBiographerSystem(BIOGRAPHY_BOOK_TYPE, cfg({ voice: 'first' }), 'Ben');
    expect(sys).toMatch(/FIRST person, in Ben's own voice/);
    expect(sys).toMatch(/never put words in their mouth/);
  });

  it('applies the chosen style preset directive and length target', () => {
    const literary = buildBiographerSystem(BIOGRAPHY_BOOK_TYPE, cfg({ style: 'literary' }), 'Ben');
    expect(literary).toContain('Literary register');
    const full = buildBiographerSystem(BIOGRAPHY_BOOK_TYPE, cfg({ length: 'full' }), 'Ben');
    expect(full).toMatch(/16–24 chapters/);
    const concise = buildBiographerSystem(BIOGRAPHY_BOOK_TYPE, cfg({ length: 'concise' }), 'Ben');
    expect(concise).toMatch(/6–10 chapters/);
  });

  it('falls back to a generic subject label when the name is blank', () => {
    const sys = buildBiographerSystem(BIOGRAPHY_BOOK_TYPE, cfg(), '   ');
    expect(sys).toMatch(/about the subject/);
  });
});

describe('renderCorpusForPrompt + buildFoundationsUserMessage', () => {
  it('renders the profile and the source material with provenance meta', () => {
    const rendered = renderCorpusForPrompt(corpus);
    expect(rendered).toContain('WHO THEY ARE');
    expect(rendered).toContain('Occupation: teacher');
    expect(rendered).toContain('WHAT IS KNOWN');
    expect(rendered).toContain('He learned to sit with silence.');
    expect(rendered).toContain('From a coaching session');
  });

  it('the foundations message asks for essence + timeline + outline JSON and never-invent', () => {
    const msg = buildFoundationsUserMessage(corpus, BIOGRAPHY_BOOK_TYPE);
    expect(msg).toContain('"essence"');
    expect(msg).toContain('"timeline"');
    expect(msg).toContain('"outline"');
    expect(msg).toMatch(/never invent beyond it/i);
    expect(msg).toMatch(/character-revealing scene, not at birth/);
    expect(msg).toContain('He learned to sit with silence.'); // the corpus is embedded
    expect(msg).toMatch(/ONLY the JSON object/);
  });
});

describe('buildChapterUserMessage', () => {
  const outline: BookOutline = {
    schemaVersion: 1,
    approved: true,
    parts: [
      {
        id: 'p1',
        title: 'Roots',
        chapters: [
          {
            id: 'c1',
            title: 'The Garage',
            brief: 'He learns a machine obeys.',
            lifeAreas: [],
            order: 0,
          },
          { id: 'c2', title: 'Leaving', brief: 'A move west.', lifeAreas: [], order: 1 },
        ],
      },
    ],
  };

  /**
   * 72 §4.1 — a fictionalized book must be TOLD it may invent, or the doctrine's "never invent" silently
   * governs and a children's story comes out as a diary entry. The told-true case must be told the opposite,
   * just as explicitly.
   */
  it('states the truth contract, and states it differently for a fictionalized book', () => {
    const told = buildBiographerSystem(BIOGRAPHY_BOOK_TYPE, cfg(), 'Ben');
    expect(told).toMatch(/this book is TRUE/);
    expect(told).toMatch(/Never invent an event/i);

    const imagined = buildBiographerSystem(
      { ...BIOGRAPHY_BOOK_TYPE, truthMode: 'fictionalized' },
      cfg(),
      'Ben',
    );
    expect(imagined).toMatch(/openly IMAGINED/);
    expect(imagined).toMatch(/You may invent events/i);
    // …but never the person. That is the line a fictionalized book must not cross.
    expect(imagined).toMatch(/never misrepresent the human being/i);
  });

  it('shapes the outline by the book’s SPINE, not by assuming every book is a whole life', () => {
    const eras = buildFoundationsUserMessage(corpus, BIOGRAPHY_BOOK_TYPE);
    expect(eras).toMatch(/parts as life eras/i);

    const span = buildFoundationsUserMessage(corpus, {
      ...BIOGRAPHY_BOOK_TYPE,
      spine: { kind: 'span', from: '2019', to: '2020' },
    });
    expect(span).toMatch(/ONE bounded stretch of time \(2019 to 2020\)/);
    expect(span).toMatch(/Do not reach back across the whole life/i);
    expect(span).not.toMatch(/parts as life eras/i);

    const pages = buildFoundationsUserMessage(corpus, {
      ...BIOGRAPHY_BOOK_TYPE,
      spine: { kind: 'pages', count: 14, wordsPerPage: 40 },
    });
    expect(pages).toMatch(/exactly 14 short PAGES/);
    expect(pages).toMatch(/roughly 40 words/);

    const vignettes = buildFoundationsUserMessage(corpus, {
      ...BIOGRAPHY_BOOK_TYPE,
      spine: { kind: 'vignettes' },
    });
    expect(vignettes).toMatch(/standalone pieces/i);
    expect(vignettes).toMatch(/no through-line/i);
  });

  /**
   * 72 §4.1 — the commission answers are per BOOK, so they have to reach the model per book. Stored and
   * never read would mean the person picks "written to them" and gets a book about them.
   */
  it('carries this book’s own commission answers into the prompt', () => {
    const portrait = getBookType('portrait')!;
    const to = buildBiographerSystem(
      portrait,
      cfg({ typeOptions: { addressee: 'toThem' } }),
      'Ben',
    );
    expect(to).toMatch(/written TO its subject/);
    expect(to).toMatch(/second person/i);

    const about = buildBiographerSystem(
      portrait,
      cfg({ typeOptions: { addressee: 'aboutThem' } }),
      'Ben',
    );
    expect(about).toMatch(/written ABOUT its subject/);
    expect(about).toMatch(/Never address them as "you"/);
  });

  /**
   * The explicit register must GOVERN the style preset, not sit under it — a warm or literary directive
   * otherwise dilutes it back into the tasteful version, which is exactly the failure 08 §24.9 documented.
   */
  it('states the erotica register AFTER the style directive, and says it governs it', () => {
    const erotica = getBookType('erotica')!;
    // Uses a style erotica ACTUALLY offers. This read `style: 'warm'`, which erotica stopped offering when
    // it got its own registers — so the directive was absent, `indexOf` returned -1, and the ordering
    // assertion below was trivially true. A tender register is the right test anyway: it's the one most
    // likely to soften the explicit register if the ordering were wrong.
    const sys = buildBiographerSystem(
      erotica,
      cfg({ style: 'tender', typeOptions: { tier: 'unfiltered' } }),
      'Ben',
    );
    expect(sys).toMatch(/most explicit/i);
    expect(sys).toMatch(/GOVERNS the style and tone directives above/);
    const styleAt = sys.indexOf('Tender register');
    expect(styleAt).toBeGreaterThan(-1); // the style directive is really there to be governed
    expect(sys.indexOf('GOVERNS the style')).toBeGreaterThan(styleAt);
    // The boundary is never softened by the register.
    expect(sys).toMatch(/consenting adult/i);
    expect(sys).toMatch(/Never a minor/i);
  });

  /** The focus is the author's instruction for their OWN book, so it governs subject — but it must never
   *  read as permission to cross a recorded limit, which is the one thing this type cannot bend. */
  it('carries this book’s focus, and says plainly that it does not relax the boundary', () => {
    const erotica = getBookType('erotica')!;
    const sys = buildBiographerSystem(
      erotica,
      cfg({ typeOptions: { tier: 'explicit', focus: 'a long build in a hotel room' } }),
      'Ben',
    );
    expect(sys).toMatch(/THIS BOOK'S FOCUS: a long build in a hotel room/);
    expect(sys).toMatch(/does NOT relax the boundary/);
    expect(sys).toMatch(/hard limit stays out/i);
  });

  it('says nothing about focus when none was given, so the book draws on everything', () => {
    const erotica = getBookType('erotica')!;
    const sys = buildBiographerSystem(erotica, cfg({ typeOptions: { tier: 'explicit' } }), 'Ben');
    expect(sys).not.toMatch(/THIS BOOK'S FOCUS/);
  });

  it('an unanswered choice falls back to its first option rather than going silent', () => {
    const erotica = getBookType('erotica')!;
    const sys = buildBiographerSystem(erotica, cfg(), 'Ben');
    expect(sys).toMatch(/most explicit/i); // `unfiltered` is declared first
  });

  it('tags corpus items with stable index-based [sN] tags', () => {
    const tagged = tagCorpusItems(corpus);
    expect(tagged[0]?.tag).toBe('s0');
    expect(tagged[0]?.sourceRef.id).toBe('i1');
  });

  it('embeds the brief, marks the target chapter, and asks for [[SRC]] citations', () => {
    const msg = buildChapterUserMessage(corpus, {
      chapter: outline.parts[0]!.chapters[0]!,
      outline,
      essence: 'A quiet man.',
    });
    expect(msg).toMatch(/WRITE THIS CHAPTER — "The Garage"/);
    expect(msg).toContain('He learns a machine obeys.'); // the brief
    expect(msg).toContain('▶'); // the target chapter is marked in the ToC
    expect(msg).toMatch(/\[\[SRC:sN,sN\]\]/); // the citation instruction
    expect(msg).toMatch(/draw only on it/i);
    // The source material itself is NOT here — it rides the cached system prefix (72 §5.3), so the three or
    // four passes over one chapter pay for it once instead of four times.
    expect(msg).not.toContain('He learned to sit with silence.');
    expect(msg).toMatch(/in your instructions above/i);
  });

  it('puts the tagged corpus in the SYSTEM prompt, where it can be cached across the craft passes', () => {
    const tagged = tagCorpusItems(corpus);
    const withCorpus = buildBiographerSystem(
      BIOGRAPHY_BOOK_TYPE,
      cfg(),
      'Ben',
      renderTaggedCorpus(corpus, tagged),
    );
    expect(withCorpus).toContain('[s0]');
    expect(withCorpus).toContain('He learned to sit with silence.');
    // Every other caller passes nothing and is byte-unchanged.
    expect(buildBiographerSystem(BIOGRAPHY_BOOK_TYPE, cfg(), 'Ben')).not.toContain('[s0]');
  });
});

describe('buildRevisionUserMessage (64 §3.3.1/§5.3)', () => {
  const chapter: BookChapter = {
    id: 'c1',
    schemaVersion: 1,
    partId: 'p1',
    order: 0,
    title: 'The Garage',
    markdown: 'The garage smelled of cut pine.\n\nHe watched the lathe turn.',
    revision: 1,
    status: 'new',
    sourceSignature: '',
    provenance: [],
    protectedBlocks: [
      { anchor: { paragraphId: 'p0', quote: 'my own words' }, text: 'my own words' },
    ],
    pinnedQuotes: [],
    imagePlacements: [],
  };
  const marks: MarkupMark[] = [
    {
      id: 'd1',
      kind: 'delete',
      anchor: { paragraphId: 'p1', quote: 'He watched the lathe turn.' },
      status: 'pending',
      createdAt: 'n',
    },
    {
      id: 'm1',
      kind: 'comment',
      anchor: { paragraphId: 'p0', quote: 'cut pine' },
      intent: 'addContext',
      text: 'the lathe was three generations old',
      status: 'open',
      createdAt: 'n',
    },
    {
      id: 'q1',
      kind: 'comment',
      anchor: { paragraphId: 'p0' },
      intent: 'question',
      text: 'why this framing?',
      status: 'open',
      createdAt: 'n',
    },
  ];
  const exclusions: ExclusionItem[] = [
    { id: 'e1', kind: 'topic', value: 'the divorce', createdAt: 'n' },
  ];

  it('carries the current prose, renders edit instructions, and lists preserve + exclude', () => {
    const tagged = tagCorpusItems(corpus);
    const msg = buildRevisionUserMessage(corpus, tagged, { chapter, marks, exclusions });
    expect(msg).toContain('THE CURRENT CHAPTER');
    expect(msg).toContain('The garage smelled of cut pine.'); // the current prose is seeded
    expect(msg).toMatch(/CUT this entirely/); // the delete
    expect(msg).toMatch(/WEAVE IN this context.*three generations old/s); // the addContext comment
    expect(msg).not.toContain('why this framing?'); // a question comment is NOT an edit instruction
    expect(msg).toMatch(/PRESERVE these exact passages/);
    expect(msg).toContain('my own words'); // the protected block
    expect(msg).toMatch(/NEVER include or reintroduce/);
    expect(msg).toContain('the divorce'); // the exclusion
    expect(msg).toMatch(/\[\[SRC:sN,sN\]\]/); // still asks for fresh citations
  });

  it('handles a chapter with no pending edits (re-cite only) and no preserve/exclude lists', () => {
    const tagged = tagCorpusItems(corpus);
    const bare: BookChapter = { ...chapter, protectedBlocks: [] };
    const msg = buildRevisionUserMessage(corpus, tagged, {
      chapter: bare,
      marks: [],
      exclusions: [],
    });
    expect(msg).toMatch(/no textual changes/);
    expect(msg).not.toMatch(/PRESERVE these exact passages/);
    expect(msg).not.toMatch(/NEVER include or reintroduce/);
  });
});

/**
 * 72 P6 — the commission answers that name a PERSON. These reach the model or they reach nothing: a picture
 * book whose prompt never names its hero writes about a generic child, and a portrait whose prompt never
 * names its subject writes about the author. Both assert the PROMPT, never a call count.
 */
describe('person commission answers reach the prompt (72 §4.1)', () => {
  const childrens = getBookType('childrens')!;

  it('names the hero of a children’s book', () => {
    const sys = buildBiographerSystem(
      childrens,
      cfg({ typeOptions: { hero: 'p-mira' } }),
      'Ben',
      undefined,
      { 'p-mira': 'Mira' },
    );
    expect(sys).toContain('THE HERO: Mira');
    expect(sys).toMatch(/the one who acts/i);
  });

  it('names BOTH heroes when a book stars two siblings, and makes neither a sidekick', () => {
    const sys = buildBiographerSystem(
      childrens,
      cfg({ typeOptions: { hero: 'p-mira,p-arlo' } }),
      'Ben',
      undefined,
      { 'p-mira': 'Mira', 'p-arlo': 'Arlo' },
    );
    expect(sys).toContain('THE HEROES: Mira and Arlo');
    expect(sys).toMatch(/neither is a sidekick/i);
  });

  it('NEVER puts a raw person id in the prompt when the name cannot be resolved', () => {
    // A deleted person, or a caller that forgot the map. Emitting the uuid would both leak an internal id
    // into the model's context and produce a book about someone called "p-mira".
    const sys = buildBiographerSystem(childrens, cfg({ typeOptions: { hero: 'p-mira' } }), 'Ben');
    expect(sys).not.toContain('p-mira');
    expect(sys).not.toContain('THE HERO');
  });

  it('names the subject of a PORTRAIT — the answer that was stored and read by nothing', () => {
    // Pre-P6 this required question reached no directive, so the model was never told whose portrait it was.
    const sys = buildBiographerSystem(
      getBookType('portrait')!,
      cfg({ typeOptions: { subject: 'p-ang', addressee: 'aboutThem' } }),
      'Ben',
      undefined,
      { 'p-ang': 'Angel' },
    );
    expect(sys).toContain('THE SUBJECT: this book is about Angel.');
    // …and it does not confuse the subject with the person whose material it is drawn from.
    expect(sys).toMatch(/not the person whose material/i);
  });
});

describe('a picture book is measured in pages, not chapters (72 §4.1)', () => {
  const childrens = getBookType('childrens')!;

  it('states the exact page count and page length, and never the chapter-length directive', () => {
    const sys = buildBiographerSystem(childrens, cfg({ length: 'full' }), 'Ben');
    expect(sys).toContain('exactly 32 pages');
    expect(sys).toContain('about 40 words');
    // `length: 'full'` would otherwise ask for "16–24 chapters of 2,500–5,000 words" alongside it — a
    // contradiction the model resolves the wrong way.
    expect(sys).not.toMatch(/2,500–5,000 words/);
    expect(sys).not.toMatch(/roughly 16–24 chapters/);
  });

  it('follows the commission’s page count', () => {
    const sys = buildBiographerSystem(childrens, cfg({ typeOptions: { length: '16' } }), 'Ben');
    expect(sys).toContain('exactly 16 pages');
  });

  it('tells the model who is listening, and how', () => {
    const sys = buildBiographerSystem(childrens, cfg(), 'Ben');
    expect(sys).toContain('AUDIENCE:');
    expect(sys).toContain('aged 3–7');
    expect(sys).toContain('read aloud by an adult');
  });

  it('leaves every other type’s length directive byte-unchanged', () => {
    const sys = buildBiographerSystem(BIOGRAPHY_BOOK_TYPE, cfg({ length: 'full' }), 'Ben');
    expect(sys).toContain('roughly 16–24 chapters');
    expect(sys).not.toContain('pages');
    expect(sys).not.toContain('AUDIENCE:');
  });
});

/**
 * Why an erotic book came out tame however explicit the register said to be. Two mechanical causes, both in
 * the prompt: the shared craft block forbade inventing bodily detail and forbade lingering, and the editor
 * pass then flagged whatever explicit detail survived as `inventedDetail` so the revise pass deleted it.
 */
describe('erotica is not written as a biography (72 §3.2)', () => {
  const erotica = getBookType('erotica')!;
  const sys = (): string =>
    buildBiographerSystem(
      erotica,
      cfg({ style: 'raunchy', typeOptions: { tier: 'unfiltered' } }),
      'Ben',
    );

  it('does not forbid the invention it is made of', () => {
    // "Sacred carnality: … Where you lack it … NEVER invent it" is a rule for a TRUE life story. For a book
    // whose own opening says the events are invented, it forbids the substance of the form.
    expect(sys()).not.toMatch(/NEVER invent it/);
    expect(sys()).toMatch(/INVENT it freely/);
  });

  it('does not tell it to stop dwelling on the thing it is about', () => {
    // "never linger gratuitously" is for handling a painful memory with distance — the opposite instruction.
    expect(sys()).not.toMatch(/linger gratuitously/);
    expect(sys()).toMatch(/Lingering IS the form/);
  });

  it('says plainly to write the scene rather than around it', () => {
    expect(sys()).toMatch(/not a book that fades out at the door/);
  });

  it('keeps the craft and the boundary that are still right', () => {
    const s = sys();
    expect(s).toMatch(/Make the reader SEE it/); // scene over summary survives
    expect(s).toMatch(/NEVER NARRATE THE BOOK'S OWN CONSTRUCTION/); // meta-narration ban survives
    expect(s).toMatch(/tapestry/); // the banned AI tells survive
    expect(s).toMatch(/consenting adult/i);
    expect(s).toMatch(/hard limit recorded anywhere/i);
  });

  it('a told-true book is untouched by any of it', () => {
    const bio = buildBiographerSystem(getBookType('biography')!, cfg(), 'Ben');
    expect(bio).toMatch(/NEVER invent it/);
    expect(bio).toMatch(/linger gratuitously/);
    expect(bio).not.toMatch(/INVENT it freely/);
  });
});

describe('the editor does not mark a book down for inventing (72 §4.1)', () => {
  const corpus = { personName: 'Ben', profile: [], items: [] } as never;
  const chapter = { id: 'c1', title: 'The Hotel' } as never;

  it('judges an invented-events book on the PERSON, not the detail', () => {
    const msg = buildCritiqueMessage(corpus, {
      chapter,
      markdown: 'draft',
      truthMode: 'fictionalized',
    });
    // The old rule flagged "sensory detail the source material does not support" as the second-worst
    // defect — in a book made of invented sensory detail, that is every explicit line.
    expect(msg).not.toMatch(/inventedDetail/);
    expect(msg).toMatch(/inventedPerson/);
    expect(msg).toMatch(/EVENTS here are invented by design and are never a defect/);
  });

  it('still holds a told-true book to the record', () => {
    const msg = buildCritiqueMessage(corpus, { chapter, markdown: 'draft', truthMode: 'true' });
    expect(msg).toMatch(/inventedDetail/);
    expect(msg).not.toMatch(/inventedPerson/);
  });

  it('defaults to the strict rule when no mode is given', () => {
    const msg = buildCritiqueMessage(corpus, { chapter, markdown: 'draft' });
    expect(msg).toMatch(/inventedDetail/);
  });
});

describe('a one-chapter book (72 §3.2)', () => {
  it('asks for a single complete piece, not an excerpt of a longer book', () => {
    const sys = buildBiographerSystem(BIOGRAPHY_BOOK_TYPE, cfg({ length: 'single' }), 'Ben');
    expect(sys).toMatch(/ONE chapter and no more/);
    expect(sys).toMatch(/complete in itself/);
    expect(sys).toMatch(/do not outline a book around it/i);
  });

  it('leaves the other lengths exactly as they were', () => {
    const s = (length: 'concise' | 'standard' | 'full'): string =>
      buildBiographerSystem(BIOGRAPHY_BOOK_TYPE, cfg({ length }), 'Ben');
    expect(s('concise')).toMatch(/roughly 6–10 chapters/);
    expect(s('standard')).toMatch(/roughly 10–18 chapters/);
    expect(s('full')).toMatch(/roughly 16–24 chapters/);
    for (const l of ['concise', 'standard', 'full'] as const) {
      expect(s(l)).not.toMatch(/ONE chapter and no more/);
    }
  });

  /** A picture book states an exact page count, which must keep winning over any length choice. */
  it('does not override a type that sets its own extent', () => {
    const childrens = getBookType('childrens')!;
    const sys = buildBiographerSystem(childrens, cfg({ length: 'single' }), 'Ben');
    expect(sys).toMatch(/exactly \d+ pages/);
    expect(sys).not.toMatch(/ONE chapter and no more/);
  });
});

describe('registers combine (72 §3.2)', () => {
  const erotica = getBookType('erotica')!;

  it('states every chosen register and says to hold them at once', () => {
    const sys = buildBiographerSystem(
      erotica,
      cfg({ style: 'slowBurn', styles: ['slowBurn', 'filthyTalk'], typeOptions: {} }),
      'Ben',
    );
    expect(sys).toMatch(/Slow-burn register/);
    expect(sys).toMatch(/Dialogue-forward register/);
    // Without this a model reads a list of registers as a menu and picks one.
    expect(sys).toMatch(/ALL 2 of these registers at once/);
    expect(sys).toMatch(/hold both in the same scene rather than averaging/);
  });

  it('a single register reads exactly as it did before combining existed', () => {
    const one = buildBiographerSystem(erotica, cfg({ style: 'raunchy' }), 'Ben');
    expect(one).toMatch(/Raunchy register/);
    expect(one).not.toMatch(/registers at once/);
    // A one-item list is the same thing as no list.
    const listOfOne = buildBiographerSystem(
      erotica,
      cfg({ style: 'raunchy', styles: ['raunchy'] }),
      'Ben',
    );
    expect(listOfOne).toBe(one);
  });

  it('falls back to the single style for a book commissioned before combining', () => {
    const sys = buildBiographerSystem(erotica, cfg({ style: 'tender' }), 'Ben');
    expect(sys).toMatch(/Tender register/);
  });

  it('the porn register is FOCUS, and the tier still governs how graphic it may be', () => {
    const sys = buildBiographerSystem(
      erotica,
      cfg({ style: 'hardcore', typeOptions: { tier: 'unfiltered' } }),
      'Ben',
    );
    expect(sys).toMatch(/all act, no interiority/i);
    expect(sys).toMatch(/about FOCUS, not permission/);
    // The register directive still comes last and still claims authority over the style.
    expect(sys.indexOf('GOVERNS the style')).toBeGreaterThan(sys.indexOf('Hardcore register'));
  });
});

describe('every rung of the explicit ladder reaches the model (72 §3.2)', () => {
  const erotica = getBookType('erotica')!;
  const at = (tier: string): string =>
    buildBiographerSystem(erotica, cfg({ style: 'sensory', typeOptions: { tier } }), 'Ben');

  it('states a distinct register for each', () => {
    expect(at('unfiltered')).toMatch(/most explicit/i);
    expect(at('explicit')).toMatch(/real sexual detail/i);
    expect(at('sensual')).toMatch(/SENSATION rather than anatomy/);
    expect(at('suggestive')).toMatch(/stop at the door/);
  });

  /** The two new rungs are quieter, which is exactly when a style could swamp them (08 §24.9). */
  it('keeps governing the style even at the quiet end', () => {
    for (const tier of ['sensual', 'suggestive']) {
      expect(at(tier)).toMatch(/GOVERNS the style and tone directives above/);
    }
  });

  /** "Suggestive" must not read as permission to be coy — that is the failure it would otherwise cause. */
  it('says the quietest rung is a choice, not shyness', () => {
    expect(at('suggestive')).toMatch(/deliberate choice, NOT shyness/);
    expect(at('sensual')).toMatch(/Nothing fades to black/);
  });

  it('never lets a rung soften the boundary', () => {
    for (const tier of ['unfiltered', 'explicit', 'sensual', 'suggestive']) {
      expect(at(tier)).toMatch(/consenting adult/i);
      expect(at(tier)).toMatch(/Children do not exist in this book/);
    }
  });
});

/**
 * "Name acts and bodies plainly" is satisfiable with "his hardness, her heat" — technically plain, still
 * euphemism, and exactly how an explicit register gets quietly diluted. The directive names the vocabulary.
 */
describe('the explicit rungs name the vocabulary (72 §3.2)', () => {
  const erotica = getBookType('erotica')!;
  const at = (tier: string): string =>
    buildBiographerSystem(erotica, cfg({ style: 'raunchy', typeOptions: { tier } }), 'Ben');

  it('says which words, on both explicit rungs', () => {
    for (const tier of ['unfiltered', 'explicit']) {
      expect(at(tier)).toMatch(/tits, NEVER breasts/);
      expect(at(tier)).toMatch(/wet, soaked, dripping, throbbing/);
    }
  });

  it('bans the euphemisms that dilute it, by name', () => {
    const sys = at('unfiltered');
    for (const banned of ['manhood', 'erection', 'core', 'entrance', 'folds', 'backside']) {
      expect(sys).toContain(banned);
    }
    expect(sys).toMatch(/supermarket romance/);
  });

  it('leaves the quiet rungs alone — vocabulary follows HEAT, not style', () => {
    // Raunchy + Suggestive must stay coherent: coarse in tone, with the act still off the page.
    for (const tier of ['sensual', 'suggestive']) {
      expect(at(tier)).not.toMatch(/tits, NEVER breasts/);
    }
  });
});

/**
 * The register was stated, and then up to ~40,000 tokens of corpus followed it — the corpus sits last
 * because that is where `cache_control` makes it cheap. So the governing instruction ended up buried, which
 * is 08 §24.9 exactly: when several steering blocks append to one prompt, the LAST one wins.
 */
describe('the register gets the last word (72 §5.2)', () => {
  const erotica = getBookType('erotica')!;
  const withCorpus = (tier: string): string =>
    buildBiographerSystem(
      erotica,
      cfg({ style: 'hardcore', typeOptions: { tier } }),
      'Ben',
      'SOURCE MATERIAL\n' + 'a long corpus line. '.repeat(200),
    );

  it('restates how to write AFTER the material, not only before it', () => {
    const sys = withCorpus('unfiltered');
    const corpusAt = sys.indexOf('SOURCE MATERIAL');
    const lastWordAt = sys.indexOf('LAST WORD');
    expect(corpusAt).toBeGreaterThan(-1);
    expect(lastWordAt).toBeGreaterThan(corpusAt);
    expect(sys).toMatch(/tits not breasts/);
    // The distinction that keeps the corpus from being read as a register.
    expect(sys).toMatch(/WHAT this book is about\. It does not change HOW it is written/);
  });

  it('restates the rung that was actually chosen', () => {
    expect(withCorpus('suggestive')).toMatch(/with the act off the page/);
    expect(withCorpus('suggestive')).not.toMatch(/at its most explicit/);
    expect(withCorpus('sensual')).toMatch(/sensation rather than anatomy/);
  });

  it('says nothing extra for a book with no register to govern', () => {
    const bio = buildBiographerSystem(BIOGRAPHY_BOOK_TYPE, cfg(), 'Ben', 'SOURCE MATERIAL');
    expect(bio).not.toMatch(/LAST WORD/);
  });
});

/**
 * Reported after the vocabulary landed: the prose still said "breast" and "he got hard". Naming a word
 * without forbidding its softer twin leaves the twin sitting there, and "he got hard" is a SUMMARY of a
 * physical change where the register calls for the change itself.
 */
describe('the explicit register forbids the softer twin (72 §3.2)', () => {
  const erotica = getBookType('erotica')!;
  const at = (tier: string): string =>
    buildBiographerSystem(
      erotica,
      cfg({ style: 'hardcore', typeOptions: { tier } }),
      'Ben',
      'CORPUS',
    );

  it('states the substitutions as pairs, not just a word list', () => {
    const sys = at('unfiltered');
    expect(sys).toMatch(/tits, NEVER breasts/);
    expect(sys).toMatch(/cock or dick, NEVER manhood/);
    expect(sys).toMatch(/pussy or cunt, NEVER sex, core/);
    expect(sys).toMatch(/fuck, NEVER make love/);
  });

  it('bans summarising a physical change, with the reported example named', () => {
    const sys = at('unfiltered');
    expect(sys).toMatch(/never SUMMARISE a change in a body/);
    expect(sys).toMatch(/“He got hard” is a summary and is banned/);
    expect(sys).toMatch(/stiffening, thickening, throbbing/);
  });

  it('holds the dialogue to the same register as the narration', () => {
    expect(at('unfiltered')).toMatch(/what they say out loud is as filthy as the narration/);
    expect(at('unfiltered')).toMatch(/Not “Finger me” but what she actually wants, named/);
  });

  /** The closing directive is the LAST thing read, so the substitutions have to survive to the end. */
  it('carries the substitutions into the last word too', () => {
    const sys = at('unfiltered');
    const last = sys.slice(sys.indexOf('LAST WORD'));
    expect(last).toMatch(/tits not breasts/);
    expect(last).toMatch(/cock not manhood/);
    expect(last).toMatch(/rather than summarised/);
  });

  it('leaves the quiet rungs out of it entirely', () => {
    for (const tier of ['sensual', 'suggestive']) {
      expect(at(tier)).not.toMatch(/tits, NEVER breasts/);
      expect(at(tier)).not.toMatch(/tits not breasts/);
    }
  });
});

/**
 * Reported: a fictionalized book read like a transcript of the vault with nothing invented around it. The
 * doctrine said the events are invented — and then the chapter instruction, at the moment of writing, said
 * "Draw ONLY on the source material above … rather than inventing it" to EVERY type. Same class as the
 * craft-block bug: a biography rule handed to a book that is not one.
 */
describe('a fictionalized book is told to invent, at the moment it writes (72 §4.1)', () => {
  const corpus = { personName: 'Ben', profile: [], items: [] } as never;
  const chapter = { id: 'c1', title: 'The Hotel', brief: 'b', order: 0, lifeAreas: [] } as never;
  const outline = { schemaVersion: 1, approved: true, parts: [] } as never;

  const chapterMsg = (truthMode: 'true' | 'fictionalized'): string =>
    buildChapterUserMessage(corpus, { chapter, outline, truthMode });

  it('tells an invented-events book to build something that never happened', () => {
    const msg = chapterMsg('fictionalized');
    expect(msg).not.toMatch(/Draw ONLY on the source material/);
    expect(msg).toMatch(/It is not a script/);
    expect(msg).toMatch(/Invent the events, the scenes, the dialogue/);
    expect(msg).toMatch(/reads like a retelling of the source has failed/);
  });

  it('still holds a told-true book to the record', () => {
    const msg = chapterMsg('true');
    expect(msg).toMatch(/Draw ONLY on the source material/);
    expect(msg).not.toMatch(/Invent the events/);
  });

  it('defaults to the record when no mode is given', () => {
    expect(buildChapterUserMessage(corpus, { chapter, outline })).toMatch(
      /Draw ONLY on the source/,
    );
  });

  /** Per-paragraph source citation is itself a pull toward literalness in a book that invents. */
  it('stops a fictionalized book reaching for a source just to cite one', () => {
    expect(chapterMsg('fictionalized')).toMatch(
      /Most paragraphs in an invented story will cite nothing/,
    );
    expect(chapterMsg('true')).toMatch(/cite the \[sN\] sources you drew on for it/);
  });

  it('plans invented scenes rather than a retelling', () => {
    const invented = buildChapterPlanMessage(corpus, {
      chapter,
      outline,
      truthMode: 'fictionalized',
    });
    expect(invented).toMatch(/INVENT these scenes/);
    expect(invented).toMatch(/put them somewhere that never happened/);
    // The told-true plan keeps its "no scene without material" rule.
    const told = buildChapterPlanMessage(corpus, { chapter, outline });
    expect(told).toMatch(/if the material only supports a general fact, that is not a scene/);
    expect(told).not.toMatch(/INVENT these scenes/);
  });
});

import { describe, expect, it } from 'vitest';
import { BookConfigSchema } from '../schemas';
import { BIOGRAPHY_BOOK_TYPE, getBookType } from './bookTypes';
import type { StoryCorpus } from './storyCorpus';
import type { BookChapter, BookOutline, ExclusionItem, MarkupMark } from '../schemas';
import {
  buildBiographerSystem,
  buildChapterUserMessage,
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
    const sys = buildBiographerSystem(
      erotica,
      cfg({ style: 'warm', typeOptions: { tier: 'unfiltered' } }),
      'Ben',
    );
    expect(sys).toMatch(/most explicit/i);
    expect(sys).toMatch(/GOVERNS the style and tone directives above/);
    expect(sys.indexOf('GOVERNS the style')).toBeGreaterThan(
      sys.indexOf('Warm, intimate register'),
    );
    // The boundary is never softened by the register.
    expect(sys).toMatch(/consenting adult/i);
    expect(sys).toMatch(/Never a minor/i);
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

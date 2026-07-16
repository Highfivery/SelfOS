import { describe, expect, it } from 'vitest';
import { BookConfigSchema } from '../schemas';
import { BIOGRAPHY_BOOK_TYPE } from './bookTypes';
import type { StoryCorpus } from './storyCorpus';
import type { BookOutline } from '../schemas';
import {
  buildBiographerSystem,
  buildChapterUserMessage,
  buildFoundationsUserMessage,
  renderCorpusForPrompt,
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

  it('tags corpus items with stable index-based [sN] tags', () => {
    const tagged = tagCorpusItems(corpus);
    expect(tagged[0]?.tag).toBe('s0');
    expect(tagged[0]?.sourceRef.id).toBe('i1');
  });

  it('embeds the brief + tagged corpus, marks the target chapter, and asks for [[SRC]] citations', () => {
    const tagged = tagCorpusItems(corpus);
    const msg = buildChapterUserMessage(corpus, tagged, {
      chapter: outline.parts[0]!.chapters[0]!,
      outline,
      essence: 'A quiet man.',
    });
    expect(msg).toMatch(/WRITE THIS CHAPTER — "The Garage"/);
    expect(msg).toContain('He learns a machine obeys.'); // the brief
    expect(msg).toContain('▶'); // the target chapter is marked in the ToC
    expect(msg).toContain('[s0]'); // the tagged source
    expect(msg).toContain('He learned to sit with silence.'); // the source text
    expect(msg).toMatch(/\[\[SRC:sN,sN\]\]/); // the citation instruction
    expect(msg).toMatch(/draw only on the source material/i);
  });
});

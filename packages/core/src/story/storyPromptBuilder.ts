import { SAFETY } from '../conversations';
import type { BookConfig, BookOutline, OutlineChapter, StorySourceRef } from '../schemas';
import type { BookType } from './bookTypes';
import type { CorpusItem, StoryCorpus } from './storyCorpus';

/**
 * The Your Story prompt builder (64-your-story §5.2). Assembles the Biographer's system prompt and the
 * per-pass user messages from the book type's doctrine + the person's config + the corpus.
 *
 * Order matters: SAFETY (the wellness boundary) LEADS, then the book type's doctrine, then the
 * voice/style/length directives — so the doctrine steers the prose but never overrides the boundary (the
 * `buildSystemPrompt` precedent — the boundary always leads). This one system prompt is shared by the
 * foundations pass and (later) the chapter passes; only the user message differs.
 */

function voiceDirective(voice: BookConfig['voice'], name: string): string {
  return voice === 'first'
    ? `Narrative voice: write in the FIRST person, in ${name}'s own voice ("I…"). Build the voice from how ${name} actually speaks in the source material; never put words in their mouth that the material doesn't support.`
    : `Narrative voice: write in the THIRD person about ${name} (by name and by "he/she/they" as fits). You are the biographer — never "I".`;
}

function styleDirective(style: BookConfig['style'], bookType: BookType): string {
  const preset = bookType.stylePresets.find((p) => p.id === style);
  return preset ? preset.directive : '';
}

function lengthDirective(length: BookConfig['length']): string {
  switch (length) {
    case 'concise':
      return 'Length: a concise book — roughly 6–10 chapters, each short (about 900–1,500 words).';
    case 'full':
      return 'Length: a full book — roughly 16–24 chapters, each substantial (about 2,500–5,000 words), at professional memoir length.';
    default:
      return 'Length: a standard book — roughly 10–18 chapters, each about 1,500–3,000 words.';
  }
}

/**
 * The shared Biographer system prompt (§5.2): SAFETY boundary + the book type's doctrine + banned-prose
 * contract + the voice/style/length directives. Pure — no I/O, no cost.
 */
export function buildBiographerSystem(
  bookType: BookType,
  config: BookConfig,
  subjectName: string,
): string {
  const name = subjectName.trim() || 'the subject';
  return [
    SAFETY,
    bookType.doctrine,
    voiceDirective(config.voice, name),
    styleDirective(config.style, bookType),
    lengthDirective(config.length),
  ]
    .filter((part) => part.trim().length > 0)
    .join('\n\n');
}

/** Render the corpus as the source material block the model reads. Profile first, then every item grouped
 *  under its provenance label so the model can attribute (and the biographer's "turn every page" holds). */
export function renderCorpusForPrompt(corpus: StoryCorpus): string {
  const lines: string[] = [];
  if (corpus.profile.length > 0) {
    lines.push('WHO THEY ARE (profile):');
    for (const line of corpus.profile) lines.push(`  ${line}`);
  }
  if (corpus.items.length > 0) {
    lines.push('', 'WHAT IS KNOWN (source material — draw only on this; never invent beyond it):');
    for (const item of corpus.items) {
      const meta = [item.label, item.date, item.lifeArea].filter(Boolean).join(' · ');
      lines.push(`- (${meta}) ${item.text}`);
    }
  }
  return lines.join('\n');
}

/** A corpus item paired with the short `[sN]` citation tag the chapter prompt gives it, so the model can
 *  cite its sources per paragraph and we can resolve those citations back to provenance (§5.3). */
export interface TaggedCorpusItem {
  tag: string;
  sourceRef: StorySourceRef;
  item: CorpusItem;
}

/** Assign each corpus item a stable, index-based citation tag (`s0`, `s1`, …). Pure + deterministic, so the
 *  prompt render and the marker-stripping resolve to the same mapping. */
export function tagCorpusItems(corpus: StoryCorpus): TaggedCorpusItem[] {
  return corpus.items.map((item, i) => ({ tag: `s${i}`, sourceRef: item.sourceRef, item }));
}

/** Render the tagged corpus for a chapter prompt: profile first, then each source line prefixed with its
 *  `[sN]` tag so the model can cite it. */
function renderTaggedCorpus(corpus: StoryCorpus, tagged: TaggedCorpusItem[]): string {
  const lines: string[] = [];
  if (corpus.profile.length > 0) {
    lines.push('WHO THEY ARE (profile):');
    for (const line of corpus.profile) lines.push(`  ${line}`);
  }
  if (tagged.length > 0) {
    lines.push('', 'SOURCE MATERIAL (cite by [sN]; draw ONLY on this — never invent beyond it):');
    for (const { tag, item } of tagged) {
      const meta = [item.label, item.date, item.lifeArea].filter(Boolean).join(' · ');
      lines.push(`[${tag}] (${meta}) ${item.text}`);
    }
  }
  return lines.join('\n');
}

/**
 * The CHAPTER user message (§5.3): write ONE chapter's prose from the corpus, following its brief, sitting it
 * correctly among the other chapters, and citing the sources it drew on per paragraph with `[[SRC:sN]]`
 * markers (stripped into provenance host-side, never rendered). Markdown prose only — the doctrine + voice
 * live in the shared system prompt.
 */
export function buildChapterUserMessage(
  corpus: StoryCorpus,
  tagged: TaggedCorpusItem[],
  opts: { chapter: OutlineChapter; outline: BookOutline; essence?: string },
): string {
  const { chapter, outline, essence } = opts;
  const toc = outline.parts
    .flatMap((part) => part.chapters.map((c) => ({ part: part.title, c })))
    .map(({ part, c }) => `  ${c.id === chapter.id ? '▶ ' : '  '}${part} — ${c.title}: ${c.brief}`)
    .join('\n');
  const era = [chapter.eraFrom, chapter.eraTo].filter(Boolean).join('–');
  return [
    `You are writing ONE chapter of ${corpus.personName || 'this person'}'s book${
      essence ? `. The book is about: ${essence}` : ''
    }.`,
    '',
    'Where this chapter sits (▶ = the one you are writing now):',
    toc,
    '',
    `WRITE THIS CHAPTER — "${chapter.title}"${era ? ` (${era})` : ''}: ${chapter.brief}`,
    '',
    renderTaggedCorpus(corpus, tagged),
    '',
    'Write the chapter as Markdown prose (short paragraphs; you may use *italics*; no headings, no lists, no tables). Open on a rendered scene, not a summary. Draw ONLY on the source material above — if a detail you need is missing, write around it rather than inventing it.',
    'At the END of each paragraph, cite the [sN] sources you drew on for it as `[[SRC:sN,sN]]` (use the exact tags above; omit the marker for a paragraph that draws on nothing specific). Do not cite sources you did not use.',
    'Return ONLY the chapter prose with its inline [[SRC:…]] markers — no title heading, no preamble.',
  ].join('\n');
}

/**
 * The FOUNDATIONS user message (§3.2/§5.3): ask the model to read the whole corpus and return the book's
 * ESSENCE (what it is about, in Caro's sense), a proposed TIMELINE (the chronology spine), and a proposed
 * OUTLINE (parts + chapters, each with a one–two sentence brief). Structural JSON only — no prose chapters
 * yet. Ids/order are minted server-side (never trusted from the model).
 */
export function buildFoundationsUserMessage(corpus: StoryCorpus, bookType: BookType): string {
  const framework = bookType.interview;
  return [
    `You are about to plan a ${bookType.label.toLowerCase()} of ${corpus.personName || 'this person'}.`,
    'First, READ everything below. Let the themes and the through-line emerge from the material before you shape anything (do not impose a template).',
    '',
    renderCorpusForPrompt(corpus),
    '',
    'Then return ONE JSON object with exactly these keys:',
    '- "essence": 2–4 sentences stating what THIS book is about — the emotional truth and through-line, not a summary of events. This governs every later chapter.',
    '- "timeline": an array of the key dated moments you can anchor, each { "label": string, "date"?: "YYYY" or "YYYY-MM-DD", "approx"?: a fuzzy label like "mid-90s" when no date is known }. Include only moments the material supports.',
    '- "outline": { "parts": [ { "title": string, "chapters": [ { "title": an evocative chapter title (not a bare number), "brief": 1–2 sentences on what this chapter is about and the one scene it turns on, "eraFrom"?: "YYYY", "eraTo"?: "YYYY", "lifeAreas"?: string[] } ] } ] }.',
    '',
    `Shape the chapters the way a life is actually organized — you may draw on the person's own life chapters and the key scenes (${framework.scenes.map((s) => s.label.toLowerCase()).join(', ')}). Open the book in a character-revealing scene, not at birth. Propose only chapters the material can actually support; where a chapter would be thin, make it broader or leave it for later.`,
    'Return ONLY the JSON object — no prose, no markdown fences.',
  ].join('\n');
}

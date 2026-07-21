import { SAFETY } from '../conversations';
import type {
  BookChapter,
  BookConfig,
  BookOutline,
  ExclusionItem,
  MarkupMark,
  OutlineChapter,
  StorySourceRef,
} from '../schemas';
import type { BookInterviewFramework, BookType } from './bookTypes';
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
  opts: {
    chapter: OutlineChapter;
    outline: BookOutline;
    essence?: string;
    /** The person's protected/pinned passages (their OWN words) a REWRITE of an existing chapter must keep
     *  verbatim — the same contract the revision prompt carries. The guarantee is still code
     *  (`enforceProtected` after the call); this is the first line of defense so the model weaves the words
     *  in naturally instead of the splice landing them at a paragraph seam. Empty on a first draft. */
    preserve?: string[];
  },
): string {
  const { chapter, outline, essence, preserve } = opts;
  const toc = outline.parts
    .flatMap((part) => part.chapters.map((c) => ({ part: part.title, c })))
    .map(({ part, c }) => `  ${c.id === chapter.id ? '▶ ' : '  '}${part} — ${c.title}: ${c.brief}`)
    .join('\n');
  const era = [chapter.eraFrom, chapter.eraTo].filter(Boolean).join('–');
  const parts = [
    `You are writing ONE chapter of ${corpus.personName || 'this person'}'s book${
      essence ? `. The book is about: ${essence}` : ''
    }.`,
    '',
    'Where this chapter sits (▶ = the one you are writing now):',
    toc,
    '',
    `WRITE THIS CHAPTER — "${chapter.title}"${era ? ` (${era})` : ''}: ${chapter.brief}`,
  ];
  if (preserve && preserve.length > 0) {
    parts.push(
      '',
      'PRESERVE these exact passages verbatim somewhere in the chapter (the person’s own words — never paraphrase, reword, or drop them):',
      ...preserve.map((t) => `- «${t}»`),
    );
  }
  parts.push(
    '',
    renderTaggedCorpus(corpus, tagged),
    '',
    'Write the chapter as Markdown prose (short paragraphs; you may use *italics*; no headings, no lists, no tables). Open on a rendered scene, not a summary. Draw ONLY on the source material above — if a detail you need is missing, write around it rather than inventing it.',
    'At the END of each paragraph, cite the [sN] sources you drew on for it as `[[SRC:sN,sN]]` (use the exact tags above; omit the marker for a paragraph that draws on nothing specific). Do not cite sources you did not use.',
    'Return ONLY the chapter prose with its inline [[SRC:…]] markers — no title heading, no preamble.',
  );
  return parts.join('\n');
}

/** Render one pending mark as a plain-language revision instruction (§5.3). A `question` comment is NOT an
 *  edit — it's the person asking the biographer why — so it never reaches this call (filtered by the caller);
 *  a `remind` to-do is personal and a `questions` to-do routes to the interview engine, also filtered out. */
function renderMarkInstruction(mark: MarkupMark): string | null {
  if (mark.kind === 'delete') {
    return `- CUT this entirely and smooth the seam so the prose still reads naturally: «${mark.anchor.quote ?? 'the anchored passage'}».`;
  }
  if (mark.kind === 'comment') {
    const near = mark.anchor.quote ? ` (near «${mark.anchor.quote}»)` : '';
    if (mark.intent === 'addContext') return `- WEAVE IN this context${near}: ${mark.text}`;
    if (mark.intent === 'fix') return `- CORRECT this — it is wrong${near}: ${mark.text}`;
    return null; // a 'question' comment doesn't change the prose
  }
  if (mark.kind === 'todo' && mark.todoKind === 'ask') {
    const near = mark.anchor?.quote ? ` (near «${mark.anchor.quote}»)` : '';
    return `- ${mark.text}${near}`;
  }
  return null;
}

/**
 * The REVISION user message (§3.3.1/§5.3): apply a batch of the person's pending marks to an EXISTING chapter
 * and return the full revised chapter. Unlike a fresh chapter, this seeds the model with the current prose and
 * asks it to make only the requested changes + smooth seams — preserving everything else, the protected/pinned
 * passages verbatim, and never reintroducing excluded material. It still cites per paragraph so provenance is
 * refreshed. The `PRESERVE` list is ALSO code-enforced after the call (`enforceProtected`); the exclusions are
 * ALSO filtered at the corpus boundary — the prompt instructions are the first line of defense, not the only.
 */
export function buildRevisionUserMessage(
  corpus: StoryCorpus,
  tagged: TaggedCorpusItem[],
  opts: { chapter: BookChapter; marks: MarkupMark[]; exclusions: ExclusionItem[] },
): string {
  const { chapter, marks, exclusions } = opts;
  const instructions = marks.map(renderMarkInstruction).filter((s): s is string => s !== null);
  const preserve = [
    ...chapter.protectedBlocks.map((b) => b.text),
    ...chapter.pinnedQuotes.map((q) => q.text),
  ].filter((t) => t.trim().length > 0);
  const exclude = exclusions
    .filter((e) => e.kind === 'topic' || e.kind === 'passage')
    .map((e) => e.value)
    .filter((v) => v.trim().length > 0);

  const parts = [
    `You are REVISING one chapter of ${corpus.personName || 'this person'}'s book. Make ONLY the changes requested below, then smooth any seams so the chapter still reads as a seamless whole. Keep everything else as it is — do not rewrite passages you were not asked to touch, and do not shorten the chapter beyond the requested cuts.`,
    '',
    'THE CURRENT CHAPTER:',
    chapter.markdown,
    '',
    'CHANGES TO MAKE:',
    instructions.length > 0
      ? instructions.join('\n')
      : '- (no textual changes — just re-cite the sources)',
  ];
  if (preserve.length > 0) {
    parts.push(
      '',
      'PRESERVE these exact passages verbatim (the person’s own words — never paraphrase, move, or remove them):',
      ...preserve.map((t) => `- «${t}»`),
    );
  }
  if (exclude.length > 0) {
    parts.push(
      '',
      'NEVER include or reintroduce these (the person has excluded them):',
      ...exclude.map((v) => `- ${v}`),
    );
  }
  parts.push(
    '',
    renderTaggedCorpus(corpus, tagged),
    '',
    'Return the FULL revised chapter as Markdown prose (short paragraphs; *italics* allowed; no headings, lists, or tables).',
    'At the END of each paragraph, cite the [sN] sources you drew on as `[[SRC:sN,sN]]` (exact tags above; omit for a paragraph that draws on nothing specific).',
    'Return ONLY the chapter prose with its inline [[SRC:…]] markers — no title heading, no preamble, no commentary on what you changed.',
  );
  return parts.join('\n');
}

/**
 * The ANSWER-THE-AUTHOR user message (§3.3): the person asked their biographer a question ABOUT a passage
 * ("where did this come from?", "why did you write it this way?"). Ground the reply in the SOURCE MATERIAL the
 * paragraph actually drew on (its provenance, resolved to corpus items) so the biographer can answer honestly
 * — "this came from a coaching session where you described…" — and say plainly when the record doesn't support
 * an answer (never invent). A short, warm, first-person reply as the biographer; NOT a rewrite of the chapter.
 */
export function buildAnswerAuthorMessage(opts: {
  personName: string;
  chapterTitle: string;
  paragraph: string;
  question: string;
  /** The corpus items the paragraph cited (resolved from its provenance) — the biographer's actual receipts. */
  sources: CorpusItem[];
}): string {
  const { personName, chapterTitle, paragraph, question, sources } = opts;
  const sourceLines =
    sources.length > 0
      ? sources
          .map((s) => `- (${[s.label, s.date, s.lifeArea].filter(Boolean).join(' · ')}) ${s.text}`)
          .join('\n')
      : '(This passage cited no specific source — it was written around what the record leaves unsaid.)';
  return [
    `You are ${personName || 'this person'}'s biographer. They are reading their book and have asked you a question about one passage. Answer it directly, warmly, and honestly, in the first person as the biographer — do NOT rewrite the chapter, do NOT use any [[SRC]] markers, just reply in a sentence or two.`,
    '',
    `THE CHAPTER: "${chapterTitle}"`,
    '',
    'THE PASSAGE THEY ASKED ABOUT:',
    paragraph,
    '',
    'THE SOURCE MATERIAL THIS PASSAGE DREW ON (your receipts — cite what it actually came from):',
    sourceLines,
    '',
    `THEIR QUESTION: ${question}`,
    '',
    'Answer from the source material above. If it genuinely doesn’t say, tell them so plainly ("the record doesn’t say — that was written to bridge two moments") rather than inventing. Reply with ONLY your answer — no preamble, no markers.',
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
    `- "title": an evocative, book-worthy title for THIS ${bookType.label.toLowerCase()}, drawn from its through-line — a few words, title case, the kind of title you'd see on a published book's spine. NOT a bare name and NOT a generic "The Story of ${corpus.personName || 'this person'}"; a subtitle only if it truly earns one.`,
    '- "essence": 2–4 sentences stating what THIS book is about — the emotional truth and through-line, not a summary of events. This governs every later chapter.',
    '- "timeline": an array of the key dated moments you can anchor, each { "label": string, "date"?: "YYYY" or "YYYY-MM-DD", "approx"?: a fuzzy label like "mid-90s" when no date is known }. Include only moments the material supports.',
    '- "outline": { "parts": [ { "title": string, "chapters": [ { "title": an evocative chapter title (not a bare number), "brief": 1–2 sentences on what this chapter is about and the one scene it turns on, "eraFrom"?: "YYYY", "eraTo"?: "YYYY", "lifeAreas"?: string[] } ] } ] }.',
    '',
    `Shape the chapters the way a life is actually organized — you may draw on the person's own life chapters and the key scenes (${framework.scenes.map((s) => s.label.toLowerCase()).join(', ')}). Open the book in a character-revealing scene, not at birth. Propose only chapters the material can actually support; where a chapter would be thin, make it broader or leave it for later.`,
    'Return ONLY the JSON object — no prose, no markdown fences.',
  ].join('\n');
}

/**
 * The GAP-PASS user message (§3.7/§5.5): score the book against the McAdams life-story framework + craft needs
 * and return (a) which dimensions the material ALREADY covers, and (b) the prioritized GAPS worth interviewing
 * for — each with a warm FOCUS brief the check-in minter turns into a question. It reads the current outline (+
 * which chapters are written), the corpus, and the framework's eight key scenes. The biographer's rule holds:
 * "take no one at their word" — mark a dimension covered ONLY if the material genuinely supports it, and NEVER
 * invent detail; where it's missing, that's a gap to interview for.
 */
export function buildGapPassUserMessage(
  corpus: StoryCorpus,
  opts: {
    outline: BookOutline;
    chapters: BookChapter[];
    framework: BookInterviewFramework;
    essence?: string;
    askedPrompts?: string[];
  },
): string {
  const { outline, chapters, framework, essence, askedPrompts } = opts;
  const writtenIds = new Set(chapters.filter((c) => c.markdown.trim().length > 0).map((c) => c.id));
  const toc = outline.parts
    .flatMap((part) => part.chapters.map((c) => ({ part: part.title, c })))
    .map(
      ({ part, c }) =>
        `  - ${part} — "${c.title}" [${writtenIds.has(c.id) ? 'written' : 'not written yet'}]: ${c.brief}`,
    )
    .join('\n');
  const sceneList = framework.scenes
    .map((s) => `  - ${s.key}: ${s.label} — ${s.prompt}`)
    .join('\n');
  const asked =
    askedPrompts && askedPrompts.length > 0
      ? `\nAlready asked (do NOT propose a gap that re-asks these):\n${askedPrompts.map((p) => `  - ${p}`).join('\n')}\n`
      : '';
  return [
    `You are the biographer taking stock of ${corpus.personName || 'this person'}'s book${
      essence ? ` (about: ${essence})` : ''
    } — what the life story has, and what it still needs before it can be richly told. Do NOT write prose.`,
    '',
    'THE OUTLINE (and which chapters are drafted):',
    toc,
    '',
    'THE PARTS (by id):',
    outline.parts.map((p) => `  - ${p.id}: ${p.title}`).join('\n'),
    '',
    'THE EIGHT KEY SCENES a full life story wants (McAdams):',
    sceneList,
    '',
    renderCorpusForPrompt(corpus),
    asked,
    '',
    'Return ONE JSON object with three keys:',
    '- "coverage": { "chapters": bool (are the life eras/chapters well mapped?), "scenes": { each scene key above → bool (is that scene actually present in the material, told as a scene?) }, "challenges": bool (are the person’s central struggles/obstacles covered?), "ideology": bool (are their values/beliefs/worldview covered?), "futureScript": bool (are their hopes/what-comes-next covered?) }. Mark a dimension TRUE only if the material genuinely supports it — take no one at their word.',
    '- "gaps": an array (top-priority FIRST, at most 6) of the most valuable things to interview for now, each { "dimension": one of the scene keys OR "chapters"/"challenges"/"ideology"/"futureScript" OR a craft gap "scene"/"sensory"/"timeline", "label": a short human title for the gap, "focus": 1–2 warm sentences briefing the question to ask — open How/What/Why, invite sensory + bodily detail ("what did the kitchen smell like"), and end deeper ones with one meaning-probe ("why does this matter — what does it say about you?"). NEVER ask for something the material already answers. }.',
    '- "partCoverage": { each PART id above → a number 0..1 for how richly told that era of the life is (1 = vivid and complete, 0 = barely touched). Base it on the material, not just whether a chapter was drafted. }',
    'Return ONLY the JSON object — no prose, no markdown fences.',
  ].join('\n');
}

/**
 * The STRUCTURE-ANALYSIS user message (§3.4/§5.4): given the CURRENT outline (with stable ids) and the corpus,
 * ask whether the book's SHAPE should change now that new material has arrived — a new chapter for an era/theme
 * that doesn't fit, splitting a chapter that grew too big, reordering within a part, or rewriting an opening
 * that no longer fits. It returns proposals only (never prose, never applied silently); every reference uses the
 * exact ids given here (the apply step re-validates them and drops any that no longer exist). Zero proposals is
 * a valid, common answer — most refreshes need no structural change.
 */
export function buildStructureUserMessage(
  corpus: StoryCorpus,
  opts: { outline: BookOutline; essence?: string },
): string {
  const { outline, essence } = opts;
  const structure = outline.parts
    .map((part) => {
      const chapters = part.chapters
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((c) => {
          const era = [c.eraFrom, c.eraTo].filter(Boolean).join('–');
          return `    - [chapter ${c.id}] "${c.title}"${era ? ` (${era})` : ''}: ${c.brief}`;
        })
        .join('\n');
      return `  [part ${part.id}] "${part.title}"\n${chapters}`;
    })
    .join('\n');
  return [
    `You are the biographer reviewing the SHAPE of ${corpus.personName || 'this person'}'s book${
      essence ? ` (about: ${essence})` : ''
    } now that the source material has grown. Decide whether the outline's structure should change — do NOT rewrite any prose.`,
    '',
    'THE CURRENT OUTLINE (use these exact ids in any proposal):',
    structure,
    '',
    renderCorpusForPrompt(corpus),
    '',
    'Return ONE JSON object: { "proposals": [ … ] }. Propose a change ONLY when the material clearly warrants it — an empty array is the right answer for a book that is already well-shaped. Each proposal is one of:',
    '- { "kind": "newChapter", "rationale": one sentence on why, "partId": an existing part id, "afterChapterId"?: an existing chapter id to insert after (omit for the end of the part), "title": an evocative title, "brief": 1–2 sentences, "eraFrom"?: "YYYY", "eraTo"?: "YYYY", "lifeAreas"?: string[] } — for an era/theme the current chapters don\'t hold.',
    '- { "kind": "splitChapter", "rationale": …, "chapterId": an existing chapter id, "firstTitle", "firstBrief", "secondTitle", "secondBrief" } — when one chapter has grown to cover two distinct things.',
    '- { "kind": "reorder", "rationale": …, "partId": an existing part id, "order": [every chapter id in that part, in the new order] } — when the sequence reads out of order.',
    '- { "kind": "prologueRewrite", "rationale": …, "chapterId": the opening chapter\'s id } — when the opening no longer fits the book it became.',
    'Keep the total to at most a few of the most valuable changes. Return ONLY the JSON object — no prose, no markdown fences.',
  ].join('\n');
}

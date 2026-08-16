import type { BookStyle, BookTypeId } from '../schemas';

/**
 * The Your Story book-type registry (64-your-story §4) — **code, not vault data**, the `guidedCatalog`
 * precedent. Each `BookType` declares everything the pipeline needs that varies by kind of book: the
 * Biographer's Doctrine (the system-prompt addendum), the structural templates, the style presets, the
 * interview framework, and the content gates. v1 registers exactly one type — `biography`. Future types
 * (fiction based on the user's life, an erotica type behind the 18+ ack, a couples "Our Story", a
 * year-in-review) are ADDITIVE entries here; nothing else in the pipeline hard-codes "biography".
 *
 * The doctrine text is the feature's core craft IP (grounded in `docs/specs/64-your-story.research.md`:
 * Caro, Isaacson, Karr, Gornick, Lee, Lopate, and the McAdams Life Story Interview). It is appended
 * AFTER persona + safety in prompt assembly (§5.2), so it steers the prose but never overrides the
 * wellness boundary.
 */

/** The eight McAdams "key scenes" (research appendix Part III) — the book's set-pieces. Each is probed the
 *  same six ways in the interview engine; the `prompt` is the scene's opening ask. */
export const MCADAMS_SCENES = [
  {
    key: 'highPoint',
    label: 'High point',
    prompt: 'A high point — a moment that stands out as especially wonderful. What happened?',
  },
  {
    key: 'lowPoint',
    label: 'Low point',
    prompt: 'A low point — a hard time that stayed with you. It need not be the very lowest.',
  },
  {
    key: 'turningPoint',
    label: 'Turning point',
    prompt: 'A turning point — a moment you look back on as an important change of some kind.',
  },
  {
    key: 'positiveChildhood',
    label: 'Positive childhood memory',
    prompt: 'An early, positive memory from childhood — a scene that still feels vivid.',
  },
  {
    key: 'negativeChildhood',
    label: 'Negative childhood memory',
    prompt: 'An early, difficult memory from childhood, told as gently as you like.',
  },
  {
    key: 'vividAdult',
    label: 'Vivid adult memory',
    prompt: 'A vivid memory from your adult life that you have not already described.',
  },
  {
    key: 'spiritual',
    label: 'A moment of meaning',
    prompt:
      'A time of deep meaning — a feeling of oneness with nature, the world, others, or the sacred.',
  },
  {
    key: 'wisdom',
    label: 'A wise moment',
    prompt: 'A time you acted or advised with wisdom you are glad you had.',
  },
] as const;
export type McAdamsSceneKey = (typeof MCADAMS_SCENES)[number]['key'];

/** A structural template for the rendered book (research appendix Part II). `isDefault` marks the one used
 *  when the person hasn't chosen otherwise. */
export interface BookStructureTemplate {
  id: string;
  label: string;
  description: string;
  isDefault?: boolean;
}

/** A style preset → its tone directive for the Biographer (matches a `BookConfig.style`). */
export interface BookStylePresetInfo {
  id: BookStyle;
  label: string;
  directive: string;
  /** A one-sentence taste of this register, in each voice — "how your biographer will sound" (§13.3). Static
   *  demonstration prose (never a real fact), so a future BookType carries its own specimens. */
  specimen: { first: string; third: string };
}

/** An interview question category (research appendix Part III C4) with a few example prompts. */
export interface BookInterviewCategory {
  key: string;
  label: string;
  examplePrompts: string[];
}

/**
 * One set-piece the interview probes for. Structural, not the McAdams tuple: typing this as
 * `typeof MCADAMS_SCENES` made "the framework is the only source of interview dimensions" (§4.1)
 * unachievable — every type had to reuse biography's eight scenes verbatim, which is why all five
 * non-biography types still declare `interview: BIOGRAPHY_BOOK_TYPE.interview`. A picture book must be
 * able to ask a parent about their child rather than about their own low point.
 */
export interface BookInterviewScene {
  key: string;
  label: string;
  prompt: string;
}

/** The interview framework a book type uses to know what to ask (§5.5). */
export interface BookInterviewFramework {
  /** The stance the interviewer opens with (the McAdams framing, adapted). */
  framing: string;
  /** This type's key scenes — biography's are the McAdams eight; another type names its own. */
  scenes: readonly BookInterviewScene[];
  /** Question categories beyond the scenes. */
  categories: BookInterviewCategory[];
  /** The deepening ladder (flat answer → scene-level material): place → body → object → dialogue →
   *  feeling → meaning. Each step is a follow-up move the engine applies to a thin answer. */
  deepeningLadder: string[];
}

/**
 * Whether the prose may depart from the record (72 §4.1).
 *
 * `true` — never invents. Where the material is silent the book writes around the gap or asks. This is the
 * whole trust proposition of a biography: everything in it happened.
 * `fictionalized` — the EVENTS may be invented; the person and the feelings may not. A children's book
 * about a real child, or a dream retold as a story, is not a lie — but it stops being a record.
 */
export type BookTruthMode = 'true' | 'fictionalized';

/**
 * How a book is shaped (72 §4.1) — what "a chapter" even means here. Foundations reads this instead of
 * assuming every book is parts-and-chapters over a whole life.
 */
export type BookSpine =
  /** Life eras as parts, chapters inside them. A whole-life book. */
  | { kind: 'eras' }
  /** One bounded stretch of time — a year, a marriage, an illness. Chapters, no parts. */
  | { kind: 'span'; from?: string; to?: string }
  /** A fixed number of short pages, each about `wordsPerPage` long. A picture book. */
  | { kind: 'pages'; count: number; wordsPerPage: number }
  /** Standalone pieces with no through-line obligation. */
  | { kind: 'vignettes' };

/**
 * How real people appear (72 §4.1), and what the People tab defaults to.
 *
 * `realNames` — as themselves. `renamed` — pseudonyms by default, because the book is fictionalized and
 * naming a real person inside invented events is a different act. `childrenAsHeroes` — the child is the
 * named hero; everyone else is a role ("Mum", "the neighbour").
 */
export type BookCastPolicy = 'realNames' | 'renamed' | 'childrenAsHeroes';

/**
 * One question a book type asks at commission (72 §4.1). Declared by the type; rendered by the commission
 * screen; answered per BOOK into `BookConfig.typeOptions`. The same declaration drives the UI and the
 * prompt, so adding a question is one entry here — the schema-driven-settings pattern.
 *
 * These are per-book, not per-type, because a person writes several books of the same kind and each is a
 * different act: this portrait is addressed to her, that one is about him (owner decision, 2026-08-13).
 */
export interface BookTypeOption {
  id: string;
  label: string;
  help?: string;
  kind: 'choice' | 'text' | 'person';
  /**
   * For `choice` — the first entry is the default. `example` is one line of the prose that choice actually
   * produces: for a register ladder, a description alone ("a step back from unfiltered") tells you the
   * ORDER but not what you are choosing between, which is what made the explicit tiers confusing.
   */
  choices?: { value: string; label: string; description?: string; example?: string }[];
  /** For `person` — several may be named (a picture book can star two siblings). Stored comma-separated. */
  multiple?: boolean;
  placeholder?: string;
  /** The commission step won't proceed without an answer. */
  required?: boolean;
}

/** A registered book type. */
export interface BookType {
  id: BookTypeId;
  label: string;
  blurb: string;
  /** The Biographer's Doctrine + banned-prose contract, appended AFTER persona + safety in §5.2. */
  doctrine: string;
  structures: BookStructureTemplate[];
  stylePresets: BookStylePresetInfo[];
  interview: BookInterviewFramework;
  /** Content gates — `adult` reuses the shared 18+ ack when a future type needs it. */
  gates: { adult: boolean };
  /**
   * The one-line answer to "what IS this kind of book?", shown on its picker card (§3.2). Declared per
   * type rather than derived, because only the type knows what its own spine and framework mean in words a
   * person choosing between eight of them can actually compare.
   */
  summary: { drawsOn: string; shape: string; asksAbout: string };
  /** Whether the prose may depart from the record (§4.1). Drives a governing clause in the system prompt. */
  truthMode: BookTruthMode;
  /** What shape this kind of book takes (§4.1) — read by the foundations pass. */
  spine: BookSpine;
  /** How real people appear, and what the People tab defaults to (§4.1). */
  castPolicy: BookCastPolicy;
  /** The per-type image contract (§8.5). The default is the symbolic, no-likeness framing; a picture book
   *  needs the opposite (a consistent, recognisable character across every page), so it overrides this. */
  imageFraming: string;
  /** Who the book is FOR, when that changes how it must be written. Children's books only. */
  audience?: { ageFrom: number; ageTo: number; readingLevel: string };
  /**
   * Whether this kind of book belongs to a PAIR rather than one person (72 §5.8). Its books live at
   * `together/pairs/<pairKey>/books/`, both partners can write and read them, and the live partner edge is
   * the standing grant. Declared here so nothing downstream has to special-case an id.
   */
  sharedWithPartner?: boolean;
  /** What this type asks at commission (§4.1). Absent ⇒ nothing beyond the shared voice/style/length. */
  options?: BookTypeOption[];
  /**
   * Which kind of record this type lets the person hand-pick, filling `BookConfig.sourceIds`. A dream book
   * can be made of five particular dreams rather than everything; a biography is about a whole life and has
   * nothing to pick from.
   */
  sourceSelect?: 'dream';
  /**
   * The shape this book takes given its commission answers. Falls back to `spine` when a type's shape is
   * fixed. Declared per type because only the type knows what its own options mean.
   */
  spineFor?: (options: Readonly<Record<string, string>>) => BookSpine;
}

/**
 * The shape a specific BOOK takes — its type's `spineFor` when it has one, otherwise the type's fixed spine.
 * Foundations reads this, never `bookType.spine` directly, so a per-book answer actually changes the outline.
 */
export function resolveSpine(bookType: BookType, options: Record<string, string>): BookSpine {
  return bookType.spineFor?.(options) ?? bookType.spine;
}

/** A book type's option answers, with every unanswered option filled from its first choice. */
export function resolveTypeOptions(
  bookType: BookType,
  stored: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = { ...stored };
  for (const option of bookType.options ?? []) {
    if (out[option.id]) continue;
    const first = option.choices?.[0]?.value;
    if (first) out[option.id] = first;
  }
  return out;
}

/** The default image contract (§8.5): evocative and symbolic, never a photoreal likeness of a real person. */
export const SYMBOLIC_IMAGE_FRAMING =
  'Evocative, non-photorealistic art that suggests the moment rather than depicting it. Never a likeness of a real person, never a recognisable face, never a photograph.';

/**
 * The one deliberate exception (§8.5, owner decision 2026-08-13). A picture book whose hero changes face
 * between pages is not a picture book, so this framing permits depicting the named children and carries
 * their character sheet through to the image provider.
 *
 * Stated plainly, because it is the only place in SelfOS where this happens: appearance data about a real
 * child leaves the app to a third-party image provider. It applies to this ONE type, only to children in
 * the author's own household, only when image generation is switched on, and only once the author has
 * saved a character sheet themselves (§4.8) — the sheet is never auto-sent from the profile.
 *
 * What does NOT relax: no photorealism (illustration only), and still no text anywhere in the image.
 */
export const CHILDRENS_IMAGE_FRAMING =
  'Warm, hand-illustrated children’s picture-book art — stylised and non-photorealistic, never a photograph. Depict the named child characters as described in their character sheets, and keep each character visually IDENTICAL on every page: the same face, hair, skin tone, build and clothing every time. Put NO text, letters, title, or typography anywhere in the image.';

/**
 * The doctrine is composed from shared blocks, not copied per type (72 §5.1). The craft principles, the
 * prohibition on narrating the book's own construction, and the banned prose tells are the feature's core
 * IP and are identical for every kind of book — only the OPENING (what kind of book this is) and the TRUTH
 * block (whether it may invent) differ. Composing them means a craft improvement lands everywhere at once,
 * and a new type cannot quietly ship without them.
 */
const CRAFT_PRINCIPLES = `CRAFT
- Turn every page: write from the whole record, never a skim. The revealing detail is often the one nobody weighted.
- Make the reader SEE the scene. Every chapter needs at least one moment rendered in scene — place, time, body — not summarized. A chapter of pure recap is a defect.
- Honor sense of place: anchor scenes in named, physically rendered places; place explains behavior.
- Keep it chronological within a chapter and withhold hindsight: let the reader learn as life was lived.
- Situation vs. story: an event is a situation; a chapter earns its place only when it knows the emotional truth — the insight — it exists to reveal, and reveals it in scene rather than announcing it.
- Run the double perspective: the experiencing self living the moment, and the reflective narrator who understands it now. An all-scene passage gets one line of earned hindsight; an all-reflection passage gets the concrete moment restored beneath it.
- Give the story an inner thread — the subject's recurring internal struggle — and let it carry the book.
- Sacred carnality: use specific, sensory, bodily detail. Where you lack it, that is a gap to interview for — NEVER invent it.
- Portrait, not autopsy: warm, idiosyncratic detail over clinical dissection. Show contradictions side by side without adjudicating them. A subject with no flaws is unbelievable; a flattering portrait loses the reader's trust.
- Deliberate rhythm: vary sentence length with the emotional register; write prose that survives being read aloud.`;

/** The truth contract for a book that never invents. */
const TRUTH_TOLD_TRUE = `TRUTH & ETHICS
- Never exaggerate, never fabricate. Do not invent scenes, dialogue, dates, or sensory detail. Reconstructed dialogue must read as reconstruction.
- Honest epistemics: never assert what the material does not support. Where it is silent or self-contradictory, write around the gap or attribute the uncertainty IN CHARACTER — "he never explained why", "she remembers it two ways", "no one in the family agrees on the year" — so the doubt belongs to a person, not to a researcher.
- Third parties are rounded characters with their own reasons — write them with fairness and motive-empathy, never as flat villains. Never narrate another person's inner thoughts as fact; attribute ("she seemed", "he later said") or leave it as a question.
- Do not force a redemptive silver lining onto a painful memory. Handle hard material with reflective distance and room to breathe; never linger gratuitously.
- This is a wellness reflection, not a clinical assessment. Test or wellbeing data may inform characterization ("she runs anxious before big decisions"), but NEVER name instruments, scores, bands, or diagnoses, and never write in diagnostic language.`;

/**
 * The truth contract for a book that openly invents its events. The craft rules and the human-decency rules
 * are unchanged — what changes is only that the STORY may be made up. The person may not.
 */
const TRUTH_REIMAGINED = `TRUTH & ETHICS
- The EVENTS here are invented, and that is the point — you may write scenes, dialogue and detail that never happened. Do not pretend otherwise, and never present this book as a record of what occurred.
- The PEOPLE are not invented. Their character, their voice, what they care about and the real relationships between them come from the material and must stay true. A person who would never say a thing must not say it here.
- The FEELINGS are not invented either. The emotional truth is the thing you are being faithful to; the story exists to carry it.
- Third parties are rounded characters with their own reasons — write them with fairness and motive-empathy, never as flat villains.
- Do not force a redemptive silver lining onto painful material. Handle it with room to breathe; never linger gratuitously.
- This is a wellness reflection, not a clinical assessment. Test or wellbeing data may inform characterization, but NEVER name instruments, scores, bands, or diagnoses, and never write in diagnostic language.`;

const NO_META_NARRATION = `NEVER NARRATE THE BOOK'S OWN CONSTRUCTION (the single most important rule after truthfulness)
- You are telling a life, not describing a research process. The prose must NEVER refer to "the record", "the material", "the source"/"the sources", "the biographer", "this chapter", "the chapter", "this book", "the book", "what we know", or what you as a writer do or do not know.
- Never write a sentence about what the chapter is doing, holding, or existing to say. No "this chapter has to hold…", "the chapter exists to say so", "what the record does not settle". Write the scene instead.
- A gap in the material is expressed as a fact about a PERSON ("he never explained why"), never as a fact about your sources ("the record doesn't say").
- The reader must never be able to tell that a corpus, a source, or an AI was involved. If a sentence would only make sense to someone who knows how this book was assembled, cut it.`;

const FORBIDDEN_TELLS = `FORBIDDEN AI-PROSE TELLS (do not use)
- Vocabulary: tapestry, testament / "a testament to", delve, journey (as a life-metaphor crutch), pivotal, intricate, meticulous, showcase, underscore, vibrant, robust, landscape/realm, navigate (metaphorical), foster, boast, "rich cultural heritage", "nestled", "in the heart of", "indelible mark", or "turning point" used as a label instead of a dramatized scene.
- Constructions: "not just X, but Y" / "it's not X — it's Y"; rule-of-three adjective stacks; self-posed rhetorical questions; copula-avoidance ("serves as", "stands as", "represents") where "is" is honest; "-ing" significance tails ("…highlighting her resilience", "…underscoring his growth").
- Moves: "I learned that…" moralizing and lesson-stamped chapter endings ("Ultimately…", "Little did I know…", "It was in that moment that I realized…").`;

/** Assemble a type's doctrine: its own opening, then the shared craft IP. */
function composeDoctrine(
  opening: string,
  truth: string,
  extra: string[] = [],
  craft: string = CRAFT_PRINCIPLES,
): string {
  return [opening, craft, truth, ...extra, NO_META_NARRATION, FORBIDDEN_TELLS].join('\n\n');
}

const BIOGRAPHY_OPENING = `You are a professional biographer writing a true, book-length life story about the subject, drawn ONLY from what is known about them. Your bar is award-winning narrative nonfiction. Follow these principles:`;

const BIOGRAPHY_DOCTRINE = composeDoctrine(BIOGRAPHY_OPENING, TRUTH_TOLD_TRUE);

/** The v1 biography type. */
export const BIOGRAPHY_BOOK_TYPE: BookType = {
  id: 'biography',
  label: 'Biography',
  blurb: 'A true, evolving life story, written by an AI biographer from everything the app knows.',
  doctrine: BIOGRAPHY_DOCTRINE,
  structures: [
    {
      id: 'chronicle',
      label: 'Chronological with thematic braids',
      description:
        'Parts as life eras; each chapter built around one scene and a recurring thread. The genre default.',
      isDefault: true,
    },
    {
      id: 'chapters',
      label: 'Your own life chapters',
      description: 'The chapters you name for your own life become the table of contents.',
    },
    {
      id: 'phases',
      label: 'Identity phases',
      description:
        'A few named "becoming" phases; chronology loose inside each. Best for rich, gappy material.',
    },
    {
      id: 'braided',
      label: 'Braided past and present',
      description:
        'The past narrative alternating with the present-day you, reflecting and changing.',
    },
  ],
  stylePresets: [
    {
      id: 'literary',
      label: 'Literary',
      directive:
        'Literary register: vivid, image-led prose with deliberate rhythm; earn every reflection in scene.',
      specimen: {
        first:
          'The kitchen held the last of the evening light, and I understood, for the first time, that leaving would cost me more than staying ever had.',
        third:
          'The kitchen held the last of the evening light, and she understood, for the first time, that leaving would cost her more than staying ever had.',
      },
    },
    {
      id: 'warm',
      label: 'Warm',
      directive:
        'Warm, intimate register: plain, tender, dinner-table narration; clear over ornate.',
      specimen: {
        first:
          'I never told anyone how frightened I was that year — but my grandmother knew, and she left the porch light on for me every single night.',
        third:
          'He never told anyone how frightened he was that year — but his grandmother knew, and she left the porch light on for him every single night.',
      },
    },
    {
      id: 'plain',
      label: 'Plain',
      directive:
        'Plain register: direct, unadorned, concrete; short sentences; no literary flourish.',
      specimen: {
        first:
          'I took the job because it paid the rent. I stayed eleven years. It was not what I wanted, and I knew it the whole time.',
        third:
          'He took the job because it paid the rent. He stayed eleven years. It was not what he wanted, and he knew it the whole time.',
      },
    },
    {
      id: 'journalistic',
      label: 'Journalistic',
      directive:
        'Journalistic register: reportorial and evidence-led; clear, propulsive, fact-forward narration that lets the record speak; attribute what is not certain.',
      specimen: {
        first:
          'By the spring of that year I had moved three times in eighteen months. The pattern, I would only later admit, was not the cities. It was me.',
        third:
          'By the spring of that year she had moved three times in eighteen months. The pattern, she would only later admit, was not the cities. It was her.',
      },
    },
    {
      id: 'reflective',
      label: 'Reflective',
      directive:
        'Reflective register: essayistic and meditative; interior and thoughtful, braiding scene with the narrator’s considered understanding — reflection always earned in a concrete moment.',
      specimen: {
        first:
          'I have thought often about that closed door, and what it taught me: that some silences are not absence but a kind of question, waiting years for an answer.',
        third:
          'She has thought often about that closed door, and what it taught her: that some silences are not absence but a kind of question, waiting years for an answer.',
      },
    },
    {
      id: 'cinematic',
      label: 'Cinematic',
      directive:
        'Cinematic register: scene-forward and dramatic; vivid, sensory set-pieces with momentum; render in scene far more than you summarize, cutting between moments like film.',
      specimen: {
        first:
          'Rain on the windshield. The engine ticking as it cooled. I sat in the dark lot for an hour before I could make myself walk in and say goodbye.',
        third:
          'Rain on the windshield. The engine ticking as it cooled. He sat in the dark lot for an hour before he could make himself walk in and say goodbye.',
      },
    },
    {
      id: 'poetic',
      label: 'Poetic',
      directive:
        'Poetic register: lyrical and image-dense; heightened, musical rhythm and figurative language — more ornate than the literary register, but never purple or vague.',
      specimen: {
        first:
          'Memory keeps the house I grew up in the way water keeps light — trembling, never quite still, and mine only in the moment I stop to look.',
        third:
          'Memory keeps the house she grew up in the way water keeps light — trembling, never quite still, and hers only in the moment she stops to look.',
      },
    },
  ],
  interview: {
    framing:
      'This is about the story of your life. The story is selective — it does not include everything that ever happened, and there are no right or wrong answers.',
    scenes: MCADAMS_SCENES,
    categories: [
      {
        key: 'chapters',
        label: 'Chapters & transitions',
        examplePrompts: [
          'If your life so far were a book, what would the main chapters be?',
          'How did you get from one of those chapters to the next?',
        ],
      },
      {
        key: 'place',
        label: 'Place & the senses',
        examplePrompts: [
          'Describe the kitchen you grew up in — what did it smell like?',
          'Where were you standing? What would I have seen?',
        ],
      },
      {
        key: 'people',
        label: 'People & relationships',
        examplePrompts: [
          'Who has been the most important person in your life?',
          'What is a moment with them you have never forgotten?',
        ],
      },
      {
        key: 'challenges',
        label: 'Challenges, loss & regret',
        examplePrompts: [
          'What has been your single greatest challenge, and how did you meet it?',
          'What is a loss or a regret that shaped you?',
        ],
      },
      {
        key: 'ideology',
        label: 'Values & how they changed',
        examplePrompts: [
          'What do you believe, in a nutshell — and how did that belief change over time?',
          'What do you think is the most important value in a human life?',
        ],
      },
      {
        key: 'future',
        label: 'What comes next',
        examplePrompts: [
          'What is the next chapter of your life story?',
          'Is there a project or hope that matters most to you now?',
        ],
      },
      {
        key: 'theme',
        label: 'Theme & legacy',
        examplePrompts: [
          'Looking across it all, is there a theme that runs through your story?',
          'How would you like to be remembered?',
        ],
      },
    ],
    deepeningLadder: [
      'Where were you? Set the place.',
      'What did the room, the air, the day feel like — sounds, smells, weather?',
      'What were you wearing or holding? What objects were there?',
      'What did they say — as close to their words as you can get?',
      'What did you feel, in your body?',
      'Why did this stay with you — what does it say about who you are?',
    ],
  },
  gates: { adult: false },
  // A biography is the told-true case in every dimension: it never invents, it is shaped by the eras of a
  // life, and the people in it are themselves.
  summary: {
    drawsOn: 'everything on record',
    shape: 'life eras',
    asksAbout: 'scenes, turning points, the people in them',
  },
  truthMode: 'true',
  spine: { kind: 'eras' },
  castPolicy: 'realNames',
  imageFraming: SYMBOLIC_IMAGE_FRAMING,
};

/** Every registered book type, in display order. v1: the biography. */

// --- The told-true types (72 §3.2) ------------------------------------------------------------------------

/** Everything except the opening + truth block is shared, so a craft fix lands on every type at once. */
function tellsTrue(opening: string): string {
  return composeDoctrine(opening, TRUTH_TOLD_TRUE);
}
function reimagines(opening: string, extra: string[] = []): string {
  return composeDoctrine(opening, TRUTH_REIMAGINED, extra);
}

/**
 * Erotica's craft block. The shared `CRAFT_PRINCIPLES` are written for a TRUE life story and two of them
 * directly contradict this type, which is why an erotic book came out tame however explicit the register
 * said to be: "Sacred carnality … NEVER invent it" forbids the invented bodily detail this type is MADE of,
 * and the biography's reflective apparatus (double perspective, earned hindsight, the insight a chapter
 * exists to reveal) pulls every scene toward literary contemplation.
 *
 * What is kept is everything that is genuinely craft rather than biography: scene over summary, real places,
 * specific detail, rhythm, rounded people. What is dropped is the never-invent rule and the reflective
 * scaffolding. The meta-narration ban and the banned AI tells still apply — those are about prose quality,
 * and they are as true here as anywhere.
 */
const EROTICA_CRAFT = `CRAFT
- Make the reader SEE it. Every scene is rendered — bodies, place, what is done and said — never summarized. A chapter that narrates around the sex instead of writing it is the central defect of this form.
- Write the whole encounter. Build, escalate, and stay in the moment through it; do not cut away, skip forward, or resolve early. Lingering IS the form — dwell on what the scene is about.
- Sacred carnality: specific, sensory, bodily detail is the substance here. INVENT it freely — the events are yours to make up. What you may not invent is the person.
- Desire has a shape: wanting, delay, permission, release. Give each piece its own build rather than starting at the peak.
- Honor sense of place: a named, physically rendered room, hour and light. Place makes it real.
- Round people, not props. Everyone present wants something and has their own way of speaking; a partner who exists only to be acted upon flattens the scene.
- Deliberate rhythm: vary sentence length with the intensity; short lines carry heat, long ones carry build. Write prose that survives being read aloud.`;

/**
 * Erotica's truth contract. Identical to `TRUTH_REIMAGINED` except it drops "never linger gratuitously" —
 * a rule for handling painful memories with distance, and precisely the wrong instruction for a book whose
 * whole purpose is to dwell. The human-decency rules and the boundary are untouched.
 */
const TRUTH_EROTICA = `TRUTH & ETHICS
- The EVENTS here are invented, and that is the point — you may write scenes, dialogue and detail that never happened. Do not pretend otherwise, and never present this book as a record of what occurred.
- The PEOPLE are not invented. Their character, their voice, what they care about and the real relationships between them come from the material and must stay true. A person who would never say a thing must not say it here.
- What they WANT is not invented either. The desire is the thing you are being faithful to; the story exists to carry it.
- Everyone present is a rounded person with their own wanting — write them with fairness, never as a prop.
- This is a wellness reflection, not a clinical assessment. Test or wellbeing data may inform characterization, but NEVER name instruments, scores, bands, or diagnoses, and never write in diagnostic language.`;

/** A book about ONE bounded stretch of a life — the years in a city, an illness, a marriage. */
export const MEMOIR_BOOK_TYPE: BookType = {
  id: 'memoir',
  label: 'Memoir',
  blurb: 'One stretch of your life, told in depth — a period, or a thread you followed through it.',
  doctrine: tellsTrue(
    `You are writing a memoir: one bounded stretch of ${'${subject}'}'s life, told in depth. A memoir is not a short biography — it goes NARROW and DEEP. Everything outside the boundary is context, never a chapter. Its authority comes from closeness: the smaller the window, the more the detail has to carry.`,
  ),
  structures: [
    {
      id: 'sequence',
      label: 'Straight through',
      description: 'Chapters in the order it happened, inside the period.',
      isDefault: true,
    },
    {
      id: 'circling',
      label: 'Circling one moment',
      description: 'The book returns to a single moment from different angles as it goes.',
    },
  ],
  stylePresets: BIOGRAPHY_BOOK_TYPE.stylePresets,
  interview: BIOGRAPHY_BOOK_TYPE.interview,
  gates: { adult: false },
  summary: {
    drawsOn: 'one bounded era',
    shape: '8–12 chapters',
    asksAbout: 'that era, and nothing outside it',
  },
  truthMode: 'true',
  spine: { kind: 'span' },
  castPolicy: 'realNames',
  imageFraming: SYMBOLIC_IMAGE_FRAMING,
  options: [
    {
      id: 'bound',
      label: 'What holds this book together',
      kind: 'choice',
      choices: [
        {
          value: 'period',
          label: 'A period of time',
          description: 'e.g. 1998–2004, the Denver years',
        },
        { value: 'thread', label: 'A thread I followed', description: 'e.g. my mother’s illness' },
      ],
    },
    {
      id: 'boundValue',
      label: 'Which one',
      kind: 'text',
      placeholder: '1998–2004, or “becoming a father”',
      required: true,
    },
  ],
  // A period is a time window; a thread wanders across time, so it can't be one — it reads as a sequence of
  // pieces held together by the thread rather than by chronology.
  spineFor: (o) => (o['bound'] === 'thread' ? { kind: 'vignettes' } : { kind: 'span' }),
};

/** One year, told as a book. */
export const YEAR_IN_REVIEW_BOOK_TYPE: BookType = {
  id: 'yearInReview',
  label: 'Year in review',
  blurb: 'One year of your life, written up while you still remember it.',
  doctrine: tellsTrue(
    `You are writing up ONE YEAR of ${'${subject}'}'s life as a short book. A year is too close to have a moral yet, so do not impose one — no summing-up, no lessons learned, no "what this year taught me". Render what actually happened, in scene, in order, and let the year be what it was.`,
  ),
  structures: [
    {
      id: 'months',
      label: 'Through the year',
      description: 'Chapters follow the year as it went.',
      isDefault: true,
    },
    {
      id: 'threads',
      label: 'By what ran through it',
      description: 'Chapters for the few things that actually defined the year.',
    },
  ],
  stylePresets: BIOGRAPHY_BOOK_TYPE.stylePresets,
  interview: BIOGRAPHY_BOOK_TYPE.interview,
  gates: { adult: false },
  summary: {
    drawsOn: 'one year',
    shape: '5–8 chapters',
    asksAbout: 'what turned, what closed',
  },
  truthMode: 'true',
  spine: { kind: 'span' },
  castPolicy: 'realNames',
  imageFraming: SYMBOLIC_IMAGE_FRAMING,
  options: [{ id: 'year', label: 'Which year', kind: 'text', placeholder: '2026', required: true }],
  spineFor: (o) => ({ kind: 'span', ...(o['year'] ? { from: o['year'], to: o['year'] } : {}) }),
};

/** A book about someone you love. */
export const PORTRAIT_BOOK_TYPE: BookType = {
  id: 'portrait',
  label: 'Portrait',
  blurb: 'A book about one person you love — written to them, or about them.',
  doctrine: tellsTrue(
    `You are writing a portrait of ONE person, drawn from what the subject knows of them. A portrait is not a biography of that person — it is what one life looks like from inside another's view of it, and it should say so honestly rather than pretending to a completeness it doesn't have. Write them whole: the irritating habit beside the kindness. A portrait with no flaws reads as a eulogy, and nobody believes a eulogy.`,
  ),
  structures: [
    {
      id: 'facets',
      label: 'What they are like',
      description: 'Each piece a different side of them.',
      isDefault: true,
    },
    {
      id: 'together',
      label: 'Our history',
      description: 'The pieces follow the shape of knowing them.',
    },
  ],
  stylePresets: BIOGRAPHY_BOOK_TYPE.stylePresets,
  interview: BIOGRAPHY_BOOK_TYPE.interview,
  gates: { adult: false },
  summary: {
    drawsOn: 'one person you love',
    shape: 'themed chapters',
    asksAbout: 'them, not you',
  },
  truthMode: 'true',
  spine: { kind: 'vignettes' },
  castPolicy: 'realNames',
  imageFraming: SYMBOLIC_IMAGE_FRAMING,
  options: [
    { id: 'subject', label: 'Who it’s about', kind: 'person', required: true },
    {
      id: 'addressee',
      label: 'How it’s written',
      kind: 'choice',
      help: 'A book written TO someone is a gift you could hand them. One written ABOUT them is easier to be honest in.',
      choices: [
        {
          value: 'toThem',
          label: 'To them',
          description: '“You always came in through the back door.”',
        },
        {
          value: 'aboutThem',
          label: 'About them',
          description: '“She always came in through the back door.”',
        },
      ],
    },
  ],
};

// --- The reimagined types (72 §3.2) -----------------------------------------------------------------------

/** Dreams retold as stories. */
export const DREAM_BOOK_TYPE: BookType = {
  id: 'dreamBook',
  label: 'Dream book',
  blurb: 'Your dreams, retold as stories — one at a time, or gathered by what keeps recurring.',
  doctrine: reimagines(
    `You are turning ${'${subject}'}'s recorded dreams into readable stories. A dream is not a story yet: it has images and a feeling but no shape, and your job is to give it one WITHOUT explaining it. Never interpret. Never tell the reader what a dream means, and never end on the waking-up-and-realising move. Stay inside the dream's own logic, where impossible things are simply true and nobody remarks on them.`,
    [
      `DREAMS SPECIFICALLY
- Keep the dream's images exactly as they were recorded — the wrong house, the person who is two people. Those are the material; smoothing them into sense destroys the thing.
- Write the FEELING faithfully. A dream that was frightening must read as frightening, whatever happens in it.
- Do not connect dreams that were not connected. Where two dreams share a figure or a place, you may put them near each other; you may not invent a plot that runs between them.`,
    ],
  ),
  structures: [
    {
      id: 'each',
      label: 'One dream at a time',
      description: 'Each dream its own piece.',
      isDefault: true,
    },
    {
      id: 'motifs',
      label: 'Gathered by what recurs',
      description: 'Parts named for the things that keep coming back.',
    },
  ],
  stylePresets: BIOGRAPHY_BOOK_TYPE.stylePresets,
  interview: BIOGRAPHY_BOOK_TYPE.interview,
  gates: { adult: false },
  summary: {
    drawsOn: 'your dream journal',
    shape: 'vignettes',
    asksAbout: 'recurring images and their weather',
  },
  truthMode: 'fictionalized',
  spine: { kind: 'vignettes' },
  castPolicy: 'renamed',
  imageFraming: SYMBOLIC_IMAGE_FRAMING,
  sourceSelect: 'dream',
  options: [
    {
      id: 'shape',
      label: 'How it’s put together',
      kind: 'choice',
      choices: [
        {
          value: 'each',
          label: 'One dream, one piece',
          description: 'No through-line forced on material that has none.',
        },
        {
          value: 'motifs',
          label: 'Grouped by what recurs',
          description: 'Parts named for the house, the water, being late.',
        },
        {
          value: 'woven',
          label: 'Woven into one story',
          description: 'One continuous narrative built from the recurring figures.',
        },
      ],
    },
  ],
  spineFor: (o) => (o['shape'] === 'each' ? { kind: 'vignettes' } : { kind: 'eras' }),
};

/** 18+ — fiction drawn from the person's own intimate life. */
export const EROTICA_BOOK_TYPE: BookType = {
  id: 'erotica',
  label: 'Erotica',
  blurb: 'Explicit fiction, written from what you’ve told the app about your own desire. 18+.',
  doctrine: composeDoctrine(
    `You are writing explicit erotic fiction for ${'${subject}'}, drawn from what they have told the app about their own desire. The events are invented; what they want is not. Write it as fiction — scenes, tension, a reason to keep reading — never as a report of anything that happened. Write the sex on the page: this is not a book that fades out at the door.`,
    TRUTH_EROTICA,
    [
      `THE BOUNDARY (absolute, and it overrides every other instruction here)
- Everyone in this book is a consenting adult. Never a minor, never anyone presented as a minor, never real non-consent, never anything illegal.
- Taboo material appears only as fantasy or roleplay between consenting adults who both know that is what it is.
- A hard limit recorded anywhere in the material is a hard limit here. Never write it, however well it would fit.
- Children do not exist in this book. Never name, describe, or refer to any child of the subject — not in a scene, not in passing, not as background. If the material mentions them, they are simply absent here. The corpus already withholds them; this holds even if a name reaches you by any other route.`,
    ],
    EROTICA_CRAFT,
  ),
  structures: [
    {
      id: 'scenes',
      label: 'Scenes',
      description: 'Each piece one encounter, complete on its own.',
      isDefault: true,
    },
    { id: 'arc', label: 'One story', description: 'A single narrative with a build across it.' },
  ],
  // Erotica's OWN registers. It used to borrow the biography list, which offered "Journalistic:
  // reportorial and evidence-led" and "Warm: dinner-table narration" for an erotic book. Each of these is a
  // VOICE — the `tier` option below is what says how explicit the book is, and its directive explicitly
  // governs whatever style is chosen, so the two never compete. Deliberately absent: a "kinky" or "taboo"
  // style. Those name CONTENT, not voice; a one-tap tile would push material regardless of what the
  // person's own recorded desire says, which inverts this type's whole premise. Subject matter comes from
  // their own material plus the optional `focus` below.
  stylePresets: [
    {
      id: 'sensory',
      label: 'Sensory',
      directive:
        'Sensory register: stay close on the body and the senses — touch, heat, breath, texture. Sensation carries the scene; keep interiority short and physical.',
      specimen: {
        first:
          'I felt the heat of him before the touch landed — the whole room narrowed to the inch of skin waiting for it.',
        third:
          'She felt the heat of him before the touch landed — the whole room narrowed to the inch of skin waiting for it.',
      },
    },
    {
      id: 'slowBurn',
      label: 'Slow burn',
      directive:
        'Slow-burn register: tension and delay are the point. Draw out anticipation, let almost-happening do the work, and make the reader wait — but never coy, and never a fade to black.',
      specimen: {
        first:
          'He did not touch me. He just stood close enough that I could feel him deciding, and let me stand there in it.',
        third:
          'He did not touch her. He just stood close enough that she could feel him deciding, and let her stand there in it.',
      },
    },
    {
      id: 'raunchy',
      label: 'Raunchy',
      directive:
        'Raunchy register: coarse, bawdy and unapologetic. Blunt words for bodies and acts, short punchy lines, no euphemism and no politeness. This is DICTION — how explicit the content itself is remains the register directive below.',
      specimen: {
        first:
          'I was dripping before he got my knickers off, and he told me so, and I told him to shut up and get on with it.',
        third:
          'She was dripping before he got her knickers off, and he told her so, and she told him to shut up and get on with it.',
      },
    },
    {
      id: 'tender',
      label: 'Tender',
      directive:
        'Tender register: affection and intimacy carry the scene. Closeness, care and being known matter as much as the act — warm without turning chaste or sentimental.',
      specimen: {
        first:
          'He said my name like it still surprised him, and stayed there a while after, his hand flat over my heart.',
        third:
          'He said her name like it still surprised him, and stayed there a while after, his hand flat over her heart.',
      },
    },
    {
      id: 'confessional',
      label: 'Confessional',
      directive:
        'Confessional register: told directly to the reader, close and unguarded, as if admitting it. Speak plainly about wanting — the frankness is the intimacy.',
      specimen: {
        first:
          'I should tell you what I actually wanted that night, because I have never said it out loud.',
        third:
          'She would tell you what she actually wanted that night — she had never said it out loud.',
      },
    },
    {
      id: 'filthyTalk',
      label: 'Filthy talk',
      directive:
        'Dialogue-forward register: what they SAY to each other carries the scene. Real, dirty, specific talk — instructions, demands, filth said out loud, answers given. Narration serves the dialogue rather than the other way round.',
      specimen: {
        first: '“Tell me what you want.” So I told him — his cock, my mouth, and no talking after.',
        third:
          '“Tell me what you want.” So she told him — his cock, her mouth, and no talking after.',
      },
    },
    {
      id: 'playful',
      label: 'Playful',
      directive:
        'Playful register: teasing, funny, delighted. Sex that is FUN — banter, daring each other, laughing mid-act. Keep it light without turning coy; playful is not a synonym for tame.',
      specimen: {
        first: 'I told him he had about ten seconds. He used nine of them just grinning at me.',
        third: 'She told him he had about ten seconds. He used nine of them just grinning at her.',
      },
    },
    {
      id: 'aching',
      label: 'Aching',
      directive:
        'Aching register: longing that is not satisfied. Want as a physical fact — proximity without permission, the thing not asked for, the wanting itself as the subject. Never resolve it early to be kind.',
      specimen: {
        first:
          'He was close enough to touch for an hour, and I did not, and that was the whole night.',
        third:
          'He was close enough to touch for an hour, and she did not, and that was the whole night.',
      },
    },
    {
      id: 'hardcore',
      label: 'Hardcore',
      directive:
        'Hardcore register: all act, no interiority. Continuous, anatomical, blow-by-blow — name every part and every act plainly and keep the camera on it. No cutting away, no reflection, no lingering on feelings; escalation is the structure. This is about FOCUS, not permission — how graphic the book may be is the register directive below.',
      specimen: {
        first:
          'He bent me over the edge of the bed and pushed his cock into me in one stroke, and did not stop to ask.',
        third:
          'He bent her over the edge of the bed and pushed his cock into her in one stroke, and did not stop to ask.',
      },
    },
    {
      id: 'cinematic',
      label: 'Cinematic',
      directive:
        'Cinematic register: scene-forward and visual. Build set-pieces — the room, the light, who moves where — and let the camera stay in the moment rather than cutting away.',
      specimen: {
        first:
          'The door closed. The lamp threw everything into halves of light, and I crossed the room before I could think better of it.',
        third:
          'The door closed. The lamp threw everything into halves of light, and she crossed the room before she could think better of it.',
      },
    },
    {
      id: 'literary',
      label: 'Literary',
      directive:
        'Literary register: image-led prose with deliberate rhythm. Erotica written as literary fiction — precise, unhurried, never ornamental for its own sake.',
      specimen: {
        first:
          'Wanting had made a stranger of me, and I went to him the way you go toward weather you have already decided not to outrun.',
        third:
          'Wanting had made a stranger of her, and she went to him the way you go toward weather you have already decided not to outrun.',
      },
    },
  ],
  // Its own interview, too. This also borrowed the biography's, so a book about desire asked the McAdams
  // life-story questions — a high point, a low point that stayed with you.
  interview: {
    framing:
      'You are gathering what this person actually wants, so fiction can be built from it. Ask plainly and without euphemism; nothing here is a report of anything that happened, and a hard limit is never something to talk them out of.',
    scenes: [
      {
        key: 'charge',
        label: 'What holds the charge',
        prompt:
          'What is the thing you keep coming back to? The specific version, not the category.',
      },
      {
        key: 'firstWant',
        label: 'When you knew',
        prompt: 'When did you first realise you wanted that? What was happening?',
      },
      {
        key: 'unsaid',
        label: 'What goes unsaid',
        prompt: 'Something you have wanted and never asked for out loud. What stopped you?',
      },
      {
        key: 'dynamic',
        label: 'How you like it to go',
        prompt:
          'Who leads, who follows, and how does that shift? Describe it the way it plays out.',
      },
      {
        key: 'setting',
        label: 'Where it happens',
        prompt:
          'A place that carries it — the room, the time of day, what it feels like to be there.',
      },
      {
        key: 'limits',
        label: 'Where the edges are',
        prompt:
          'What is off the table entirely? A hard no is a hard no, and it stays out of the book.',
      },
    ],
    categories: [
      {
        key: 'desire',
        label: 'What you want',
        examplePrompts: [
          'What would you ask for if there were no wrong answer?',
          'Is it the act itself, or something about how it happens?',
        ],
      },
      {
        key: 'fantasy',
        label: 'Fantasy & scenario',
        examplePrompts: [
          'A scenario you return to — set the scene for me.',
          'Is it something you would want in life, or something that works because it is imagined?',
        ],
      },
      {
        key: 'body',
        label: 'Body & sensation',
        examplePrompts: [
          'What does it actually feel like when it is good?',
          'What do you notice first?',
        ],
      },
      {
        key: 'boundaries',
        label: 'Limits',
        examplePrompts: [
          'What is a hard no?',
          'Is there something that is a maybe — good in fantasy, not in life?',
        ],
      },
    ],
    deepeningLadder: [
      'Set the scene — where is this happening?',
      'What is the build? What happens before anything happens?',
      'What does it feel like in the body — where, and how?',
      'What is said out loud, and what is not?',
      'What makes this one different from any other version of it?',
    ],
  },
  gates: { adult: true },
  summary: {
    drawsOn: 'what you’ve told it about desire',
    shape: 'vignettes',
    asksAbout: 'fantasy, boundaries, what you want',
  },
  truthMode: 'fictionalized',
  spine: { kind: 'vignettes' },
  castPolicy: 'renamed',
  imageFraming: SYMBOLIC_IMAGE_FRAMING,
  options: [
    {
      id: 'tier',
      label: 'How explicit',
      kind: 'choice',
      help: 'The same registers your intimacy questionnaires use.',
      // One ladder, four rungs, ordered most-explicit first (the first entry is the default). Each carries
      // the SAME moment written at that register, because side by side is the only way the difference is
      // legible — "a step back from unfiltered" says where a rung sits, never what it reads like.
      choices: [
        {
          value: 'unfiltered',
          label: 'Unfiltered',
          description: 'Graphic from the first line. Nothing withheld, softened or cut away.',
          example:
            'He had her against the door with his cock inside her before they made it to the bed, and neither of them cared who heard.',
        },
        {
          value: 'explicit',
          label: 'Explicit',
          description:
            'Acts and bodies named plainly — real sexual detail, a step back from unfiltered.',
          example:
            'He had her out of the dress before the bed, his mouth on her tits and his hand between her legs.',
        },
        {
          value: 'sensual',
          label: 'Sensual',
          description: 'The whole night is on the page, written in sensation rather than anatomy.',
          example:
            'His hands found the small of her back, and everything after was heat and breath and the shape of him.',
        },
        {
          value: 'suggestive',
          label: 'Suggestive',
          description: 'Charged and wanting, but the door closes. Tension without the act.',
          example:
            'He kicked the door shut behind them, and the rest of the night belonged to nobody else.',
        },
      ],
    },
    // What THIS book is about (owner decision, 2026-08-15). By default the subject matter comes from the
    // person's own recorded desire — their rated inventory, their yes/no/maybe answers, the open ground in
    // their topic map — which is what makes this type honest. This narrows or adds to that for one book.
    //
    // Free text, deliberately, not a checklist of kinks: 71 §5.3 deleted exactly that fixed taxonomy
    // because filing a person's own desire under fourteen built-in families is the thing that stops it
    // being theirs. Their words are the vocabulary.
    {
      id: 'focus',
      label: 'What this one explores',
      kind: 'text',
      help: 'Optional. Leave it blank and this book draws on everything you’ve told SelfOS you want.',
      placeholder: 'e.g. being watched; a long build in a hotel room; giving up control',
    },
  ],
  spineFor: (o) => (o['arc'] === 'arc' ? { kind: 'eras' } : { kind: 'vignettes' }),
};

/**
 * A picture book starring the author's own children (§3.2, P6). The one type with a `pages` spine, the one
 * with `childrenAsHeroes`, and the one that relaxes the image-likeness rule (§8.5).
 *
 * Its interview is the reason `BookInterviewFramework.scenes` had to stop being the McAdams tuple: asking a
 * parent for "a low point — a hard time that stayed with you" to write a bedtime story is the wrong
 * question. These scenes ask about the child.
 */
export const CHILDRENS_BOOK_TYPE: BookType = {
  id: 'childrens',
  label: 'Children’s book',
  blurb: 'A picture book starring your own children, made from the small things they actually do.',
  doctrine: reimagines(
    `You are writing a picture book for young children, starring real children from ${'${subject}'}'s own family. The events are invented; the children are not — their names, their natures, the things they love and fear and say come from the material and must stay true. A parent reading this aloud should recognise their own child on every page.`,
    [
      `PICTURE-BOOK CRAFT (where this contradicts a general craft rule above, THIS wins — a picture book is not narrative nonfiction)
- One image-able moment per page. Every page must give the illustrator something concrete to draw: an action, a place, a face. Never a page of interior reflection.
- Write to be read ALOUD by a tired adult at bedtime. Short sentences. Concrete nouns. Rhythm you can hear. Read every line aloud in your head before you keep it.
- Vocabulary a child of the stated age can hold. No abstraction a child cannot picture.
- Repetition is a feature, not a tell: a refrain a child can join in with is good writing here.
- NO double perspective, NO earned hindsight, NO reflective narrator looking back. There is one voice and it is in the present of the story.
- Never end on a lesson, a moral, or "and she learned that…". End on an image or a feeling. The child draws their own conclusion.
- The child is the one who acts. Never let an adult solve the problem for them.`,
    ],
  ),
  structures: [
    {
      id: 'adventure',
      label: 'A small adventure',
      description: 'Something ordinary goes sideways, and they put it right themselves.',
      isDefault: true,
    },
    {
      id: 'day',
      label: 'One day, start to finish',
      description: 'Morning to bedtime, in order — the shape of their actual day.',
    },
    {
      id: 'refrain',
      label: 'A repeating refrain',
      description: 'The same line comes back each page, with one thing changed.',
    },
  ],
  /**
   * Its OWN registers, and deliberately only three. The biography presets demo literary-memoir prose under
   * the label "how your biographer will sound" — for a picture book that is simply a lie about the product,
   * and "journalistic" or "cinematic" are not things a book for a four-year-old can be. `warm` is included
   * because it is `BookConfig.style`'s default, so the default always resolves to a real directive.
   */
  stylePresets: [
    {
      id: 'warm',
      label: 'Cosy',
      directive:
        'Cosy register: gentle, affectionate, bedtime-soft. The voice of someone who loves this child.',
      specimen: {
        first: 'I put on my red boots. The puddle was deeper than yesterday. I jumped anyway.',
        third: 'She put on her red boots. The puddle was deeper than yesterday. She jumped anyway.',
      },
    },
    {
      id: 'plain',
      label: 'Simple',
      directive:
        'Simple register: the shortest true sentence, every time. Concrete nouns, ordinary words, nothing decorative.',
      specimen: {
        first: 'The fox was under the hedge. I was very quiet. The fox looked right at me.',
        third: 'The fox was under the hedge. She was very quiet. The fox looked right at her.',
      },
    },
    {
      id: 'poetic',
      label: 'Sing-song',
      directive:
        'Sing-song register: rhythm you can hear, and a refrain a child can join in with. Never force a rhyme that bends a true word out of shape.',
      specimen: {
        first:
          'Boots on, hood up, out I go — and the puddle at the gate is waiting, just the same as long ago.',
        third:
          'Boots on, hood up, out she goes — and the puddle at the gate is waiting, just the same as long ago.',
      },
    },
  ],
  interview: {
    framing:
      'You are gathering the small, true, specific things about this child so a story can be built around them. You are not asking the parent about themselves.',
    scenes: [
      {
        key: 'delight',
        label: 'What delights them',
        prompt: 'What makes them light up? The specific thing, not the category.',
      },
      {
        key: 'fear',
        label: 'What they are working up to',
        prompt: 'Is there something they find hard or frightening right now?',
      },
      {
        key: 'saying',
        label: 'Something they say',
        prompt: 'A phrase or a word they say the way only they say it.',
      },
      {
        key: 'habit',
        label: 'A thing they always do',
        prompt: 'Something they do every time — a ritual, a habit, a way of doing a small thing.',
      },
      {
        key: 'place',
        label: 'Their place',
        prompt: 'Where are they most themselves? Describe it the way they would see it.',
      },
      {
        key: 'companion',
        label: 'Who or what is with them',
        prompt: 'A toy, an animal, a sibling, a friend they are inseparable from.',
      },
    ],
    categories: [
      {
        key: 'character',
        label: 'Who they are',
        examplePrompts: [
          'What are they like when nobody is asking anything of them?',
          'What do they do when something goes wrong?',
        ],
      },
      {
        key: 'world',
        label: 'Their world',
        examplePrompts: ['What does their day actually look like?', 'Who is in it besides you?'],
      },
    ],
    deepeningLadder: [
      'Where does this happen — what does the room or the place look like?',
      'What do they do with their hands or their body when this happens?',
      'Is there an object involved? Describe it.',
      'What do they say, in their words?',
      'What is the feeling underneath it?',
    ],
  },
  gates: { adult: false },
  summary: {
    drawsOn: 'what you’ve told it about your children',
    shape: 'illustrated pages',
    asksAbout: 'your child — what they love, say and do',
  },
  truthMode: 'fictionalized',
  // 32 pages is the picture-book standard (a printer's signature); ~40 words a page is a read-aloud page.
  spine: { kind: 'pages', count: 32, wordsPerPage: 40 },
  castPolicy: 'childrenAsHeroes',
  imageFraming: CHILDRENS_IMAGE_FRAMING,
  audience: { ageFrom: 3, ageTo: 7, readingLevel: 'read aloud by an adult' },
  options: [
    {
      id: 'hero',
      label: 'Who it stars',
      kind: 'person',
      multiple: true,
      help: 'One child, or several — a book can star two siblings.',
      required: true,
    },
    {
      id: 'length',
      label: 'How long',
      kind: 'choice',
      choices: [
        { value: '32', label: '32 pages', description: 'The picture-book standard.' },
        { value: '24', label: '24 pages', description: 'Shorter — for a younger listener.' },
        { value: '16', label: '16 pages', description: 'A very short board-book length.' },
      ],
    },
  ],
  spineFor: (o) => ({
    kind: 'pages',
    count: Number(o['length']) || 32,
    wordsPerPage: 40,
  }),
};

/**
 * The one book that belongs to two people (72 §5.8). Stored at the pair root, written from both lives,
 * readable and writable by both, and re-gated on the live partner edge at every read.
 *
 * `truthMode: 'true'` and `castPolicy: 'realNames'` for the obvious reason — a couple's own history is the
 * last thing that should be fictionalized or pseudonymous. Its interview asks about the two of them rather
 * than about one life, because the McAdams scenes ("a high point", "a turning point") are questions about an
 * individual and this book's subject is a relationship.
 */
export const OUR_STORY_BOOK_TYPE: BookType = {
  id: 'ourStory',
  label: 'Our story',
  blurb:
    'The story of you and your partner, written from both your lives — and both of you can write it.',
  doctrine: tellsTrue(
    `You are writing the true story of a COUPLE, drawn from what both of them have recorded. Its subject is the relationship, not either person: the unit of this book is what happened BETWEEN them. Give both of them their own interiority and their own version of events — where they remember a thing differently, that difference IS the material, and you write both without adjudicating. Never take a side, and never flatten two people into one agreeing voice.`,
  ),
  structures: [
    {
      id: 'chronicle',
      label: 'From the beginning',
      description: 'How you met, and everything after, in order.',
      isDefault: true,
    },
    {
      id: 'chapters',
      label: 'The chapters of us',
      description: 'The distinct eras of the relationship — each one its own part.',
    },
    {
      id: 'turns',
      label: 'The moments that turned it',
      description: 'Built around the handful of moments that changed things.',
    },
  ],
  stylePresets: BIOGRAPHY_BOOK_TYPE.stylePresets,
  interview: {
    framing:
      'You are gathering the story of a relationship from the two people in it. Ask about what happened between them, not about either life on its own. Either partner may answer any question.',
    scenes: [
      {
        key: 'meeting',
        label: 'How it began',
        prompt: 'The first time you met — what actually happened, as you remember it?',
      },
      {
        key: 'knew',
        label: 'When you knew',
        prompt: 'When did you know this was going to be something? What made you know it?',
      },
      {
        key: 'hardest',
        label: 'The hardest stretch',
        prompt: 'A hard stretch you came through together. What was it, and what got you through?',
      },
      {
        key: 'ordinary',
        label: 'An ordinary day',
        prompt:
          'An ordinary day together that you would keep. What made it that day and not another?',
      },
      {
        key: 'changed',
        label: 'What changed you',
        prompt: 'Something about you that is different because of them.',
      },
      {
        key: 'ritual',
        label: 'A thing you do',
        prompt: 'Something the two of you always do — a habit, a joke, a way of ending the day.',
      },
    ],
    categories: [
      {
        key: 'together',
        label: 'The two of you',
        examplePrompts: [
          'What do you disagree about, and how does it usually go?',
          'What does the other one do that nobody else would notice?',
        ],
      },
      {
        key: 'life',
        label: 'The life you built',
        examplePrompts: [
          'Where have you lived, and which one felt like yours?',
          'What have you made together that you are glad about?',
        ],
      },
    ],
    deepeningLadder: [
      'Where were you both — what did the place look like?',
      'What were you each doing with your hands, your body?',
      'Was there an object in it? Describe it.',
      'What did they say — as close to their words as you can get?',
      'What did you feel then, and what do you think they felt?',
    ],
  },
  gates: { adult: false },
  summary: {
    drawsOn: 'both of your lives',
    shape: 'how you met, and after',
    asksAbout: 'the two of you, not one of you',
  },
  truthMode: 'true',
  spine: { kind: 'eras' },
  castPolicy: 'realNames',
  imageFraming: SYMBOLIC_IMAGE_FRAMING,
  /** Marks the type whose books live at a pair root — the commission resolves the pairKey from this answer. */
  sharedWithPartner: true,
  options: [
    {
      id: 'partner',
      label: 'Who it’s with',
      kind: 'person',
      help: 'Both of you can write this book, and both of you can read it.',
      required: true,
    },
  ],
};

export const BOOK_TYPES: readonly BookType[] = [
  BIOGRAPHY_BOOK_TYPE,
  MEMOIR_BOOK_TYPE,
  YEAR_IN_REVIEW_BOOK_TYPE,
  PORTRAIT_BOOK_TYPE,
  OUR_STORY_BOOK_TYPE,
  CHILDRENS_BOOK_TYPE,
  DREAM_BOOK_TYPE,
  EROTICA_BOOK_TYPE,
];

/** Resolve a book type by id; undefined if unknown (a book whose type is not registered can't generate —
 *  handled gracefully by callers, never a crash). */
export function getBookType(id: BookTypeId): BookType | undefined {
  return BOOK_TYPES.find((type) => type.id === id);
}

/** The registered book types (for a future create-a-book type picker). */
export function listBookTypes(): readonly BookType[] {
  return BOOK_TYPES;
}

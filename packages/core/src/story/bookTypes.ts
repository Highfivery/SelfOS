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
}

/** An interview question category (research appendix Part III C4) with a few example prompts. */
export interface BookInterviewCategory {
  key: string;
  label: string;
  examplePrompts: string[];
}

/** The interview framework a book type uses to know what to ask (§5.5). */
export interface BookInterviewFramework {
  /** The stance the interviewer opens with (the McAdams framing, adapted). */
  framing: string;
  /** The eight key scenes. */
  scenes: typeof MCADAMS_SCENES;
  /** Question categories beyond the scenes. */
  categories: BookInterviewCategory[];
  /** The deepening ladder (flat answer → scene-level material): place → body → object → dialogue →
   *  feeling → meaning. Each step is a follow-up move the engine applies to a thin answer. */
  deepeningLadder: string[];
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
}

const BIOGRAPHY_DOCTRINE = `You are a professional biographer writing a true, book-length life story about the subject, drawn ONLY from what is known about them. Your bar is award-winning narrative nonfiction. Follow these principles:

CRAFT
- Turn every page: write from the whole record, never a skim. The revealing detail is often the one nobody weighted.
- Make the reader SEE the scene. Every chapter needs at least one moment rendered in scene — place, time, body — not summarized. A chapter of pure recap is a defect.
- Honor sense of place: anchor scenes in named, physically rendered places; place explains behavior.
- Keep it chronological within a chapter and withhold hindsight: let the reader learn as life was lived.
- Situation vs. story: an event is a situation; a chapter earns its place only when it knows the emotional truth — the insight — it exists to reveal, and reveals it in scene rather than announcing it.
- Run the double perspective: the experiencing self living the moment, and the reflective narrator who understands it now. An all-scene passage gets one line of earned hindsight; an all-reflection passage gets the concrete moment restored beneath it.
- Give the story an inner thread — the subject's recurring internal struggle — and let it carry the book.
- Sacred carnality: use specific, sensory, bodily detail. Where you lack it, that is a gap to interview for — NEVER invent it.
- Portrait, not autopsy: warm, idiosyncratic detail over clinical dissection. Show contradictions side by side without adjudicating them. A subject with no flaws is unbelievable; a flattering portrait loses the reader's trust.
- Deliberate rhythm: vary sentence length with the emotional register; write prose that survives being read aloud.

TRUTH & ETHICS
- Never exaggerate, never fabricate. Do not invent scenes, dialogue, dates, or sensory detail. Reconstructed dialogue must read as reconstruction.
- Honest epistemics: when the record is silent or self-contradictory, say so on the page ("the record doesn't say", "she remembers it two ways") rather than papering over it.
- Third parties are rounded characters with their own reasons — write them with fairness and motive-empathy, never as flat villains. Never narrate another person's inner thoughts as fact; attribute ("she seemed", "he later said") or leave it as a question.
- Do not force a redemptive silver lining onto a painful memory. Handle hard material with reflective distance and room to breathe; never linger gratuitously.
- This is a wellness reflection, not a clinical assessment. Test or wellbeing data may inform characterization ("she runs anxious before big decisions"), but NEVER name instruments, scores, bands, or diagnoses, and never write in diagnostic language.

FORBIDDEN AI-PROSE TELLS (do not use)
- Vocabulary: tapestry, testament / "a testament to", delve, journey (as a life-metaphor crutch), pivotal, intricate, meticulous, showcase, underscore, vibrant, robust, landscape/realm, navigate (metaphorical), foster, boast, "rich cultural heritage", "nestled", "in the heart of", "indelible mark", or "turning point" used as a label instead of a dramatized scene.
- Constructions: "not just X, but Y" / "it's not X — it's Y"; rule-of-three adjective stacks; self-posed rhetorical questions; copula-avoidance ("serves as", "stands as", "represents") where "is" is honest; "-ing" significance tails ("…highlighting her resilience", "…underscoring his growth").
- Moves: "I learned that…" moralizing and lesson-stamped chapter endings ("Ultimately…", "Little did I know…", "It was in that moment that I realized…").`;

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
    },
    {
      id: 'warm',
      label: 'Warm',
      directive:
        'Warm, intimate register: plain, tender, dinner-table narration; clear over ornate.',
    },
    {
      id: 'plain',
      label: 'Plain',
      directive:
        'Plain register: direct, unadorned, concrete; short sentences; no literary flourish.',
    },
    {
      id: 'journalistic',
      label: 'Journalistic',
      directive:
        'Journalistic register: reportorial and evidence-led; clear, propulsive, fact-forward narration that lets the record speak; attribute what is not certain.',
    },
    {
      id: 'reflective',
      label: 'Reflective',
      directive:
        'Reflective register: essayistic and meditative; interior and thoughtful, braiding scene with the narrator’s considered understanding — reflection always earned in a concrete moment.',
    },
    {
      id: 'cinematic',
      label: 'Cinematic',
      directive:
        'Cinematic register: scene-forward and dramatic; vivid, sensory set-pieces with momentum; render in scene far more than you summarize, cutting between moments like film.',
    },
    {
      id: 'poetic',
      label: 'Poetic',
      directive:
        'Poetic register: lyrical and image-dense; heightened, musical rhythm and figurative language — more ornate than the literary register, but never purple or vague.',
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
};

/** Every registered book type, in display order. v1: the biography. */
export const BOOK_TYPES: readonly BookType[] = [BIOGRAPHY_BOOK_TYPE];

/** Resolve a book type by id; undefined if unknown (a book whose type is not registered can't generate —
 *  handled gracefully by callers, never a crash). */
export function getBookType(id: BookTypeId): BookType | undefined {
  return BOOK_TYPES.find((type) => type.id === id);
}

/** The registered book types (for a future create-a-book type picker). */
export function listBookTypes(): readonly BookType[] {
  return BOOK_TYPES;
}

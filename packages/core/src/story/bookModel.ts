/**
 * Which model writes a book (72 §5.3).
 *
 * Every book pass — planning a chapter, drafting it, critiquing it, revising it, and the whole-manuscript
 * read — runs on the most capable model available, regardless of the app-wide `ai.model` setting. A book is
 * the one artifact in SelfOS where the model's literary judgment IS the product: a cheaper model produces
 * prose that reads like a summary of a life rather than a life, and no amount of prompt work recovers that.
 * Everything else in the app (chat, questionnaires, analysis) continues to follow the person's own setting.
 *
 * This is applied as a per-task override on `AiDeps.models`, so it needs no change at any call site: the
 * bridge attaches the map once and `runClaude` resolves it by usage type. The recorded `UsageEvent` carries
 * the model that actually ran, so the estimated cost stays accurate.
 */

/** The model every book pass runs on — the most capable one the app offers. */
export const BOOK_MODEL = 'claude-opus-4-8';

/**
 * Every usage type that writes, judges, or shapes book prose. Deliberately NOT the image types
 * (`story.image` is OpenAI, `story.imagePrompt`/`story.vision` are short distillations where the cheaper
 * model is indistinguishable) — those keep the person's setting.
 */
export const BOOK_TASK_TYPES = [
  'story.outline',
  'story.chapter',
  'story.structure',
  'story.title',
  'story.essence',
  'story.interview',
  'story.answer',
  'story.memory',
  'story.continuity',
  'story.lineEdit',
  'book.plan',
  'book.critique',
  'book.revise',
  'book.manuscript',
] as const;

/** The `AiDeps.models` map the bridge attaches: every book task → `BOOK_MODEL`. */
export const BOOK_TASK_MODELS: Record<string, string> = Object.fromEntries(
  BOOK_TASK_TYPES.map((type) => [type, BOOK_MODEL]),
);

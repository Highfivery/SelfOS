import {
  matrixRowLabel,
  type Question,
  type QuestionLabels,
  type QuestionRewrite,
} from '../schemas';

export type { QuestionLabels, QuestionRewrite };

/**
 * The VISIBLE text of a question, isolated from its structure (08 §32.3).
 *
 * A wrong-fact correction rewrites what the recipient READS — the prompt, the help line, the option labels,
 * the scale anchors, the matrix row labels — and never what the question IS. Structure (answer type, option
 * count + order, matrix row keys, branch rules, scale bounds, metric keys) is frozen, so:
 *
 * - the stored answer is still the sender's own option STRING (their Results stay countable);
 * - `BranchRuleSchema` triggers, which match on option strings, keep working;
 * - `isAnswered` / `unansweredRequired` / matrix row keys are unaffected.
 *
 * That's why this module is pure and crypto-free: the renderer imports it to apply a rewrite for DISPLAY
 * only (`labelOverrides` on `QuestionnaireForm`), while the underlying `Question` is never mutated.
 */
/** Read the question's current visible labels — the exact surface a rewrite is allowed to touch. */
export function questionLabels(q: Question): QuestionLabels {
  const scale = q.scale
    ? {
        ...(q.scale.minLabel != null ? { min: q.scale.minLabel } : {}),
        ...(q.scale.midLabel != null ? { mid: q.scale.midLabel } : {}),
        ...(q.scale.maxLabel != null ? { max: q.scale.maxLabel } : {}),
      }
    : undefined;
  return {
    prompt: q.prompt,
    ...(q.help != null ? { help: q.help } : {}),
    ...(q.options ? { options: [...q.options] } : {}),
    ...(scale && Object.keys(scale).length ? { scaleLabels: scale } : {}),
    ...(q.matrix ? { matrixRows: q.matrix.rows.map(matrixRowLabel) } : {}),
    ...(q.matrix?.pointLabels ? { matrixPointLabels: [...q.matrix.pointLabels] } : {}),
  };
}

/** A non-empty trimmed string, or undefined — the model returning `""` must never blank a real label. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** The reserved free-text option — renaming it would silently kill the write-in, so it's never rewritten. */
const OTHER = 'Other';

/**
 * A same-length list of DISTINCT non-empty labels, or undefined.
 *
 * Two structural guards, both of which reject the whole array and keep the originals:
 *
 * 1. **Length** — a model returning four options for a three-option question has changed the question
 *    rather than reworded it. Positional alignment is what lets a label stand in for its value.
 * 2. **Uniqueness** — a label stands in for its option, and an option string IS the stored answer, so two
 *    options sharing a label would make the choice ambiguous and silently record the wrong one. This is a
 *    live risk, not a theoretical one: dropping the wrong detail is exactly what collapses "sharper at 39"
 *    and "sharper than at 35" into one phrase. When it happens, `answersStillWrong` is the honest exit.
 *
 * The reserved `Other` option is pinned in place — renaming it turns off the write-in (`allowOther` is
 * derived from the option list), so a rewrite may never touch it.
 */
function sameLengthList(value: unknown, original: string[] | undefined): string[] | undefined {
  if (!original || !Array.isArray(value) || value.length !== original.length) return undefined;
  const out = original.map((o, i) => (o === OTHER ? OTHER : (text(value[i]) ?? o)));
  // Only enforce distinctness the rewrite could have broken — originals that already collide stay as they are.
  const originalsDistinct = new Set(original).size === original.length;
  if (originalsDistinct && new Set(out).size !== out.length) return undefined;
  return out.some((v, i) => v !== original[i]) ? out : undefined;
}

/**
 * A rewrite as it arrives from the model — every field optional AND explicitly `| undefined`, since a
 * tolerant Zod parse yields `undefined` keys that `exactOptionalPropertyTypes` won't accept into
 * `Partial<QuestionRewrite>`.
 */
export interface ProposedRewrite {
  prompt?: string | undefined;
  help?: string | undefined;
  options?: string[] | undefined;
  scaleLabels?:
    | { min?: string | undefined; mid?: string | undefined; max?: string | undefined }
    | undefined;
  matrixRows?: string[] | undefined;
  matrixPointLabels?: string[] | undefined;
  answersStillWrong?: boolean | undefined;
}

/**
 * Validate a model-proposed rewrite against the question it claims to rewrite, dropping anything that would
 * change structure rather than wording. Returns only the labels that genuinely differ, so an unchanged
 * question yields `{ prompt }` alone and the caller can tell nothing moved.
 */
export function sanitizeRewrite(q: Question, proposed: ProposedRewrite): QuestionRewrite {
  const current = questionLabels(q);
  const prompt = text(proposed.prompt) ?? current.prompt;
  const help = current.help != null ? text(proposed.help) : undefined;
  const options = sameLengthList(proposed.options, current.options);
  const matrixRows = sameLengthList(proposed.matrixRows, current.matrixRows);
  const matrixPointLabels = sameLengthList(proposed.matrixPointLabels, current.matrixPointLabels);

  // An anchor may only be reworded when the question already HAS one — a rewrite never adds a label.
  const s = proposed.scaleLabels;
  const anchor = (
    existing: string | undefined,
    proposedLabel: string | undefined,
  ): string | undefined => (existing != null ? text(proposedLabel) : undefined);
  const min = current.scaleLabels && s ? anchor(current.scaleLabels.min, s.min) : undefined;
  const mid = current.scaleLabels && s ? anchor(current.scaleLabels.mid, s.mid) : undefined;
  const max = current.scaleLabels && s ? anchor(current.scaleLabels.max, s.max) : undefined;
  const scale = {
    ...(min != null ? { min } : {}),
    ...(mid != null ? { mid } : {}),
    ...(max != null ? { max } : {}),
  };

  return {
    prompt,
    ...(help != null && help !== current.help ? { help } : {}),
    ...(options ? { options } : {}),
    ...(Object.keys(scale).length ? { scaleLabels: scale } : {}),
    ...(matrixRows ? { matrixRows } : {}),
    ...(matrixPointLabels ? { matrixPointLabels } : {}),
    ...(proposed.answersStillWrong === true ? { answersStillWrong: true } : {}),
  };
}

/** Whether a rewrite changes anything the recipient can see beyond the prompt (drives the "answers" diff). */
export function rewriteTouchesAnswers(rewrite: QuestionRewrite): boolean {
  return Boolean(
    rewrite.options ?? rewrite.matrixRows ?? rewrite.matrixPointLabels ?? rewrite.scaleLabels,
  );
}

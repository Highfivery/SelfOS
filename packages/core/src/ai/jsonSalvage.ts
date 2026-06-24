import { z } from 'zod';

/**
 * Shared, tolerant model-output (JSON) parsing + honest-failure classification (37-ai-output-robustness).
 *
 * Every structured-JSON producer in `@selfos/core` (questionnaire generation/improve/variant/gap-finder/
 * analysis/alignment/context-only distill, session analysis, dream synthesis, memory reconcile, the
 * onboarding portrait) parses a model reply that is frequently imperfect — one off-spec optional field, a
 * missing-but-non-essential field, a single bad element in a batch, or a reply that got cut off mid-output.
 *
 * The contract (a documented CLAUDE.md lesson): **a strict `.parse` on a model reply is the wrong contract.**
 * One imperfection must never discard an otherwise-usable result, and the parse boundary must own a
 * balanced-brace salvage for truncation. This module is the single place that logic lives.
 *
 * Pure, host-side, no I/O — the salvage runs in core before any persisted write; the renderer only ever sees
 * the derived result + an honest, distinct message (§5.4). No raw model reply crosses IPC.
 */

/** The honest, distinct reasons a model reply produced no usable parsed result (37 §3.2). */
export type AiParseFailureReason = 'TRUNCATED' | 'MALFORMED' | 'REFUSED';

const stripFences = (text: string): string => text.replace(/```json/gi, '').replace(/```/g, '');

/**
 * Pull the first balanced JSON OBJECT out of a model reply (tolerates ```json fences / surrounding prose).
 * Non-throwing: returns `null` when there is no parseable object (callers branch on `null`).
 */
export function extractJsonObject(text: string): unknown | null {
  const fenced = stripFences(text);
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Pull the first JSON ARRAY out of a model reply (tolerates fences / surrounding prose). Non-throwing:
 * returns `null` when there is no parseable array (use `salvageJsonArray` to recover a truncated one).
 */
export function extractJsonArray(text: string): unknown | null {
  const fenced = stripFences(text);
  const start = fenced.indexOf('[');
  const end = fenced.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Walk from the `[` at `arrStart` collecting every COMPLETE top-level `{...}` element via depth tracking,
 * skipping a truncated trailing one. String-aware (braces inside strings don't affect depth). Recovers only
 * OBJECT elements — the shape every batch producer uses. Returns what parsed (possibly empty).
 */
function scanCompleteObjects(s: string, arrStart: number): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let objStart = -1;
  let inStr = false;
  let esc = false;
  for (let i = arrStart + 1; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try {
          out.push(JSON.parse(s.slice(objStart, i + 1)));
        } catch {
          /* skip a malformed element */
        }
        objStart = -1;
      }
    } else if (c === ']' && depth === 0) {
      break;
    }
  }
  return out;
}

/**
 * Recover the COMPLETE object elements of the first JSON array in a (possibly truncated) reply — the
 * generalization of the portrait fact-salvage. Used to salvage a suggestions / variant / items array that
 * got cut off mid-stream: the complete elements are kept, a truncated trailing one is skipped.
 */
export function salvageJsonArray(text: string): unknown[] {
  const stripped = stripFences(text);
  const arrStart = stripped.indexOf('[');
  if (arrStart === -1) return [];
  return scanCompleteObjects(stripped, arrStart);
}

/**
 * Recover the COMPLETE object elements of a named array field (`"field": [ ... ]`) inside a truncated
 * object — e.g. the portrait's `facts` after a cut-off `portrait` summary. Returns `[]` if the field /
 * array never appeared.
 */
export function salvageJsonObjectArrayField(text: string, field: string): unknown[] {
  const stripped = stripFences(text);
  const fieldIdx = stripped.indexOf(`"${field}"`);
  if (fieldIdx === -1) return [];
  const arrStart = stripped.indexOf('[', fieldIdx);
  if (arrStart === -1) return [];
  return scanCompleteObjects(stripped, arrStart);
}

/**
 * Recover a leading JSON STRING field from a (possibly truncated) object — the generalization of the
 * portrait's `"portrait":"..."` recovery. Lets a truncated object still yield its essential string field
 * (e.g. a session/distill `summary`, the `portrait` text). Returns `null` if the field never appeared or
 * its value didn't decode.
 */
export function salvageJsonObjectField(text: string, field: string): string | null {
  const stripped = stripFences(text);
  const match = stripped.match(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (!match?.[1]) return null;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return null;
  }
}

/**
 * A per-element-salvaging array validator: each element is `.catch(sentinel)` (a bad element becomes the
 * sentinel instead of failing the whole array), the array itself `.catch([])`, then the sentinels are
 * dropped via `keep`. So one malformed question/fact/suggestion never discards the rest (37 §3.1).
 */
export function tolerantArray<T extends z.ZodTypeAny>(
  element: T,
  sentinel: z.infer<T>,
  keep: (value: z.infer<T>) => boolean,
): z.ZodType<z.infer<T>[], z.ZodTypeDef, unknown> {
  return z
    .array(element.catch(sentinel))
    .catch([] as z.infer<T>[])
    .transform((items) => items.filter(keep)) as unknown as z.ZodType<
    z.infer<T>[],
    z.ZodTypeDef,
    unknown
  >;
}

/**
 * Whether a reply ends with an UNCLOSED JSON structure (or string) — the truncation signal. String-aware,
 * so a `}` inside a string value doesn't false-close. Used by `classifyParseFailure`.
 */
function endsUnclosed(text: string): boolean {
  let depth = 0;
  let inStr = false;
  let esc = false;
  let sawOpen = false;
  for (const c of text) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') {
      depth++;
      sawOpen = true;
    } else if (c === '}' || c === ']') depth--;
  }
  return sawOpen && (depth > 0 || inStr);
}

/**
 * Conservative refusal-prose markers (37 §5.3) — host-only, small, English-first. We classify `REFUSED`
 * ONLY when there is no salvageable JSON AND the prose reads as a decline. A false negative (a refusal read
 * as `MALFORMED` → "unexpected shape, try again") is PREFERRED to a false positive (telling the user the
 * model refused when it merely truncated) — the never-assume-a-refusal rule (CLAUDE.md §6).
 */
const REFUSAL_MARKERS = [
  "i can't help",
  'i cannot help',
  "i can't assist",
  'i cannot assist',
  "i'm not able to",
  'i am not able to',
  "i'm unable to",
  'i am unable to',
  "i won't",
  'i will not',
  "i can't provide",
  'i cannot provide',
  "i can't create",
  'i cannot create',
  "i can't generate",
  'i cannot generate',
];

function looksLikeRefusal(text: string): boolean {
  const lower = text.toLowerCase();
  return REFUSAL_MARKERS.some((m) => lower.includes(m));
}

/**
 * Classify WHY a model reply produced no usable parsed result. Called only on the failure branch (after
 * tolerant parse + salvage recovered nothing usable), so condition (a) of §5.3 — "no salvageable JSON" —
 * already holds. Order matters: an empty reply or an unclosed structure is `TRUNCATED` (a retry; an empty
 * output is the classic token-starvation symptom, §17.9); else a refusal-shaped reply is `REFUSED`; else
 * `MALFORMED`. NEVER assumes a refusal first.
 */
export function classifyParseFailure(text: string): AiParseFailureReason {
  if (text.trim() === '') return 'TRUNCATED';
  if (endsUnclosed(text)) return 'TRUNCATED';
  if (looksLikeRefusal(text)) return 'REFUSED';
  return 'MALFORMED';
}

/** The honest, distinct user-facing message for a parse-failure reason (37 §3.2; wording approved §11). */
export function aiFailureMessage(reason: AiParseFailureReason, noun: string): string {
  switch (reason) {
    case 'TRUNCATED':
      return `The ${noun} was cut off before it finished. Please try again.`;
    case 'MALFORMED':
      return `The ${noun} came back in an unexpected shape. Please try again.`;
    case 'REFUSED':
      return 'The AI couldn’t help with this one.';
  }
}

/** Classify a parse failure and build its honest message in one step (the common call-site pattern). */
export function classifyParseOutcome(
  text: string,
  noun: string,
): { reason: AiParseFailureReason; message: string } {
  const reason = classifyParseFailure(text);
  return { reason, message: aiFailureMessage(reason, noun) };
}

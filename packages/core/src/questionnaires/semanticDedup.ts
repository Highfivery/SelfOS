import { extractJsonArray, salvageJsonArray } from '../ai/jsonSalvage';
import type { Question, UsageEvent } from '../schemas';
import { runClaude, type AiDeps } from './aiCall';

/**
 * The semantic de-duplication pass (08-questionnaires §23.5, layer 3). The fuzzy filter (`dedup.ts`) catches
 * word-level repeats; this catches MEANING-level ones — a question that asks the same thing in entirely
 * different words as something the recipient already shared or was asked. One bounded, metered Claude call that
 * classifies each candidate as "new" vs "already covered" and returns the indices to KEEP.
 *
 * FAIL-SAFE (37): on AI-off / over-budget / any parse failure it returns ALL candidates unchanged — a de-dup
 * refinement must never lose the author's questions or dead-end. An empty keep-list is treated as a parse
 * artifact (keep all), not "drop everything." AUTHOR-BLIND (§17.4): only keep/drop indices come back — the
 * recipient's reference material never leaves this host-side call.
 */

const SEMANTIC_DEDUP_SYSTEM = `You are a precise de-duplication filter for questionnaire questions. You are given (1) a summary of what a person has ALREADY shared with an app or been asked before, and (2) a numbered list of NEW candidate questions. Identify which candidates are genuinely NEW — they ask something not already covered by the known material, even loosely. A candidate is a DUPLICATE if it re-asks something already known or asked, even in completely different words.
Return ONLY a JSON array of the 1-based indices of the candidates to KEEP (the genuinely-new ones). Keep a candidate unless it clearly overlaps the known material. No prose, no keys, no markdown — just the array, e.g. [1,3,4].`;

/** Cap the reference material fed to the pass so the call stays cheap (§23.5 — a bounded digest, not the blob). */
const MAX_REFERENCE_CHARS = 3000;

export interface SemanticDedupResult {
  kept: Question[];
  usage?: UsageEvent;
}

/**
 * Filter `candidates` down to the ones a model judges genuinely new against `reference` (a bounded digest of the
 * recipient's known/asked material). Returns the kept subset + the call's usage; on ANY failure returns every
 * candidate (fail-safe). Skips the call entirely when there are 0–1 candidates or no reference (nothing to do).
 */
export async function semanticDedupFilter(
  deps: AiDeps,
  candidates: Question[],
  reference: string,
): Promise<SemanticDedupResult> {
  const ref = reference.trim();
  if (candidates.length <= 1 || ref === '') return { kept: candidates };

  const numbered = candidates.map((q, i) => `${i + 1}. ${q.prompt}`).join('\n');
  const user = `ALREADY KNOWN / ALREADY ASKED (do not re-ask these, in any wording):\n${ref.slice(
    0,
    MAX_REFERENCE_CHARS,
  )}\n\nCANDIDATE NEW QUESTIONS:\n${numbered}\n\nReturn the JSON array of 1-based indices to KEEP (the genuinely-new candidates).`;

  const call = await runClaude(deps, SEMANTIC_DEDUP_SYSTEM, user, 'questionnaire.dedup', 300);
  if (!call.ok) return { kept: candidates }; // fail-safe: keep all on NO_KEY / BUDGET / ERROR

  const whole = extractJsonArray(call.text);
  const raw = Array.isArray(whole) ? whole : salvageJsonArray(call.text);
  const keepIdx = new Set(
    (Array.isArray(raw) ? raw : [])
      .map((n) => (typeof n === 'number' ? Math.trunc(n) : Number.NaN))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= candidates.length),
  );
  // An empty/garbled keep-list is ambiguous (likely a parse artifact) → keep all rather than drop everything.
  if (keepIdx.size === 0) return { kept: candidates, usage: call.usage };
  const kept = candidates.filter((_, i) => keepIdx.has(i + 1));
  return { kept, usage: call.usage };
}

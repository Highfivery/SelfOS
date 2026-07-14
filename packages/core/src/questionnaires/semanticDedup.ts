import { extractJsonArray, salvageJsonArray } from '../ai/jsonSalvage';
import type { Question, UsageEvent } from '../schemas';
import { runClaude, type AiDeps } from './aiCall';

/**
 * The semantic de-duplication pass (08-questionnaires §23.5, layer 3). The fuzzy filter (`dedup.ts`) catches
 * word-level repeats; this catches MEANING-level ones — a question that asks the same thing in entirely
 * different words as (a) something the recipient already shared or was asked, OR (b) an EARLIER candidate in
 * the SAME generated set (intra-batch, issue #192 — the model over-produces near-identical questions, most
 * often in intimacy sets, that the fuzzy filter's word-overlap misses). One bounded, metered Claude call that
 * classifies each candidate as "new" vs "duplicate" and returns the indices to KEEP.
 *
 * FAIL-SAFE (37): on AI-off / over-budget / any parse failure it returns ALL candidates unchanged — a de-dup
 * refinement must never lose the author's questions or dead-end. An empty keep-list is treated as a parse
 * artifact (keep all), not "drop everything." AUTHOR-BLIND (§17.4): only keep/drop indices come back — the
 * recipient's reference material never leaves this host-side call.
 */

const SEMANTIC_DEDUP_SYSTEM = `You are a strict de-duplication filter for questionnaire questions. You are given (1) a record of what a person has ALREADY answered in onboarding or been asked before (this may be empty), and (2) a numbered list of NEW candidate questions. Return the candidates to KEEP, dropping duplicates.

DROP a candidate when EITHER of these is true:
- The known material already answers it OR asks the same thing — even when the wording is completely different, and even when the candidate asks about a SUB-PREFERENCE or DETAIL already covered. Examples: the person listed "MMF, FFM" among their porn genres and the candidate asks "Do you prefer MMF or FFM threesomes?"; they rated an act in onboarding and the candidate asks whether they like that act; they stated a boundary/kink/frequency and the candidate re-asks it.
- It asks essentially the same thing as an EARLIER-NUMBERED candidate in the list — even in different words or from a slightly different angle. Two questions that would draw basically the same answer are duplicates: keep the FIRST, drop the later near-duplicate.

Going DEEPER on a topic in a genuinely new way (a follow-up that asks something NOT already stated or asked, and distinct from every other candidate) is NOT a duplicate — keep it. When in doubt about whether a candidate duplicates the known material OR an earlier candidate, DROP it.

Return ONLY a JSON array of the 1-based indices of the candidates to KEEP. No prose, no keys, no markdown — just the array, e.g. [1,3,4].`;

/** Cap the reference material fed to the pass (§23.5b/§24.3-A3). Generous so the authoritative "already have
 *  data for this" material (onboarding answers + prior-questionnaire answers) — which LEADS the reference — is
 *  never truncated away; the lower-priority insight facts + asked prompts follow and are what gets cut first. */
const MAX_REFERENCE_CHARS = 16000;

export interface SemanticDedupResult {
  kept: Question[];
  usage?: UsageEvent;
}

/**
 * Filter `candidates` down to the ones a model judges genuinely new against `reference` (a bounded digest of the
 * recipient's known/asked material) AND distinct from EACH OTHER (intra-batch, issue #192). Returns the kept
 * subset + the call's usage; on ANY failure returns every candidate (fail-safe). Skips the call only when there
 * are 0–1 candidates — with ≥2 candidates it always runs, since intra-batch dedup is worth a pass even when the
 * reference is empty (e.g. a first questionnaire to someone with no history).
 */
export async function semanticDedupFilter(
  deps: AiDeps,
  candidates: Question[],
  reference: string,
): Promise<SemanticDedupResult> {
  const ref = reference.trim();
  if (candidates.length <= 1) return { kept: candidates };

  const numbered = candidates.map((q, i) => `${i + 1}. ${q.prompt}`).join('\n');
  const knownBlock =
    ref === ''
      ? 'ALREADY KNOWN / ALREADY ASKED: (none on record — dedupe the candidates against EACH OTHER only)'
      : `ALREADY KNOWN / ALREADY ASKED (do not re-ask these, in any wording):\n${ref.slice(
          0,
          MAX_REFERENCE_CHARS,
        )}`;
  const user = `${knownBlock}\n\nCANDIDATE NEW QUESTIONS:\n${numbered}\n\nReturn the JSON array of 1-based indices to KEEP — drop any candidate that duplicates the known material OR an earlier candidate.`;

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

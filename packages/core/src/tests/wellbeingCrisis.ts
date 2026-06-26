import type { ScoreAnswers } from './scoring';
import type { CrisisItem, TestDefinition, WellbeingBand } from './types';

/**
 * 51-wellbeing-neurodivergence-reflections §5.2 — the deterministic, AI-free crisis-detection hook. The heart
 * of this spec's safety. Pure functions: NEVER throw, NEVER call a model. Two independent triggers (either ⇒
 * flag):
 *   (1) ITEM-LEVEL — any `crisisItems` question / matrix-row answered at/above its `atOrAbove` (PHQ-9 item 9
 *       positive). Evaluated mid-check-in by the renderer for the immediate escalation (§3.2 step 3), and at
 *       score time by the bridge for the authoritative `crisisFlag`.
 *   (2) BAND-LEVEL — the resolved {@link WellbeingBand} has `crisis: true` (a high overall score, e.g. PHQ-9
 *       'severe').
 *
 * Crisis routing is never behind a setting and always works offline / AI-off (§8.2).
 */

/**
 * Flatten an answers map to `id → number` so a crisis item (a standalone numeric id OR a matrix row key) can
 * be looked up regardless of how the renderer keyed it. A matrix answer is a `Record<rowKey, number>`; its
 * entries are spread by row key. Standalone numeric answers are kept by question id. No definition needed, so
 * the renderer can call it from the live answers alone (the definition is already client-side for rendering).
 */
export function flattenAnswerValues(answers: ScoreAnswers): Map<string, number> {
  const map = new Map<string, number>();
  for (const [id, value] of Object.entries(answers)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      map.set(id, value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [rowKey, raw] of Object.entries(value as Record<string, number>)) {
        if (typeof raw === 'number' && Number.isFinite(raw)) map.set(rowKey, raw);
      }
    }
  }
  return map;
}

/** Item-level crisis: any `crisisItems` entry answered at/above its threshold. Pure; no model. */
export function crisisItemPositive(
  crisisItems: CrisisItem[] | undefined,
  answers: ScoreAnswers,
): boolean {
  if (!crisisItems || crisisItems.length === 0) return false;
  const values = flattenAnswerValues(answers);
  return crisisItems.some((item) => {
    const value = values.get(item.questionId);
    return value !== undefined && value >= item.atOrAbove;
  });
}

/**
 * Resolve a wellbeing instrument's internal clinical band from a raw total — the first band (ascending
 * `upToRaw`) whose bound covers the total; the highest band when the total exceeds every bound. Returns
 * undefined for a non-wellbeing definition or one with no `bands`.
 */
export function resolveWellbeingBand(
  def: TestDefinition,
  rawTotal: number,
): WellbeingBand | undefined {
  if (!def.bands || def.bands.length === 0) return undefined;
  const sorted = [...def.bands].sort((a, b) => a.upToRaw - b.upToRaw);
  for (const band of sorted) if (rawTotal <= band.upToRaw) return band;
  return sorted[sorted.length - 1];
}

/**
 * The result-level crisis decision (§5.2): item-level (any crisis item positive) OR band-level (the resolved
 * band has `crisis: true`). Pure, deterministic, AI-free — drives the derived Insight's `crisisFlag`.
 */
export function detectWellbeingCrisis(
  def: TestDefinition,
  answers: ScoreAnswers,
  band?: WellbeingBand,
): boolean {
  return crisisItemPositive(def.crisisItems, answers) || band?.crisis === true;
}

/**
 * Mid-check-in convenience (§3.2 step 3): does answering one item with `value` trip the crisis surface? Pure,
 * client-evaluable from the definition's `crisisItems` (the bridge still authoritatively sets the result's
 * `crisisFlag` at score time). Handles a matrix row id by matching the crisis item's `questionId` directly.
 */
export function answerTriggersCrisis(
  def: TestDefinition,
  questionId: string,
  value: number,
): boolean {
  return (def.crisisItems ?? []).some(
    (item) => item.questionId === questionId && Number.isFinite(value) && value >= item.atOrAbove,
  );
}

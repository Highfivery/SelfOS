import type { ContextTopic } from '../schemas';

/**
 * Map a questionnaire `type` → relevance life-areas (28 §13.1 — the deferred 28b follow-up). Pure +
 * deterministic, NO AI cost. The starter taxonomy (08 §15.1) is mostly feedback-oriented (general /
 * role-feedback / blind-spots / …) with no single life-area, so only the clearly-themed types map; everything
 * else (incl. custom types) ⇒ `undefined` ⇒ the always-on core + priority fill (the safe default). Extend this
 * map as themed types are added. Used by the questionnaire-generation context provider.
 */
export const QUESTIONNAIRE_TYPE_LIFE_AREAS: Record<string, string[]> = {
  intimacy: ['Intimacy', 'Relationships'],
  scenario: ['Intimacy', 'Relationships'],
  'role-feedback': ['Relationships', 'Work & purpose'],
  'blind-spots': ['Relationships', 'Emotions & patterns'],
  appreciation: ['Relationships', 'Values & beliefs'],
  perspective: ['Relationships', 'Emotions & patterns'],
  // `general`, `fill-gaps`, `science`, and custom types stay broad (undefined ⇒ core + priority fill).
};

/** The relevance `topic` for generating a questionnaire of this type, or `undefined` (core + fill). */
export function questionnaireTopic(type: string | undefined): ContextTopic | undefined {
  const areas = type ? QUESTIONNAIRE_TYPE_LIFE_AREAS[type] : undefined;
  return areas && areas.length > 0 ? { lifeAreas: areas } : undefined;
}

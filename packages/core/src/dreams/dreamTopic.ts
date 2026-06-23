import { LIFE_AREAS, type ContextTopic, type Dream } from '../schemas';
import { lifeAreasFromText } from '../insights/lifeAreaKeywords';

/**
 * Derive the relevance `topic` for a dream's analysis (28 §13.1 — the deferred 28b follow-up). Pure +
 * deterministic, NO AI cost: the dream's tags + narrative are scanned for life-area keywords (so a dream that
 * mentions a partner/sex surfaces `Intimacy`, money surfaces `Money`, etc.), a `nightmare` (or heavy negative
 * waking mood) always adds `Emotions & patterns`, and any people present add `Relationships`. The topic only
 * WIDENS which PINNED portrait facts surface (the summary always feeds, 28b), so a coarse signal is safe; no
 * mappable signal ⇒ `undefined` (the always-on core + priority fill). Emitted in canonical `LIFE_AREAS` order.
 */
export function dreamTopic(dream: Dream): ContextTopic | undefined {
  const areas = new Set<string>(lifeAreasFromText([...dream.tags, dream.narrative].join(' ')));
  if (dream.nightmare || (typeof dream.mood === 'number' && dream.mood <= -0.5)) {
    areas.add('Emotions & patterns');
  }
  if (dream.people.length > 0) areas.add('Relationships');
  if (areas.size === 0) return undefined;
  return { lifeAreas: LIFE_AREAS.filter((area) => areas.has(area)) };
}

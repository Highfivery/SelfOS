import { LIFE_AREAS, type LifeArea } from '../schemas';

/**
 * Normalize AI-suggested life-area categories to the fixed taxonomy (20-memory-dashboard §3.1/§11): keep
 * only known `LIFE_AREAS` (case-insensitive match), de-dupe, cap at **2**, and fall back to `['Other']`
 * when nothing valid came back — so an insight is always tagged with 1–2 real life-areas regardless of what
 * the model returns. Producers run their AI-suggested categories through this before saving.
 */
export function normalizeCategories(raw: readonly string[]): LifeArea[] {
  const byLower = new Map(LIFE_AREAS.map((area) => [area.toLowerCase(), area]));
  const out: LifeArea[] = [];
  for (const candidate of raw) {
    const match = byLower.get(candidate.trim().toLowerCase());
    if (match && !out.includes(match)) out.push(match);
    if (out.length === 2) break;
  }
  return out.length > 0 ? out : ['Other'];
}

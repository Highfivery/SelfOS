import type { TestDefinition, WellbeingBand } from './types';

/**
 * Wellbeing band resolution (51 §3.2).
 *
 * without taking the wellbeing result screen with it.
 */

/**
 * Resolve a wellbeing instrument's internal band from a raw total — the first band (ascending `upToRaw`)
 * whose bound covers the total; the highest band when the total exceeds every bound. Returns undefined
 * for a definition with no `bands`.
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

import type { FileSystem } from '../host';
import { listInsightsForPerson, saveInsight } from './insightStore';
import { lifeAreasFromText } from './lifeAreaKeywords';

/**
 * Retro-tag a legacy (pre-28b) untagged onboarding portrait's facts with a life-area, no AI (39-living-memory
 * §4.5 / §11 Q5). A portrait synthesized before per-fact `lifeArea` has NO tags, so `selectPortraitFacts` can't
 * topic-narrow it — it pushes its full (bounded) fact set into every coaching call. This lazily infers each
 * untagged fact's life-area from the cheap deterministic keyword map (rougher than the model, but free), so an
 * old portrait starts topic-narrowing like a fresh one.
 *
 * Idempotent + conservative: only an `intake` insight whose facts are ALL untagged is touched (a fresh /
 * already-retagged portrait is skipped); a fact with no keyword match stays untagged (it's then treated as
 * always-on CORE — never hidden, the §pillar-2 safety). `updatedAt` is intentionally NOT bumped (invisible
 * maintenance, the `reapOrphanShares` precedent). Returns the count of portraits retagged.
 */
export async function retroTagLegacyPortraits(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<number> {
  let tagged = 0;
  for (const insight of await listInsightsForPerson(fs, key, personId)) {
    if (insight.source !== 'intake') continue;
    if (insight.facts.length === 0) continue;
    if (insight.facts.some((f) => f.lifeArea)) continue; // already tagged (fresh / previously retro-tagged)
    let changed = false;
    const facts = insight.facts.map((fact) => {
      const area = lifeAreasFromText(fact.text)[0];
      if (!area) return fact; // no confident match → leave untagged (treated as CORE, never hidden)
      changed = true;
      return { ...fact, lifeArea: area };
    });
    if (changed) {
      await saveInsight(fs, key, { ...insight, facts });
      tagged += 1;
    }
  }
  return tagged;
}

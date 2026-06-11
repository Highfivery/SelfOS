import type { FileSystem } from '../host';
import type { DreamShareResult, DreamShareTarget, Insight } from '../schemas';
import { getInsight, saveInsight } from '../insights';
import { listRelatedPeople } from '../people';
import { getAnalysis, getDream } from './dreamService';

/**
 * Per-dream sharing (12-dreams §3.4/§5.1). A dreamer can promote specific facts of an approved dream
 * analysis's `Insight` into a **related** person's coaching context — off by default, per-fact, per-person.
 * Mechanism: each `InsightFact.shareableWith` accumulates the person ids the fact is shared with;
 * `summarizeForContext` then surfaces it to those people (08 §4.4). Sensitive-tier dreams are excluded so
 * intimate content can't leak (§8.3). Cross-person sharing is gated by `dreams.shareContext` in the host.
 */

/** The people the dreamer can share a dream insight with — their relationship-graph relations. */
export async function listDreamShareTargets(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<DreamShareTarget[]> {
  return listRelatedPeople(fs, key, personId);
}

/** The approved Insight a dream's analysis produced (facts + current sharing), or null if not approved. */
export async function getDreamInsight(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  dreamId: string,
): Promise<Insight | null> {
  const analysis = await getAnalysis(fs, key, personId, dreamId);
  if (!analysis?.insightId) return null;
  return getInsight(fs, key, personId, analysis.insightId);
}

/**
 * Share (or unshare) one of a dream insight's facts with a related person. Refuses for sensitive-tier
 * dreams (§8.3) and for a non-related / unknown target. Idempotent — toggling the same person on/off
 * adds/removes them from the fact's `shareableWith`.
 */
export async function setDreamFactShare(deps: {
  fs: FileSystem;
  key: Uint8Array;
  personId: string;
  dreamId: string;
  factId: string;
  withPersonId: string;
  share: boolean;
  now: Date;
}): Promise<DreamShareResult> {
  const { fs, key, personId, dreamId, factId, withPersonId, share, now } = deps;

  const dream = await getDream(fs, key, personId, dreamId);
  if (!dream) return { ok: false, reason: 'NOT_FOUND' };
  // Sensitive-tier dreams are kept out of shared context entirely (12 §8.3) — intimate content can't leak.
  if (dream.sensitivity !== 'standard') return { ok: false, reason: 'SENSITIVE' };

  // The target must be a real related person — sharing with anyone else would never reach their context.
  const targets = await listDreamShareTargets(fs, key, personId);
  if (!targets.some((target) => target.id === withPersonId)) {
    return { ok: false, reason: 'NOT_FOUND' };
  }

  const insight = await getDreamInsight(fs, key, personId, dreamId);
  if (!insight || !insight.facts.some((fact) => fact.id === factId)) {
    return { ok: false, reason: 'NOT_FOUND' };
  }

  const facts = insight.facts.map((fact) => {
    if (fact.id !== factId) return fact;
    const next = new Set(fact.shareableWith ?? []);
    if (share) next.add(withPersonId);
    else next.delete(withPersonId);
    const updated = { ...fact };
    if (next.size > 0) updated.shareableWith = [...next];
    else delete updated.shareableWith; // drop the prop entirely when no targets remain (additive-optional)
    return updated;
  });
  await saveInsight(fs, key, { ...insight, facts, updatedAt: now.toISOString() });
  return { ok: true };
}

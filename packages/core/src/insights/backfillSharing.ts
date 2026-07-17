import type { FileSystem } from '../host';
import type { Insight, InsightFact } from '../schemas';
import { listInsightsForPerson, saveInsight } from './insightStore';
import { DEFAULT_INSIGHT_SHARE_TYPES } from './shareDefaults';

/** A fact the backfill may bring up to the partner default: never-configured + default-private. */
function isDefaultPrivate(f: InsightFact): boolean {
  return (
    f.shareable === false &&
    f.restricted !== true &&
    f.flaggedInaccurate !== true &&
    f.shareableTypes === undefined &&
    (f.shareableWith === undefined || f.shareableWith.length === 0)
  );
}

/** Whether an insight is eligible for the sharing backfill at all. */
function isBackfillable(insight: Insight): boolean {
  // Intake facts derive their scope from the person's onboarding answers (an explicit choice, reverted
  // on re-synthesis) — never touch them here.
  if (insight.source === 'intake') return false;
  // Compatibility insights (report + context-only distill) have their sharing governed by the visibility
  // mode chosen at send (§16.2) — don't override that with a blanket backfill.
  if (insight.provenance.compatibilityGroupId) return false;
  return true;
}

/**
 * One-time, idempotent backfill that brings a person's EXISTING insight facts up to the
 * shared-with-partner default (owner decision, 2026-07-17 — "ALL insights default to shared-with-partner").
 *
 * Touches only **never-configured, default-private** facts (`shareable:false`, not `restricted`, not
 * `flaggedInaccurate`, and carrying NO explicit `shareableTypes`/`shareableWith`). Every explicit choice
 * the person already made is preserved — a manually-private fact writes `shareableTypes: []`, a per-person
 * share sets `shareableWith`, and a break-glass fact is `restricted` — so none of those are re-shared.
 * Onboarding-scoped (`intake`) and compatibility insights are skipped entirely (see `isBackfillable`).
 *
 * Persists to the subject's own insight files (preserving `updatedAt`, so Memory order is unchanged) so a
 * partner's `buildContext` picks it up. Returns the number of insights it rewrote (0 once complete).
 */
export async function backfillPartnerSharing(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<number> {
  const insights = await listInsightsForPerson(fs, key, personId);
  let changed = 0;
  for (const insight of insights) {
    if (!isBackfillable(insight)) continue;
    let touched = false;
    const facts: InsightFact[] = insight.facts.map((f) => {
      if (!isDefaultPrivate(f)) return f;
      touched = true;
      return { ...f, shareableTypes: [...DEFAULT_INSIGHT_SHARE_TYPES] };
    });
    if (touched) {
      await saveInsight(fs, key, { ...insight, facts });
      changed += 1;
    }
  }
  return changed;
}

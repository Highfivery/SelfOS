import type { FileSystem } from '../host';
import { DreamSchema, InsightSchema, type Insight } from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * The shared Insight / memory layer store (08-questionnaires §4.4). Insights are written encrypted under
 * the subject person's folder; `buildContext` (and, later, the gap-finder + tracking dashboards) read
 * them back. Questionnaire analysis is the first producer; session analysis (09) is the second.
 */

// v1 stores every insight under its subject person's folder (keyed by `subjectPersonId`). Spec §4.1 also
// defines `relationships/<rel-id>/insights/` for relationship-scoped insights — deferred to slice 11 (the
// tracking dashboard's producer); `Insight.relationshipId` is carried in the schema but not yet routed.
function insightsDir(personId: string): string {
  return `people/${personId}/insights`;
}

function insightPath(personId: string, insightId: string): string {
  return `${insightsDir(personId)}/${insightId}.enc`;
}

/** Write (or overwrite) an insight under its subject person's encrypted folder. */
export async function saveInsight(
  fs: FileSystem,
  key: Uint8Array,
  insight: Insight,
): Promise<void> {
  await writeEncryptedJson(fs, insightPath(insight.subjectPersonId, insight.id), insight, key);
}

/** Read one insight by subject person + id; null if absent. */
export async function getInsight(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  insightId: string,
): Promise<Insight | null> {
  const raw = await readEncryptedJson(fs, insightPath(personId, insightId), key);
  return raw ? InsightSchema.parse(raw) : null;
}

/** List a subject person's insights, newest first (by `updatedAt`). */
export async function listInsightsForPerson(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<Insight[]> {
  const out: Insight[] = [];
  for (const name of await fs.list(insightsDir(personId))) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(fs, `${insightsDir(personId)}/${name}`, key);
    if (!raw) continue;
    const insight = InsightSchema.parse(raw);
    // Defense in depth: only serve insights whose subject matches the folder, so a misplaced or tampered
    // file can't leak into another person's context (hardening the shareable-vs-private boundary, §8.4).
    if (insight.subjectPersonId === personId) out.push(insight);
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return out;
}

/** Delete an insight (no-op if absent). No key needed — removal doesn't read ciphertext. */
export async function deleteInsight(
  fs: FileSystem,
  personId: string,
  insightId: string,
): Promise<void> {
  await fs.remove(insightPath(personId, insightId));
}

/**
 * Every insight across all subject people, newest first — the "what the coach knows" / Memory surface
 * (08-questionnaires §3.7/§13.4). Reads the `people/` dir directly (not `peopleService`) to avoid a
 * people↔insights import cycle; a stray non-folder entry resolves to no insights (the host maps
 * `ENOTDIR` → []).
 */
export async function listAllInsights(fs: FileSystem, key: Uint8Array): Promise<Insight[]> {
  const out: Insight[] = [];
  for (const personId of await fs.list('people')) {
    out.push(...(await listInsightsForPerson(fs, key, personId)));
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return out;
}

/**
 * Apply edits to an insight and re-save (the approve-step + later edits, §3.7). Loads by subject +
 * id, merges the patch, bumps `updatedAt`. Returns the updated insight, or null if it's gone.
 */
export async function updateInsight(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  insightId: string,
  patch: Partial<Pick<Insight, 'summary' | 'facts' | 'approved' | 'confidence' | 'metrics'>>,
): Promise<Insight | null> {
  const existing = await getInsight(fs, key, personId, insightId);
  if (!existing) return null;
  const updated: Insight = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  await saveInsight(fs, key, updated);
  return updated;
}

/**
 * Whether an insight may feed coaching context at all (15-shareability §4.2). Every non-dream insight
 * does; a dream-sourced insight is suppressed when its dream's `informsContext` is off — so toggling a
 * dream to "private journal entry" non-destructively withholds its approved insight from BOTH the
 * dreamer's own context and related people's (the per-fact `shareableWith` targets too, since the whole
 * insight is dropped). Reads the dream file directly (not via the dreams module) to avoid an
 * insights↔dreams import cycle — the same tactic `listAllInsights` uses to dodge the people↔insights cycle.
 */
export async function insightFeedsContext(
  fs: FileSystem,
  key: Uint8Array,
  insight: Insight,
): Promise<boolean> {
  if (insight.source !== 'dream' || !insight.provenance.dreamId) return true;
  const path = `people/${insight.subjectPersonId}/dreams/${insight.provenance.dreamId}/dream.enc`;
  const raw = await readEncryptedJson(fs, path, key);
  if (raw === null) return true; // dream gone but insight lingering — fail open (delete paths clean both)
  const parsed = DreamSchema.safeParse(raw);
  // A present-but-malformed dream is treated as unreadable, NOT silently shared (15-shareability §7) — so
  // a deliberately-muted dream whose bytes corrupt can never leak its insight back into context.
  if (!parsed.success) return false;
  return parsed.data.informsContext !== false;
}

/** Filter a list of insights to those that may currently feed context (15-shareability §4.2). */
async function feedableInsights(
  fs: FileSystem,
  key: Uint8Array,
  insights: Insight[],
): Promise<Insight[]> {
  const out: Insight[] = [];
  for (const insight of insights) {
    if (await insightFeedsContext(fs, key, insight)) out.push(insight);
  }
  return out;
}

/**
 * Caps for how much Insight content feeds a single coaching context (08 §4.4). Prioritization is
 * recency-first (§11.7 leaves the exact weighting open to tune); these keep the system prompt bounded.
 */
const MAX_OWN_INSIGHTS = 12;
const MAX_SHARED_FACTS_PER_PERSON = 5;

/**
 * Build the Insight portion of a person's coaching context: their own **approved** insights (summary +
 * all facts — their private facts feed only their own coaching), plus the **shareable** facts from the
 * approved insights of the people they relate to. Others' private (non-shareable) facts are never
 * included — the shareable-vs-private split (04-people-roles §3.4). Recency-prioritized + capped.
 * Returns formatted lines, or '' when there's nothing to add.
 */
export async function summarizeForContext(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  related: { id: string; displayName: string }[],
): Promise<string> {
  const lines: string[] = [];

  const own = (
    await feedableInsights(
      fs,
      key,
      (await listInsightsForPerson(fs, key, personId)).filter((insight) => insight.approved),
    )
  ).slice(0, MAX_OWN_INSIGHTS);
  if (own.length > 0) {
    lines.push('What you understand about them so far:');
    for (const insight of own) {
      lines.push(`- ${insight.summary}`);
      for (const fact of insight.facts) lines.push(`  · ${fact.text}`);
    }
  }

  for (const other of related) {
    const otherApproved = await feedableInsights(
      fs,
      key,
      (await listInsightsForPerson(fs, key, other.id)).filter((insight) => insight.approved),
    );
    const shared = otherApproved
      // A related person's fact reaches THIS person's context if it's broadcast-shareable OR targeted
      // specifically at them (12-dreams §3.4 per-person sharing). Others' untargeted private facts never do.
      .flatMap((insight) =>
        insight.facts.filter(
          (fact) => fact.shareable || (fact.shareableWith?.includes(personId) ?? false),
        ),
      )
      .slice(0, MAX_SHARED_FACTS_PER_PERSON);
    if (shared.length === 0) continue;
    lines.push(`Shareable about ${other.displayName}:`);
    for (const fact of shared) lines.push(`- ${fact.text}`);
  }

  return lines.join('\n');
}

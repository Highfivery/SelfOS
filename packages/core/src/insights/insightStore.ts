import type { FileSystem } from '../host';
import { InsightSchema, type Insight } from '../schemas';
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

  const own = (await listInsightsForPerson(fs, key, personId))
    .filter((insight) => insight.approved)
    .slice(0, MAX_OWN_INSIGHTS);
  if (own.length > 0) {
    lines.push('What you understand about them so far:');
    for (const insight of own) {
      lines.push(`- ${insight.summary}`);
      for (const fact of insight.facts) lines.push(`  · ${fact.text}`);
    }
  }

  for (const other of related) {
    const shared = (await listInsightsForPerson(fs, key, other.id))
      .filter((insight) => insight.approved)
      .flatMap((insight) => insight.facts.filter((fact) => fact.shareable))
      .slice(0, MAX_SHARED_FACTS_PER_PERSON);
    if (shared.length === 0) continue;
    lines.push(`Shareable about ${other.displayName}:`);
    for (const fact of shared) lines.push(`- ${fact.text}`);
  }

  return lines.join('\n');
}

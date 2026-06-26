import type { FileSystem } from '../host';
import {
  DreamSchema,
  InsightSchema,
  factSharedWithViewer,
  type ContextTopic,
  type Insight,
  type InsightFact,
  type RelationshipType,
} from '../schemas';
import { confidentialityPreamble } from '../sharing';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * The shared Insight / memory layer store (08-questionnaires §4.4). Insights are written encrypted under
 * the subject person's folder; `buildContext` (and, later, the gap-finder + tracking dashboards) read
 * them back. Questionnaire analysis is the first producer; session analysis (09) is the second.
 */

/**
 * Session-analysis labels a goal fact `Goal: <text>` (sessionAnalysisService `addFacts('Goal', …)`). Those
 * facts stay on the insight — they're shown on the Sessions wrap-up card and are per-fact shareable — but
 * they are EXCLUDED from the subject's own coaching context here, because a person's open goals reach the
 * coach through the richer structured "Open commitments" line (`summarizeOpenCommitments`, 39-living-memory
 * §5.2) which carries status / due / staleness. Emitting them both ways double-grounded every goal (39 §4.4).
 * The format is locked by sessionAnalysisService's tests, so this prefix can't silently drift.
 */
export const GOAL_FACT_PREFIX = 'Goal: ';

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
  // A `facts` patch from the renderer only carries `{id, text, shareable}` — the server-owned `restricted`
  // (18-personal-onboarding §8.4) and `shareableWith` (12-dreams §3.4) flags are NOT in it. Merge by id so
  // editing/approving a fact in Memory can never silently strip the break-glass restriction or per-person
  // sharing off it (which would leak a restricted intake fact into the owner's normal view + others' context).
  const mergedFacts = patch.facts
    ? patch.facts.map((fact) => {
        const prior = existing.facts.find((p) => p.id === fact.id);
        return prior ? { ...prior, ...fact } : fact;
      })
    : undefined;
  const updated: Insight = {
    ...existing,
    ...patch,
    ...(mergedFacts ? { facts: mergedFacts } : {}),
    updatedAt: new Date().toISOString(),
  };
  await saveInsight(fs, key, updated);
  return updated;
}

/**
 * Set or clear a fact's `flaggedInaccurate` correction (20-memory-dashboard §3.6). `factId === null` flags
 * (or clears) **every** fact on the insight (the "flag the whole insight" affordance). Flagging stamps
 * `flaggedAt`; clearing removes the flag fields entirely. The fact stays stored + visible in Memory — it's
 * only excluded from context (`summarizeForContext`) and the next reconciliation is told not to re-assert it.
 *
 * Retraction (39-living-memory §4.2): flagging a fact that had ALREADY been shared (broadcast `shareable` or
 * targeted `shareableWith`) **strips those shares** — `shareable` → false, `shareableWith` removed — and
 * stamps `retractedShareAt` so Memory can show "sharing withdrawn." Without this, a corrected claim keeps
 * feeding a related person's coach until the next read re-gate happens to drop it. Clearing the flag removes
 * the flag + retraction stamp but does NOT auto-restore the share (re-sharing is a deliberate user action).
 *
 * Returns the updated insight, or null if it's gone. The caller (bridge) scopes this to the person's OWN
 * insights — a person can only flag their own.
 */
export async function flagInsightFact(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  insightId: string,
  factId: string | null,
  flagged: boolean,
  now: Date,
): Promise<Insight | null> {
  const existing = await getInsight(fs, key, personId, insightId);
  if (!existing) return null;
  const at = now.toISOString();
  const facts = existing.facts.map((fact) => {
    if (factId !== null && fact.id !== factId) return fact;
    if (flagged) {
      const wasShared = fact.shareable || (fact.shareableWith?.length ?? 0) > 0;
      const next: InsightFact = { ...fact, flaggedInaccurate: true, flaggedAt: at };
      if (wasShared) {
        next.shareable = false; // retract the broadcast grant
        delete next.shareableWith; // retract every per-person grant
        next.retractedShareAt = at; // mark "sharing withdrawn" for Memory (only when there was a share)
      }
      return next;
    }
    // Clear: drop the flag + retraction fields entirely (exactOptionalPropertyTypes — never store `undefined`).
    // The share stays stripped — un-flagging never silently re-grants a withdrawn share.
    const cleared = { ...fact };
    delete cleared.flaggedInaccurate;
    delete cleared.flaggedAt;
    delete cleared.retractedShareAt;
    return cleared;
  });
  const updated: Insight = { ...existing, facts, updatedAt: at };
  await saveInsight(fs, key, updated);
  return updated;
}

/**
 * Reap orphaned per-person shares after a person is deleted (39-living-memory §4.5 / §1 C1). Scans EVERY
 * other person's insight facts and removes the deleted id from any `shareableWith` (dropping the array when
 * it empties), re-saving only touched insights. Pure file I/O, no AI. `updatedAt` is intentionally NOT
 * bumped — this is invisible maintenance and must not bubble an unrelated insight to the top of Memory.
 *
 * This is cleanup, NOT the trust boundary: the read-time re-gate (`listRelatedPeople` dropping a removed
 * relationship) already prevents any leak, so an interrupted reap can never expose data — it only removes
 * stale ids that would otherwise re-grant if a future person reused the id. Reads the `people/` dir directly
 * (the `listAllInsights` precedent) to avoid a people↔insights import cycle. Returns the count reaped.
 */
export async function reapOrphanShares(
  fs: FileSystem,
  key: Uint8Array,
  deletedPersonId: string,
): Promise<number> {
  let reaped = 0;
  for (const personId of await fs.list('people')) {
    if (personId === deletedPersonId) continue; // their folder is already gone
    for (const insight of await listInsightsForPerson(fs, key, personId)) {
      let touched = false;
      const facts = insight.facts.map((fact) => {
        if (!fact.shareableWith?.includes(deletedPersonId)) return fact;
        touched = true;
        reaped += 1;
        const remaining = fact.shareableWith.filter((id) => id !== deletedPersonId);
        const next = { ...fact };
        if (remaining.length > 0) next.shareableWith = remaining;
        else delete next.shareableWith;
        return next;
      });
      if (touched) await saveInsight(fs, key, { ...insight, facts });
    }
  }
  return reaped;
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
  // Dream gone but insight kept: since 20-memory-dashboard §3.7, deleting a dream KEEPS its insight (the
  // coach's lasting memory), so a missing dream means the insight persists and still feeds context — return
  // true. (The dreamer removes it deliberately from Memory if they don't want it.)
  if (raw === null) return true;
  const parsed = DreamSchema.safeParse(raw);
  // A present-but-malformed dream is treated as unreadable, NOT silently shared (15-shareability §7) — so
  // a deliberately-muted dream whose bytes corrupt can never leak its insight back into context.
  if (!parsed.success) return false;
  return parsed.data.informsContext !== false;
}

/** Filter a list of insights to those that may currently feed context (15-shareability §4.2). */
export async function feedableInsights(
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
 * Per-call relevance selection of the onboarding portrait's facts (28-portrait-synthesis-optimization
 * §pillar-2). The portrait is PINNED into EVERY Session/Dream/Questionnaire context, so injecting all its
 * facts every time is a fixed token tax + a diluted signal. `selectPortraitFacts` keeps an always-on CORE
 * (identity/goals/emotions/relationships/health + anything untagged) and adds the facts relevant to THIS
 * call's topic, bounded to a budget — so a budgeting chat sees Money/Work facts, an intimacy session sees
 * Intimacy facts, and a distress fact is never narrowed away.
 */
const PORTRAIT_FACT_CONTEXT_BUDGET = 45; // total portrait facts emitted into any single context (user: "fuller")
const PORTRAIT_CORE_FACT_BUDGET = 25; // of the budget, how many always-on CORE facts to guarantee first

/** The always-relevant identity life-areas — the "broader" set (user choice, 2026-06-21). Distress
 * (`Emotions & patterns`) is included so a crisis/struggle fact is NEVER narrowed away by topic selection.
 * Anything UNTAGGED is also treated as core (never hide an unclassified fact). */
const CORE_LIFE_AREAS: ReadonlySet<string> = new Set([
  'Values & beliefs',
  'Goals & growth',
  'Emotions & patterns',
  'Relationships',
  'Health & body',
]);

/**
 * Pick the portrait facts to feed THIS call (pure + exported + tested). `facts` must already be the live
 * (non-`flaggedInaccurate`) facts. Order is the fact array's order (the synthesis returns most-important
 * first), preserved in the output. Safety: a `crisisFlag` portrait is **never** topically narrowed (bounded
 * only); the always-on CORE (incl. distress) is taken first; untagged facts are core. Privacy is unaffected —
 * these are the subject's OWN facts; the caller applies all cross-person filters elsewhere.
 */
export function selectPortraitFacts(
  facts: InsightFact[],
  topic: ContextTopic | undefined,
  crisisFlag: boolean,
): InsightFact[] {
  // No life-area tags at all (a pre-28b portrait) — nothing to narrow by; just bound it.
  // A crisis-flagged portrait is also never topically narrowed (keep the full picture, bounded).
  if (crisisFlag || !facts.some((f) => f.lifeArea)) {
    return facts.slice(0, PORTRAIT_FACT_CONTEXT_BUDGET);
  }
  const topicAreas = new Set(topic?.lifeAreas ?? []);
  const isCore = (f: InsightFact): boolean => !f.lifeArea || CORE_LIFE_AREAS.has(f.lifeArea);
  const taken = new Set<string>();
  const take = (f: InsightFact): void => {
    if (taken.size < PORTRAIT_FACT_CONTEXT_BUDGET) taken.add(f.id);
  };
  // 0) SAFETY (CLAUDE.md §1): a struggle/distress fact must never be narrowed away by topic. Take EVERY
  //    `Emotions & patterns` fact first (bounded only by the overall budget, not the core budget), so a
  //    distress signal reaches the coach in any session — not just an emotional one.
  for (const f of facts) if (f.lifeArea === 'Emotions & patterns') take(f);
  // 1) the rest of the always-on core, up to the core budget (and the overall budget).
  let core = 0;
  for (const f of facts) {
    if (core >= PORTRAIT_CORE_FACT_BUDGET) break;
    if (isCore(f) && !taken.has(f.id)) {
      take(f);
      core += 1;
    }
  }
  // 2) facts relevant to this call's topic.
  for (const f of facts) if (f.lifeArea && topicAreas.has(f.lifeArea)) take(f);
  // 3) fill any remaining budget in importance order.
  for (const f of facts) take(f);
  // Emit in the original (importance) order.
  return facts.filter((f) => taken.has(f.id));
}

/**
 * A related person, as `summarizeForContext`/`listRelatedShareableInsights` need them (42 §5.2). The caller
 * resolves `grantedTypes` (how this related person relates to the VIEWER, via
 * `relationshipTypesFromSubjectToViewer`) + the related person's shared intake-answer lines — so the
 * insights module never imports `people`/`intake` (no cycle). Absent `grantedTypes` ⇒ no type grants (only
 * legacy broadcast / per-person sharing apply); absent `sharedAnswerLines` ⇒ no shared answers.
 */
export interface RelatedForContext {
  id: string;
  displayName: string;
  grantedTypes?: RelationshipType[];
  sharedAnswerLines?: string[];
}

/**
 * Build the Insight portion of a person's coaching context: their own **approved** insights (summary +
 * all facts — their private facts feed only their own coaching), plus the cross-shared facts + intake
 * answers from the people they relate to, gated by relationship-type scope (42-relationship-scoped-sharing
 * §5.2). Others' private/own-only items are never included — the shareable-vs-private split
 * (04-people-roles §3.4). When any cross-shared content is present it is prefixed with the confidentiality
 * preamble (42 §3.4) so the coach uses but never discloses it. Recency-prioritized + capped. Returns
 * formatted lines, or '' when there's nothing to add. `viewerName` names the supported person in the
 * confidentiality preamble.
 */
export async function summarizeForContext(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  related: RelatedForContext[],
  topic?: ContextTopic,
  viewerName?: string,
): Promise<string> {
  const lines: string[] = [];

  const feedable = await feedableInsights(
    fs,
    key,
    (await listInsightsForPerson(fs, key, personId)).filter((insight) => insight.approved),
  );
  // The onboarding portrait (`source: 'intake'`) is the foundational picture of the person — PIN it so it's
  // ALWAYS in context (and first), never aged out of the recency window by newer session/dream insights (§15).
  const intake = feedable.filter((insight) => insight.source === 'intake');
  const rest = feedable.filter((insight) => insight.source !== 'intake');
  const own = [...intake, ...rest].slice(0, MAX_OWN_INSIGHTS);
  if (own.length > 0) {
    lines.push('What you understand about them so far:');
    for (const insight of own) {
      // A fact the person flagged as inaccurate (20-memory-dashboard §3.6) is excluded from context
      // immediately — the coach stops using it at once, even before the next reconciliation.
      const liveFacts = insight.facts.filter((fact) => !fact.flaggedInaccurate);
      // A WHOLLY-flagged insight (had facts, all now flagged — e.g. the user flagged the whole insight) is
      // dropped entirely: its summary restates the corrected claim, so it must not reach the coach either.
      if (insight.facts.length > 0 && liveFacts.length === 0) continue;
      // A SENSITIVE non-portrait insight (a kink/sexuality self-assessment, 50-self-assessments §3.4): its
      // restricted facts are relevance-gated to an intimacy-topic context — gate the WHOLE insight (summary +
      // facts) so it informs an intimacy session but never leaks into a money chat. The PINNED intake portrait
      // is exempt (selectPortraitFacts narrows its facts, but the portrait is always present); a crisis-flagged
      // insight is never narrowed (safety). Existing non-intake insights carry no restricted facts → unaffected.
      if (insight.source !== 'intake' && !(insight.crisisFlag ?? false)) {
        // Fail-closed: if the insight has ANY restricted fact, it only feeds an on-topic context. A
        // restricted fact with no `lifeArea` contributes no matchable area, so an insight whose restricted
        // facts all lack a life-area matches nothing → is withheld entirely (never leaks its summary).
        const restricted = liveFacts.filter((fact) => fact.restricted);
        if (restricted.length > 0) {
          const topicAreas = new Set(topic?.lifeAreas ?? []);
          const matches = restricted.some(
            (fact) => fact.lifeArea !== undefined && topicAreas.has(fact.lifeArea),
          );
          if (!matches) continue;
        }
      }
      lines.push(`- ${insight.summary}`);
      // The PINNED onboarding portrait is large and feeds EVERY call — emit the facts relevant to THIS
      // call's topic, bounded to a budget (28-portrait-synthesis-optimization §pillar-2). Session/dream
      // insights are small, so they emit all their live facts as before. Selection is applied to the
      // subject's OWN facts here; it never touches the cross-person privacy filtering below.
      const emit =
        insight.source === 'intake'
          ? selectPortraitFacts(liveFacts, topic, insight.crisisFlag ?? false)
          : liveFacts;
      // Goal facts are surfaced to the coach via the structured "Open commitments" line, not here — drop them
      // from the own-insight emit so a person's goals aren't double-grounded (39 §4.4). (Cross-shared goal
      // facts to OTHER people, below, are unaffected — the dedup only concerns the subject's own goals.)
      for (const fact of emit) {
        if (fact.text.startsWith(GOAL_FACT_PREFIX)) continue;
        lines.push(`  · ${fact.text}`);
      }
    }
  }

  // Cross-shared content from related people (42 §5.2) — assembled first so the confidentiality preamble
  // (§3.4) can prefix the whole block once, and only when something actually crosses over.
  const crossSharedBlocks: string[] = [];
  for (const other of related) {
    const granted = other.grantedTypes ?? [];
    const otherApproved = await feedableInsights(
      fs,
      key,
      (await listInsightsForPerson(fs, key, other.id)).filter((insight) => insight.approved),
    );
    // A related person's fact reaches THIS person's context if `factSharedWithViewer` grants it: broadcast
    // `shareable`, per-person `shareableWith` (12-dreams §3.4), OR `shareableTypes` ∩ the subject→viewer
    // type(s) (42 §4.1). A `restricted` (18 §8.4) or flagged-inaccurate (20 §3.6) fact is NEVER shared —
    // the gate folds those exclusions in, so it can't leak into another's context.
    const sharedFacts = otherApproved
      .flatMap((insight) =>
        insight.facts.filter((fact) => factSharedWithViewer(fact, personId, granted)),
      )
      .slice(0, MAX_SHARED_FACTS_PER_PERSON);
    const blockLines: string[] = [];
    for (const fact of sharedFacts) blockLines.push(`- ${fact.text}`);
    // The related person's shared structured intake answers (42 §5.2), already resolved + capped by the caller.
    for (const line of other.sharedAnswerLines ?? []) blockLines.push(`- ${line}`);
    if (blockLines.length === 0) continue;
    crossSharedBlocks.push([`Shareable about ${other.displayName}:`, ...blockLines].join('\n'));
  }
  if (crossSharedBlocks.length > 0) {
    lines.push(confidentialityPreamble(viewerName ?? ''));
    lines.push(...crossSharedBlocks);
  }

  return lines.join('\n');
}

/**
 * The Memory dashboard's view of a viewer's RELATED people (20-memory-dashboard §5.1): each related
 * person's **approved** insights reduced to ONLY the facts shareable to the viewer — the exact
 * `summarizeForContext` boundary (broadcast-shareable OR targeted at the viewer; never `restricted`;
 * dream-muted insights excluded). The **summary is stripped** (`summary: ''`) because a related person's
 * summary is private to them (context never surfaces it either) — only their shareable facts cross over.
 * Insights left with no shareable fact are dropped. Re-gated on every read (via `listRelatedPeople` +
 * per-fact share state), so a removed relationship or un-shared fact disappears immediately — no stale
 * access. This is the structured sibling of `summarizeForContext`; they must stay in lockstep.
 *
 * `related` is passed in (the same shape `summarizeForContext` takes) so the insights module never imports
 * the people module — avoiding the people↔insights cycle (the bridge resolves `listRelatedPeople`).
 */
export async function listRelatedShareableInsights(
  fs: FileSystem,
  key: Uint8Array,
  viewerId: string,
  related: RelatedForContext[],
): Promise<Insight[]> {
  const out: Insight[] = [];
  for (const other of related) {
    const granted = other.grantedTypes ?? [];
    const approved = (await listInsightsForPerson(fs, key, other.id)).filter(
      (insight) => insight.approved,
    );
    for (const insight of await feedableInsights(fs, key, approved)) {
      // The exact `summarizeForContext` gate (42 §5.2): broadcast / per-person / type-scoped, never
      // restricted or flagged. Type-scoping uses the caller-resolved subject→viewer types.
      const shareableFacts = insight.facts.filter((fact) =>
        factSharedWithViewer(fact, viewerId, granted),
      );
      if (shareableFacts.length === 0) continue;
      // Project an EXPLICIT minimal shape — never spread the whole Insight. A related person's `metrics`
      // (private wellbeing signals), `crisisFlag` (their crisis state), precise `provenance`
      // (intakeSection/conversationId/dreamId — what they did), `relationshipId`, and a fact's
      // `shareableWith` (who ELSE it's shared with) must NOT cross over — only the shareable facts' text,
      // exactly like `summarizeForContext`. The summary stays stripped (private to them).
      out.push({
        id: insight.id,
        schemaVersion: insight.schemaVersion,
        source: insight.source,
        subjectPersonId: insight.subjectPersonId,
        summary: '',
        facts: shareableFacts.map((fact) => ({ id: fact.id, text: fact.text, shareable: true })),
        confidence: insight.confidence,
        // A related person's life-area tagging is theirs — don't expose it (keep the cross-over minimal).
        categories: [],
        approved: insight.approved,
        provenance: { at: insight.provenance.at },
        createdAt: insight.createdAt,
        updatedAt: insight.updatedAt,
      });
    }
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return out;
}

import { z } from 'zod';

import { INTIMACY_CATEGORIES, INTIMACY_CATEGORY_LABELS } from '../intimacy/topics';
import { LIFE_AREAS } from '../schemas';
import type { AskLedger, AskLedgerEntry, TopicStats } from './askLedger';
import { deriveTopicStats } from './askLedger';
import { jaccard, tokenSet } from './dedup';

/**
 * The **emergent per-person topic map** (spec 71 §5.3) — the vocabulary of ground SelfOS has explored with
 * one person, seeded from the built-in categories and then GROWN by the model as it names real ground.
 *
 * This replaces two hard-coded things at once:
 *
 * 1. `intimacy/coverage.ts`'s fixed 14 categories + hand-written `CATEGORY_KEYWORDS` regex. Measured on a
 *    real vault, that classifier credited **34.3%** of a person's intimacy questions to ZERO categories —
 *    including unambiguous content ("when Ben does take control during sex" → power exchange) — so a third of
 *    what had been asked was invisible to saturation and could be re-asked forever (spec 71 §1 D4).
 * 2. The fixed 9 general life areas, which could never name a strand the person's own material was actually
 *    about.
 *
 * Questions are now tagged **at write time** by the pass that wrote them (which knows exactly what it asked),
 * and any topic it names that doesn't exist yet is minted here — normalised and alias-merged so near-synonyms
 * ("dirty talk" / "verbal") can't fork into two half-counted topics. The built-in categories survive only as
 * SEED vocabulary, so day-one behaviour is no worse than before, never as a ceiling.
 *
 * PURE — no I/O, no AI, no crypto. Counts are DERIVED from the ask ledger rather than stored, so they can
 * never drift from what was actually asked.
 */

/** How many asks work a topic through before it is off-limits (carried over from the intimacy engine). */
export const SATURATION_ASKS = 3;

/**
 * The hard cooldown floor (spec 71 §5.2). A re-opened topic still cannot be asked again within this window,
 * whatever signal re-opened it. This is the guard that stops the mechanism silently going inert the way the
 * old `new-material` signal did — no signal can override it.
 */
export const COOLDOWN_DAYS = 14;

/** A saturated topic may be revisited from a fresh angle after this long untouched. */
export const DORMANT_DAYS = 90;

/**
 * How long a topic-level "Leave alone" holds before it lapses (spec 71 §5.8, owner decision 2026-08-12).
 *
 * Lives here rather than beside the other feedback constants: `personalizationProfile` already imports this
 * module for `TopicSchema`, so declaring it there and importing it back would form a cycle — the trap this
 * package is careful about elsewhere.
 */
export const LEAVE_ALONE_COOLDOWN_DAYS = 90;

/** Quality saturation (spec 71 §5.4): this many dead answers, at this rate, closes a topic on quality alone. */
export const QUALITY_DEAD_ASKS = 3;
const QUALITY_DEAD_RATE = 0.6;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Merge a proposed topic into an existing one when their labels are this similar. */
const ALIAS_MATCH_THRESHOLD = 0.6;

/**
 * How many questions must sit under an emergent name before it counts as real ground (spec 71 §5.9).
 *
 * The classifier sees one question at a time, so it cannot know what recurs — asked to name the ground under
 * each question it will name each question. Tightening the prompt helped and did not solve it: a real map
 * still had 165 emergent topics backing exactly one question ("Reflex response", "Inner blankness", "What she
 * sought"). Those are descriptions, not areas of a life.
 *
 * So the DATA decides, not the prompt: a name has to be arrived at independently more than once to stick.
 * Below the threshold the question keeps its family tag — nothing is lost for saturation or de-dup, the map
 * just doesn't grow a row for it — and a name that genuinely recurs is promoted on the next pass.
 */
export const MIN_TOPIC_SUPPORT = 2;

/**
 * The catch-all seed bucket. Real ground for everything that doesn't fit a named life area, so it must stay in
 * the map and keep collecting asks — but it is useless as STEERING: "prefer Other" and "don't build around
 * Other" both tell the model nothing. Filtered out of the ground summaries for that reason only; emergent
 * topics parented to it keep their own real labels and still surface.
 */
export const CATCH_ALL_TOPIC_ID = 'Other';

export const TopicSchema = z.object({
  /** Stable slug — the ledger's `topicIds` reference this. */
  topicId: z.string().min(1),
  label: z.string().min(1),
  /** The parent bucket, one of `LIFE_AREAS` — drives the type-scoping in §5.5. */
  lifeArea: z.string(),
  /** True for the built-in seed vocabulary; false for anything the model named. */
  seeded: z.boolean().catch(false).default(false),
  /** Labels that fold into this topic, so a near-synonym can't fork the count. */
  aliases: z.array(z.string()).catch([]).default([]),
  /** The built-in family this specific ground belongs to (§5.3). Set when the topic was minted alongside a
   *  roll-up tag; absent on the seeded families themselves. A child INHERITS its family's closure, so a
   *  worked-through family can't be re-opened through one of its own narrower names. */
  parentTopicId: z.string().optional(),
});
export type Topic = z.infer<typeof TopicSchema>;

/** Normalize a free-text topic label into a stable slug. */
export function slugTopic(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * The seed vocabulary: one topic per general life area, plus one per built-in intimacy category. Topic ids
 * match the shape the Explored tab already renders (`Work & purpose`, `Intimacy:oral`), so seeding is
 * continuous with the existing surface rather than a visible reset.
 */
export function seedTopics(): Topic[] {
  const general = LIFE_AREAS.filter((a) => a !== 'Intimacy').map((area) => ({
    topicId: area,
    label: area,
    lifeArea: area,
    seeded: true,
    aliases: [],
  }));
  const intimacy = INTIMACY_CATEGORIES.map((c) => ({
    topicId: `Intimacy:${c}`,
    label: INTIMACY_CATEGORY_LABELS[c],
    lifeArea: 'Intimacy',
    seeded: true,
    aliases: [],
  }));
  return [...general, ...intimacy];
}

/** The person's map, seeded when they have none yet. */
export function ensureTopics(topics: readonly Topic[] | undefined): Topic[] {
  return topics && topics.length > 0 ? [...topics] : seedTopics();
}

/**
 * The built-in category labels a question must ALSO be filed under (spec 71 §5.3, the roll-up tag).
 *
 * Why this exists: the emergent vocabulary is far more accurate per question, but left alone it FRAGMENTS a
 * family across names that no text comparison can relate. Measured on a real vault after the first backfill:
 * threesome ground had been worked **13 times** across five topics — "Threesomes", "Threesome dynamics",
 * "FFM threesome", "Finding a third / apps" — while the built-in `Group & swinging` showed **0 asks and read
 * as OPEN**. Bondage was 13 asks across two names; `Edge play` read as untouched after five.
 *
 * So every question carries two tags: its SPECIFIC ground (precision, and the thing worth showing a person)
 * and its closest built-in category (the roll-up that makes the family saturate). `deriveTopicStats` credits
 * both, so neither goal is traded for the other.
 */
export function rollUpCategoryLabels(lifeAreas?: readonly string[]): string[] {
  const wanted = lifeAreas ? new Set(lifeAreas) : null;
  return seedTopics()
    .filter((t) => !wanted || wanted.has(t.lifeArea))
    .map((t) => t.label);
}

/**
 * Singularize a token so a plural can't fork a topic (`threesomes` → `threesome`).
 *
 * Measured on a real vault: "Threesomes", "Threesome dynamics" and "FFM threesome" all failed to resolve to
 * each other purely on the trailing `s`, contributing to 13 asks spread across five names. Deliberately naive
 * — this compares short hand-written topic labels, not prose, so the classic over-stemming failures don't
 * arise, and an occasional miss only leaves a topic un-merged (recoverable), never merges two unrelated ones.
 */
function singular(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('ses')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/** A label's comparison tokens — content words, singularized. Local to topic labels (never prompt text). */
function labelTokens(label: string): Set<string> {
  return new Set([...tokenSet(label)].map(singular));
}

/**
 * Resolve a model-proposed topic to an EXISTING topic id, or `null` when it is genuinely new.
 *
 * Matching order: exact id → alias → normalised-label equality → singularized token similarity. The
 * similarity step is what stops "dirty talk" and "talking dirty / verbal" becoming two topics that each look
 * under-explored.
 *
 * NOTE this is only half the anti-fragmentation story, and cannot be the whole of it: "Threesomes" and
 * "Group & swinging" name the same ground while sharing no words at all, so no text comparison will ever
 * relate them. That is why every question is ALSO tagged with its closest built-in category (§5.3) — the
 * roll-up tag is what makes a family saturate; this only stops near-identical labels forking.
 */
export function resolveTopicId(proposed: string, topics: readonly Topic[]): string | null {
  const raw = proposed.trim();
  if (raw === '') return null;
  const slug = slugTopic(raw);
  const lower = raw.toLowerCase();
  for (const t of topics) {
    if (t.topicId === raw || slugTopic(t.topicId) === slug) return t.topicId;
    if (t.label.toLowerCase() === lower) return t.topicId;
    if (t.aliases.some((a) => a.toLowerCase() === lower || slugTopic(a) === slug)) return t.topicId;
  }
  const proposedTokens = labelTokens(raw);
  for (const t of topics) {
    if (jaccard(proposedTokens, labelTokens(t.label)) >= ALIAS_MATCH_THRESHOLD) return t.topicId;
  }
  return null;
}

/** A topic the model named while writing or classifying a question. */
export interface TopicProposal {
  label: string;
  /** The parent bucket. Anything outside `LIFE_AREAS` falls back to `Other`. */
  lifeArea?: string;
  /** The built-in family this belongs to, when known (§5.3) — recorded so closure can be inherited. */
  parentTopicId?: string;
}

/**
 * Fold proposals into the map (pure): resolve each to an existing topic where possible, mint the rest, and
 * record the proposed label as an alias so the same wording resolves directly next time.
 *
 * Returns the updated map plus the resolved id for each proposal, IN ORDER, so the caller can tag its ledger
 * entries with real ids.
 */
export function mintTopics(
  topics: readonly Topic[],
  proposals: readonly TopicProposal[],
): { topics: Topic[]; resolved: string[] } {
  const out = ensureTopics(topics);
  const resolved: string[] = [];
  for (const p of proposals) {
    const label = p.label.trim();
    if (label === '') continue;
    const hit = resolveTopicId(label, out);
    if (hit) {
      resolved.push(hit);
      const idx = out.findIndex((t) => t.topicId === hit);
      const t = out[idx];
      if (t) {
        // Remember the wording that resolved here, so the next identical proposal is an O(1) alias hit.
        const aliases =
          t.label.toLowerCase() !== label.toLowerCase() && !t.aliases.includes(label)
            ? [...t.aliases, label]
            : t.aliases;
        // Adopt the family on an EXISTING topic that has none. Without this, closure inheritance only ever
        // reaches topics minted in the same run — so a map built before the roll-up existed keeps its orphans
        // open forever, which is exactly what a re-tag is supposed to repair. Never overwrites a known parent,
        // and never makes a topic its own parent.
        const parentTopicId =
          t.parentTopicId ??
          (p.parentTopicId && p.parentTopicId !== hit ? p.parentTopicId : undefined);
        out[idx] = {
          ...t,
          aliases,
          ...(parentTopicId ? { parentTopicId } : {}),
        };
      }
      continue;
    }
    const lifeArea =
      p.lifeArea && (LIFE_AREAS as readonly string[]).includes(p.lifeArea) ? p.lifeArea : 'Other';
    const topicId = slugTopic(`${lifeArea}-${label}`) || slugTopic(label);
    if (topicId === '') continue;
    out.push({
      topicId,
      label,
      lifeArea,
      seeded: false,
      aliases: [],
      ...(p.parentTopicId ? { parentTopicId: p.parentTopicId } : {}),
    });
    resolved.push(topicId);
  }
  return { topics: out, resolved };
}

/**
 * Garbage-collect the topic map against the ledger (spec 71 §5.9).
 *
 * An emergent vocabulary only stays useful if something prunes it. Two things grow it without bound:
 *
 * - **Re-tagging orphans the old names.** Each pass mints labels for what it sees; names the previous pass
 *   invented are simply left behind, referenced by nothing. Measured on a real map after three re-tags: 341
 *   topics for 277 questions, 11 of them referenced by zero ledger entries.
 * - **The same ground gets named twice across runs.** `mintTopics` resolves against the map as it stands, so
 *   two passes can independently coin near-identical labels that never meet.
 *
 * Both are repaired here: drop every non-seeded topic with no ledger reference, then fold near-duplicate
 * emergent topics into the one with the most asks (rewriting the ledger's `topicIds` so no count is lost).
 * SEEDED families are never dropped — they are the roll-up vocabulary and must exist even at zero asks.
 *
 * Pure: returns the tidied map plus the rewritten entries; the caller persists both.
 */
export function pruneTopicMap(
  topics: readonly Topic[],
  ledger: AskLedger,
): { topics: Topic[]; entries: AskLedgerEntry[]; dropped: number; merged: number } {
  const all = ensureTopics(topics);
  const counts = deriveTopicStats(ledger);
  const askedOf = (id: string): number => counts.get(id)?.askedCount ?? 0;

  // ── merge near-duplicates, richest first so the surviving name is the best-attested one ──
  const emergent = all
    .filter((t) => !t.seeded)
    .sort((a, b) => askedOf(b.topicId) - askedOf(a.topicId));
  const remap = new Map<string, string>();
  const kept: Topic[] = all.filter((t) => t.seeded);
  for (const t of emergent) {
    // Resolve against what has survived so far — never against itself.
    const hit = resolveTopicId(t.label, kept);
    if (hit && hit !== t.topicId) {
      remap.set(t.topicId, hit);
      continue;
    }
    kept.push(t);
  }

  // ── rewrite the ledger through the merge map, then find what nothing references ──
  const entries = ledger.entries.map((e) => {
    const ids = [...new Set(e.topicIds.map((id) => remap.get(id) ?? id))];
    return ids.length === e.topicIds.length && ids.every((id, i) => id === e.topicIds[i])
      ? e
      : { ...e, topicIds: ids };
  });
  // Support = how many questions ended up under each name once merges are applied.
  const support = new Map<string, number>();
  for (const e of entries) for (const id of e.topicIds) support.set(id, (support.get(id) ?? 0) + 1);
  const survivors = kept.filter(
    (t) => t.seeded || (support.get(t.topicId) ?? 0) >= MIN_TOPIC_SUPPORT,
  );
  const surviving = new Set(survivors.map((t) => t.topicId));
  // Strip dropped names from the ledger. Their family tag remains, so the ask still counts toward
  // saturation and de-dup — only the map row goes away.
  const finalEntries = entries.map((e) => {
    const ids = e.topicIds.filter((id) => surviving.has(id));
    return ids.length === e.topicIds.length ? e : { ...e, topicIds: ids };
  });

  return {
    topics: survivors,
    entries: finalEntries,
    dropped: kept.length - survivors.length,
    merged: remap.size,
  };
}

/** A piece of the person's own material — an insight, reflection or answer — with when it landed. */
export interface TopicMaterial {
  at: string;
  /** The material's own words (an insight summary + its facts). Matched against topic labels. */
  text: string;
}

/**
 * Which topics have genuinely NEW material behind them (spec 71 §5.2) — the topic-SCOPED re-open signal.
 *
 * A topic re-opens when the person has since revealed something about THAT ground: a session, dream, test or
 * reflection whose own words name it, dated after the last time it was asked about. Deterministic and free —
 * it reuses the same label matching that resolves topics, so no classification pass is needed.
 *
 * This is deliberately narrow. Its predecessor took the newest own-subject Insight of ANY kind and re-opened
 * EVERY intimacy category, which is why a real vault showed nine categories past the threshold reporting
 * `saturated: []` (§1 D3). Material about work must not re-open questions about sex. The cooldown floor still
 * applies on top, so re-opening can never cause an immediate re-ask.
 */
export function topicsWithNewMaterial(
  material: readonly TopicMaterial[],
  topics: readonly Topic[],
  ledger: AskLedger,
): string[] {
  if (material.length === 0) return [];
  const stats = deriveTopicStats(ledger);
  const all = ensureTopics(topics);
  const out = new Set<string>();
  for (const item of material) {
    const text = item.text.trim();
    if (text === '' || !item.at) continue;
    const tokens = new Set([...tokenSet(text)].map(singular));
    for (const topic of all) {
      if (out.has(topic.topicId)) continue;
      // Only material NEWER than the last ask on this ground counts — otherwise the very answers a topic
      // produced would re-open it, and it could never saturate at all.
      const lastAskedAt = stats.get(topic.topicId)?.lastAskedAt;
      if (lastAskedAt && item.at <= lastAskedAt) continue;
      const label = labelTokens(topic.label);
      if (label.size === 0) continue;
      // Every content word of the topic's name appears in the material — a conservative mention test that
      // won't fire on a single shared word ("play", "body") the way a similarity score would.
      let mentioned = true;
      for (const t of label)
        if (!tokens.has(t)) {
          mentioned = false;
          break;
        }
      if (mentioned) out.add(topic.topicId);
    }
  }
  return [...out];
}

/** Why a worked-through topic became askable again (spec 71 §5.2). */
export type ReopenSignal = 'new-material' | 'explicit-request' | 'dormant';

export interface TopicStatus {
  topic: Topic;
  stats: TopicStats;
  /** Closed because the person asked to leave it alone, and that steer hasn't lapsed yet (§5.8). */
  leftAlone: boolean;
  /** Worked through and not re-opened — off-limits. */
  saturated: boolean;
  /** Closed because its recent answers were mostly skips/declines, regardless of count (§5.4). */
  saturatedByQuality: boolean;
  reopenedBy?: ReopenSignal;
  /**
   * True while inside the hard cooldown floor. Independent of `saturated`: even a re-opened topic is not
   * askable until this clears, which is what makes the mechanism impossible to silently disable.
   */
  inCooldown: boolean;
  /** Askable this round: not saturated, not cooling down. */
  open: boolean;
}

export interface TopicStatusInput {
  topics: readonly Topic[];
  ledger: AskLedger;
  /**
   * Topic ids touched by genuinely NEW material (an insight/answer about this ground). Topic-SCOPED on
   * purpose: the old engine re-opened every intimacy category on any insight from any life area, which is why
   * nine saturated categories reported `saturated: []` on a real vault (spec 71 §1 D3).
   */
  newMaterialTopicIds?: readonly string[];
  /** Topics the person or author explicitly asked to explore — always re-opens (but still respects cooldown). */
  requestedTopicIds?: readonly string[];
  /** Topics the person has asked to leave alone, with when (spec 71 §5.8). A bounded steer, not a ban: it
   *  closes the topic for `LEAVE_ALONE_COOLDOWN_DAYS` and then lapses on its own. */
  leftAlone?: readonly { topicId: string; at: string }[];
  now: Date;
}

/** Classify every topic in the map (pure + total). */
export function topicStatuses(input: TopicStatusInput): TopicStatus[] {
  const stats = deriveTopicStats(input.ledger);
  const fresh = new Set(input.newMaterialTopicIds ?? []);
  const requested = new Set(input.requestedTopicIds ?? []);
  // "Leave alone" holds for a bounded window, then lapses — the person said "not right now", not "never".
  const leftAloneCutoff = new Date(
    input.now.getTime() - LEAVE_ALONE_COOLDOWN_DAYS * DAY_MS,
  ).toISOString();
  const leftAlone = new Set(
    (input.leftAlone ?? []).filter((l) => l.at >= leftAloneCutoff).map((l) => l.topicId),
  );
  const all = ensureTopics(input.topics);
  // A family's closure is computed first, so a child can inherit it below.
  const familyClosed = new Set<string>();
  for (const t of all) {
    const s = stats.get(t.topicId);
    if (!s) continue;
    if (s.askedCount >= SATURATION_ASKS) familyClosed.add(t.topicId);
  }
  return all.map((topic) => {
    const s = stats.get(topic.topicId) ?? { askedCount: 0, richCount: 0, deadCount: 0 };
    const saturatedByCount = s.askedCount >= SATURATION_ASKS;
    const saturatedByQuality =
      s.deadCount >= QUALITY_DEAD_ASKS &&
      s.deadCount / Math.max(1, s.askedCount) >= QUALITY_DEAD_RATE;

    let reopenedBy: ReopenSignal | undefined;
    if (saturatedByCount && !saturatedByQuality) {
      // Quality saturation is NOT re-openable by new material: the person has repeatedly declined to engage
      // here, so "there's fresh material" is not a reason to push again.
      if (requested.has(topic.topicId)) reopenedBy = 'explicit-request';
      else if (fresh.has(topic.topicId)) reopenedBy = 'new-material';
      else if (s.lastAskedAt) {
        const t = Date.parse(s.lastAskedAt);
        if (!Number.isNaN(t) && input.now.getTime() - t >= DORMANT_DAYS * DAY_MS) {
          reopenedBy = 'dormant';
        }
      }
    }

    let inCooldown = false;
    if (s.lastAskedAt) {
      const t = Date.parse(s.lastAskedAt);
      inCooldown = !Number.isNaN(t) && input.now.getTime() - t < COOLDOWN_DAYS * DAY_MS;
    }
    // Inherit the family's closure (§5.3). Without this the roll-up only half works: measured on a real
    // vault, `Group & swinging` correctly closed at 8 asks while its own narrower name "Threesomes" still
    // read as OPEN at 2 — so the planner could re-open, through a child, exactly the ground the roll-up had
    // just shut. A child is never MORE open than the family it belongs to.
    // ...but ONLY once the child has asks of its OWN. A child with zero is ground the planner has just NAMED
    // and nobody has been asked about yet — inheriting closure there mints emergent vocabulary dead on
    // arrival, which is exactly backwards for a person who has exhausted the built-in areas and now depends on
    // it. Measured on a real vault: a draft named "Aftercare" and "The ask itself", both landed under
    // worked-through families, and both were born `saturated` at 0 asks. The Threesomes case this rule exists
    // for is unaffected — it had 2 asks of its own, so it still inherits.
    const parentClosed =
      topic.parentTopicId !== undefined &&
      topic.parentTopicId !== topic.topicId &&
      familyClosed.has(topic.parentTopicId) &&
      s.askedCount > 0 &&
      !requested.has(topic.topicId);
    // An explicit "explore more" overrides a standing "leave alone" — the person is changing their mind.
    const steeredAway = leftAlone.has(topic.topicId) && !requested.has(topic.topicId);
    const saturated =
      (saturatedByCount && reopenedBy === undefined) ||
      saturatedByQuality ||
      parentClosed ||
      steeredAway;
    // The cooldown floor gates RE-OPENING worked ground — it must NOT close ground that still has headroom.
    // Verified against a real vault: applying it to every recently-touched topic left 1 of 14 areas open and
    // shut the two LEAST-worked ones (asked once and twice), which would push the planner to invent new ground
    // while obvious ground sat unused. Only a topic that has reached the ask threshold is held by the floor.
    const heldByCooldown = saturatedByCount && inCooldown;
    return {
      topic,
      stats: s,
      saturated,
      saturatedByQuality,
      leftAlone: steeredAway,
      ...(reopenedBy !== undefined ? { reopenedBy } : {}),
      inCooldown,
      open: !saturated && !heldByCooldown,
    };
  });
}

/**
 * The "where this person has and hasn't been explored" steering block, built from REAL ask counts.
 *
 * This replaces `coverageModel.buildCoverageGuidance` for the paths that still want broad novelty pressure
 * without a planner (the self-directed email suggestion, spec 67). It is scoped by the CALLER — passing a
 * type's life areas is what stops it doing what the old block did on a typed draft (spec 71 §1 D2).
 */
export function buildTopicSteering(statuses: readonly TopicStatus[]): string {
  const fresh = statuses
    .filter((s) => s.open && s.stats.askedCount === 0)
    .map((s) => `- ${s.topic.label}`);
  const worked = statuses.filter((s) => !s.open).map((s) => `- ${s.topic.label}`);
  const sections: string[] = [];
  if (fresh.length) {
    sections.push(`NEW / UNEXPLORED GROUND — lead here:\n${fresh.slice(0, 12).join('\n')}`);
  }
  if (worked.length) {
    sections.push(
      `Already worked through or cooling down — leave these alone:\n${worked.slice(0, 12).join('\n')}`,
    );
  }
  return sections.length
    ? `WHERE THIS PERSON HAS AND HASN'T BEEN EXPLORED:\n${sections.join('\n\n')}`
    : '';
}

/**
 * The de-dup reference, built from gists + per-topic counts (spec 71 §5.1).
 *
 * The whole point: the same history at roughly a tenth the tokens. A person with 272 asks previously
 * contributed 74,417 chars of raw prompts, of which a 2,000-char cap kept ~8; here each worked topic costs
 * one line ("Dirty talk & verbal — asked 8×, last 2026-08-02") and each recent ask one short gist.
 */
export function buildLedgerReference(
  statuses: readonly TopicStatus[],
  ledger: AskLedger,
  opts: { recentGists?: number } = {},
): string {
  const worked = statuses
    .filter((s) => s.stats.askedCount > 0)
    .sort((a, b) => b.stats.askedCount - a.stats.askedCount)
    .map((s) => {
      const last = s.stats.lastAskedAt ? `, last ${s.stats.lastAskedAt.slice(0, 10)}` : '';
      const dead = s.stats.deadCount > 0 ? `, ${s.stats.deadCount} skipped/declined` : '';
      return `- ${s.topic.label} — asked ${s.stats.askedCount}×${last}${dead}`;
    });
  const gists = ledger.entries
    .filter((e) => e.gist.trim() !== '')
    .slice(-(opts.recentGists ?? 60))
    .map((e) => `- ${e.gist.trim()}`);
  const sections: string[] = [];
  if (worked.length) {
    sections.push(
      `GROUND ALREADY WORKED WITH THIS PERSON (never re-ask these):\n${worked.join('\n')}`,
    );
  }
  if (gists.length) {
    sections.push(
      `SPECIFICALLY ALREADY ASKED (most recent first is not implied — do not repeat any):\n${gists.join('\n')}`,
    );
  }
  return sections.join('\n\n');
}

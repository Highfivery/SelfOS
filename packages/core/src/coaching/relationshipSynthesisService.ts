import { classifyParseOutcome, extractJsonObject } from '../ai/jsonSalvage';
import type { ClaudeClient, FileSystem } from '../host';
import { uuid } from '../id';
import { z } from 'zod';
import {
  RelationshipSynthesisSchema,
  factSharedWithViewer,
  type Insight,
  type RelationshipSynthesis,
  type RelationshipSynthesisResult,
  type RelationshipType,
  type UsageEvent,
} from '../schemas';
import { checkBudget, costOf, queryUsage, recordUsage } from '../usage';
import { PERSONA, SAFETY } from '../conversations/promptBuilder';
import {
  GOAL_FACT_PREFIX,
  digestableInsights,
  feedableInsights,
  listInsightsForPerson,
} from '../insights';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

/**
 * The **relationship-insights** synthesis (54-memory-redesign §5) — the AI pass behind Memory's "Relationships"
 * cards. It reads the VIEWER's own bounded insight digest + what the PARTNER has chosen to SHARE (resolved
 * through the same `factSharedWithViewer` gate as context — never the partner's raw answers, never `restricted`
 * /flagged facts), and produces a few gentle observations about the viewer and the relationship dynamic.
 *
 * Privacy (§8): the OUTPUT is about the viewer + the dynamic — it must never quote or attribute the partner's
 * raw shared answers (enforced in the prompt). Cached per (viewer, partner), view-only; NOT promoted into
 * `summarizeForContext`. Explicit-tap (no auto-cadence in v1). Budget-gated, weekly-capped, metered BEFORE
 * parse (a paid call whose JSON fails is still billed), tolerant parse + honest reasons (spec 37).
 */

const SCHEMA_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const MAX_OWN_INSIGHTS = 12;
const MAX_SHARED_FACTS = 8;
/** A weekly cap on this explicit-tap pass — far above genuine use; only stops runaway spend. Owner override bypasses. */
const WEEKLY_CAP = 7;
/** Below this many total signals (own insights + the partner's shared facts) there isn't enough to say. */
const MIN_SIGNALS = 2;

const synthesisPath = (viewerId: string, partnerId: string): string =>
  `people/${viewerId}/relationships/${partnerId}/synthesis.enc`;

/** Read the cached relationship synthesis for (viewer → partner); null if absent or mismatched. */
export async function getRelationshipSynthesis(
  fs: FileSystem,
  key: Uint8Array,
  viewerPersonId: string,
  partnerPersonId: string,
): Promise<RelationshipSynthesis | null> {
  const raw = await readEncryptedJson(fs, synthesisPath(viewerPersonId, partnerPersonId), key);
  if (!raw) return null;
  const parsed = RelationshipSynthesisSchema.safeParse(raw);
  return parsed.success &&
    parsed.data.subjectPersonId === viewerPersonId &&
    parsed.data.partnerPersonId === partnerPersonId
    ? parsed.data
    : null;
}

/** The viewer's own approved insights within the recency window (undated kept), bounded. */
function recentApprovedInsights(insights: Insight[], now: Date): Insight[] {
  const horizon = now.getTime() - WINDOW_DAYS * DAY_MS;
  return insights
    .filter((i) => i.approved)
    .filter((i) => {
      const t = new Date(i.provenance.at).getTime();
      return !Number.isFinite(t) || t >= horizon;
    })
    .slice(0, MAX_OWN_INSIGHTS);
}

/** The viewer's own structured digest (summaries + non-restricted/non-flagged facts, goal facts dropped). */
function ownDigest(recent: Insight[]): string {
  return digestableInsights(recent)
    .map((i) => {
      const facts = i.facts
        .filter(
          (f) => !f.restricted && !f.flaggedInaccurate && !f.text.startsWith(GOAL_FACT_PREFIX),
        )
        .map((f) => f.text)
        .slice(0, 4)
        .join('; ');
      return `- "${i.summary}"${facts ? ` — ${facts}` : ''}`;
    })
    .join('\n');
}

const GUIDANCE = `You are gently helping ONE person understand their relationship with their partner. You are \
given (1) what this person understands about THEMSELVES, and (2) the things their partner has CHOSEN TO SHARE \
with this person's coach. Offer 2–4 short, warm observations about THIS PERSON and the DYNAMIC between them — \
how they fit, where they differ, a pattern worth noticing together. These are invitations to reflect, NOT \
findings, diagnoses, or assessments.

Hard rules: write in plain second-person ("you tend to…", "you and {name}…"). NEVER quote, attribute, or list \
the partner's raw shared answers back — SYNTHESISE them into insight about the relationship. Be balanced and \
kind, never take sides, never alarm. If there genuinely isn't enough to say something honest, return fewer (or \
an empty list) rather than inventing a pattern. If anything suggests crisis or harm, encourage reaching out to \
real support instead.

Respond with ONLY a JSON object: {"observations": string[] (2–4 short observations, each 1–2 sentences)}.`;

const DraftSchema = z.object({
  observations: z.array(z.string()).catch([]).default([]),
});

function buildUsage(
  model: string,
  personId: string,
  at: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  },
): UsageEvent {
  return {
    id: uuid(),
    schemaVersion: 1,
    type: 'relationship.synthesize',
    personId,
    model,
    at,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheReadTokens: usage.cacheReadTokens,
    costUsd: costOf(model, usage),
  };
}

export interface RelationshipSynthesizeDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  /** The viewer (whose Memory this is). */
  viewerPersonId: string;
  /** The partner this synthesis is about. */
  partnerPersonId: string;
  /** The partner's display name (for the prompt). */
  partnerName: string;
  /** How the viewer relates to the partner (resolved by the caller, e.g. ['partner']) — the share grant. */
  grantedTypes: RelationshipType[];
  now: Date;
  override?: boolean;
}

/**
 * Run the relationship synthesis: gather the viewer's own digest + the partner's shared facts → budget + weekly
 * cap → one Claude call → meter (BEFORE parse) → tolerant parse → cache the `RelationshipSynthesis`. Explicit-tap.
 */
export async function synthesizeRelationship(
  deps: RelationshipSynthesizeDeps,
): Promise<RelationshipSynthesisResult> {
  const {
    fs,
    key,
    client,
    apiKey,
    model,
    viewerPersonId,
    partnerPersonId,
    partnerName,
    grantedTypes,
    now,
  } = deps;
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };

  // The viewer's OWN recent insights (behind the context-feed boundary — muted/flagged dropped).
  const own = recentApprovedInsights(
    await feedableInsights(fs, key, await listInsightsForPerson(fs, key, viewerPersonId)),
    now,
  );
  // The partner's SHARED facts — exactly what the gate would feed the viewer's context (never raw-displayed,
  // never restricted/flagged). Goal facts are coach-structured elsewhere → dropped here.
  const partnerInsights = await feedableInsights(
    fs,
    key,
    (await listInsightsForPerson(fs, key, partnerPersonId)).filter((i) => i.approved),
  );
  const sharedFacts = partnerInsights
    .flatMap((i) => i.facts.filter((f) => factSharedWithViewer(f, viewerPersonId, grantedTypes)))
    .filter((f) => !f.text.startsWith(GOAL_FACT_PREFIX))
    .map((f) => f.text)
    .slice(0, MAX_SHARED_FACTS);

  if (own.length + sharedFacts.length < MIN_SIGNALS) {
    return {
      ok: false,
      reason: 'EMPTY',
      message: `There isn’t enough yet to reflect on your relationship with ${partnerName}.`,
    };
  }

  const person = await checkBudget(fs, key, {
    scope: 'person',
    personId: viewerPersonId,
    now,
    override: deps.override,
  });
  const app = await checkBudget(fs, key, { scope: 'app', now, override: deps.override });
  if (person.state === 'over' || app.state === 'over') {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }

  if (!deps.override) {
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
    const passes = await queryUsage(fs, key, {
      from: weekAgo,
      to: now.toISOString(),
      personId: viewerPersonId,
      type: 'relationship.synthesize',
    });
    if (passes.length >= WEEKLY_CAP) {
      return {
        ok: false,
        reason: 'CAPPED',
        message:
          'You’ve refreshed relationship insights plenty this week — check back in a few days.',
      };
    }
  }

  const digest = [
    `This person and their partner ${partnerName}.`,
    own.length ? `What this person understands about themselves:\n${ownDigest(own)}` : '',
    sharedFacts.length
      ? `What ${partnerName} has chosen to share (synthesise — never quote back):\n${sharedFacts
          .map((t) => `- ${t}`)
          .join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const at = now.toISOString();

  let result;
  try {
    result = await client.stream(
      {
        apiKey,
        model,
        system: [PERSONA, SAFETY, GUIDANCE].join('\n\n'),
        messages: [{ role: 'user', content: digest }],
        maxTokens: 700,
        extendedThinking: false,
      },
      () => {},
    );
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The relationship insights couldn’t be written. Please try again.',
    };
  }

  // Meter BEFORE parse (spec 06 / spec 37).
  await recordUsage(fs, key, buildUsage(model, viewerPersonId, at, result.usage));

  const obj = extractJsonObject(result.text);
  const parsed = obj ? DraftSchema.safeParse(obj) : null;
  const observations = (parsed?.success ? parsed.data.observations : [])
    .map((o) => o.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (observations.length === 0) {
    const { reason, message } = classifyParseOutcome(result.text, 'observations');
    return { ok: false, reason, message };
  }

  const synthesis: RelationshipSynthesis = {
    schemaVersion: SCHEMA_VERSION,
    subjectPersonId: viewerPersonId,
    partnerPersonId,
    observations,
    computedAt: at,
  };
  await writeEncryptedJson(fs, synthesisPath(viewerPersonId, partnerPersonId), synthesis, key);
  return { ok: true, synthesis };
}

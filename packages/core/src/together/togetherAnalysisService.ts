import { z } from 'zod';
import {
  classifyParseFailure,
  classifyParseOutcome,
  extractJsonObject,
  salvageJsonObjectField,
  tolerantArray,
} from '../ai/jsonSalvage';
import type { ClaudeClient, FileSystem } from '../host';
import { uuid } from '../id';
import {
  type Insight,
  type InsightFact,
  type SharedReport,
  type TogetherSession,
  type UsageEvent,
} from '../schemas';
import { getPerson } from '../people';
import { checkBudget, costOf, recordUsage } from '../usage';
import { deleteInsight, listInsightsForPerson, producedFactShare, saveInsight } from '../insights';
import { PERSONA, SAFETY } from '../conversations/promptBuilder';
import { getSession, listMessages } from './togetherService';
import {
  getReport,
  listAgreements,
  normalizeAgreementText,
  saveAgreement,
  saveReport,
} from './agreementService';

// ── Together wrap-up (58 §3.8) — a sibling of `endAndSummarize` (09 §5), never a change to it ────────
// One metered `together.analyze` pass (initiator-billed, extendedThinking:false) over the MUTUALLY-VISIBLE
// transcript only — every `privateAside` message (and its attachments) is structurally excluded from the
// analyze input HOST-SIDE, before prompt assembly (a code boundary, not a prompt instruction; §3.8). Produces:
//   1. a SharedReport (both see; crisis detail routed AWAY — §8.5),
//   2. two twin insights (source:'together', one per partner, feeding ONLY that partner's own context; sexual
//      facts stored `restricted` so they never cross to anyone else's context, incl. future prompts — §3.8),
//   3. dyad metrics on both twins + mirrored on the report (the pulse source, §3.10a).
// Staleness is DERIVED (agreementService.isReportStale), never stored. Re-run is idempotent (reuse ids).

const TOGETHER_WRAPUP_GUIDANCE = `You are reviewing a completed couples session between two partners to write \
a brief, warm wrap-up. Be faithful to what was actually said — do not invent agreements, feelings, or \
progress. You are not diagnosing or treating either person or the relationship; this is reflective memory, \
not a clinical record. The shared summary is seen by BOTH partners, so keep it balanced, supportive, and \
free of blame. Each partner's private reflection is seen ONLY by that person.`;

/** A per-element-tolerant short-string list (37 §3.1). */
const strList = tolerantArray(z.string(), '', (s) => s.trim() !== '');

/**
 * A concrete action item / next step the couple can follow through on (§3.9). Each becomes a STANDING pair
 * agreement, deduped against the ledger so re-running (reflect → wrap-up) never doubles them. `timeframe` is
 * optional ("this week", "before Friday"). Tolerant by design — a malformed element is dropped, not fatal.
 */
const ActionItemSchema = z.object({
  text: z.string().min(1),
  timeframe: z.string().optional().catch(undefined),
});
const actionItemList = tolerantArray(ActionItemSchema, { text: '' }, (a) => a.text.trim() !== '');

/**
 * A per-partner block in the analysis reply. `name` matches one of the two participant names given in the
 * prompt (resolved back to a person id STRICTLY — an unresolvable name writes no twin, never a mis-subjected
 * one). `crisisFlag` is preserved (.catch(undefined), never coerced — §8). Sexual/intimacy content goes in
 * `sensitiveFacts` → stored `restricted` (own-context-only).
 */
const PartnerBlockSchema = z.object({
  name: z.string().min(1),
  reflection: z.string().catch('').default(''),
  facts: strList,
  sensitiveFacts: strList,
  crisisFlag: z.boolean().optional().catch(undefined),
});

/**
 * The wrap-up AI contract — tolerant by design (37 §3.1): require only `summary`; every list per-element
 * salvages; dyad numbers `.catch` to neutral; `crisisFlag` preserved. The report summary/themes/workedThrough
 * are SHARED (crisis-free); the per-partner reflections/facts are PRIVATE to each partner.
 */
const TogetherAnalysisDraftSchema = z.object({
  summary: z.string().min(1),
  themes: strList,
  workedThrough: strList,
  connectionValence: z.number().catch(0).default(0),
  frictionLevel: z.number().catch(0).default(0),
  partners: tolerantArray(
    PartnerBlockSchema,
    { name: '', reflection: '', facts: [], sensitiveFacts: [] },
    (p) => p.name.trim() !== '',
  ),
  // Concrete next steps the couple named — each becomes a standing pair agreement, deduped (§3.9).
  actionItems: actionItemList,
});

const ANALYSIS_INSTRUCTION = (
  nameA: string,
  nameB: string,
  existingActionItems: string[],
): string => {
  const avoid =
    existingActionItems.length > 0
      ? `\n\nThese action items are ALREADY captured — do NOT repeat any of them (rephrasings count as repeats):\n${existingActionItems
          .map((t) => `- ${t}`)
          .join('\n')}`
      : '';
  return `Now write the wrap-up for this session \
between ${nameA} and ${nameB}. Respond with ONLY a single JSON object (no markdown fences, no prose outside \
it) with these keys:
- "summary": a brief, warm, BALANCED 1-3 sentence recap BOTH partners will see. Never assign blame. NEVER \
include any self-harm/suicide/abuse/crisis detail here — the shared summary stays supportive and detail-free.
- "themes": the main topics or threads (array of short strings)
- "workedThrough": what the two of them worked through or moved toward together (array of short strings)
- "connectionValence": overall warmth/closeness in the session, -1.0 (distant/tense) to 1.0 (close/warm) (number)
- "frictionLevel": overall friction/conflict, -1.0 (very calm) to 1.0 (high friction) (number)
- "partners": an array with EXACTLY one object per partner, each:
  - "name": exactly "${nameA}" or "${nameB}"
  - "reflection": a warm 1-3 sentence reflection written TO that partner about THEIR side (seen only by them)
  - "facts": short durable facts about that partner's experience/needs from this session (array of strings)
  - "sensitiveFacts": any facts touching sex or intimacy — kept PRIVATE to that partner (array of strings)
  - "crisisFlag": true ONLY if THAT partner disclosed self-harm, suicide, or acute crisis (boolean)
- "actionItems": concrete next steps the two of them actually named or agreed to (NOT vague suggestions) — \
each { "text": short imperative shared by both, "timeframe": optional like "this week" }. Only include real, \
mutually-owned commitments; use [] if none were named.${avoid}`;
};

export interface TogetherWrapUpDeps {
  fs: FileSystem;
  key: Uint8Array;
  client: ClaudeClient;
  apiKey: string | null;
  model: string;
  /** The session (loaded + gated by the bridge: membership + live edge). */
  session: TogetherSession;
  /** Whether Together memory is on (the sessions.memoryEnabled sibling; wrap-up produces no memory when off). */
  memoryEnabled: boolean;
  /** The live partner edge id at wrap-up time (best-effort linkage; the STABLE key is `pairKey`). */
  relationshipId?: string;
  /**
   * 'wrapUp' (default) marks the session DONE (sets `wrappedUp` on the report → derives `complete`);
   * 'reflect' is a mid-session checkpoint that produces the SAME report + action items but leaves the session
   * open (§3.8). Both are idempotent (reuse the report/twin ids) and both de-dup action items, so running one
   * then the other never doubles anything.
   */
  mode?: 'reflect' | 'wrapUp';
  now: Date;
  override?: boolean;
}

export type TogetherWrapUpOutcome =
  | { ok: true; report: SharedReport; usage: UsageEvent }
  | {
      ok: false;
      reason:
        | 'NOT_ALLOWED'
        | 'MEMORY_DISABLED'
        | 'EMPTY'
        | 'NO_KEY'
        | 'BUDGET'
        | 'TRUNCATED'
        | 'MALFORMED'
        | 'REFUSED'
        | 'ERROR';
      message: string;
      usage?: UsageEvent;
    };

const clampUnit = (n: number): number => Math.max(-1, Math.min(1, n));

function buildUsage(
  model: string,
  sessionId: string,
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
    type: 'together.analyze',
    personId,
    model,
    at,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheReadTokens: usage.cacheReadTokens,
    costUsd: costOf(model, usage),
    sessionId,
  };
}

/**
 * Run wrap-up for a Together session (§3.8). Idempotent: re-running overwrites the report + each twin in place
 * (reuse-the-id, the 09 pattern). The INITIATOR is billed (§6.2). Returns the shared report on success.
 */
export async function runTogetherWrapUp(deps: TogetherWrapUpDeps): Promise<TogetherWrapUpOutcome> {
  const { fs, key, client, apiKey, model, session, memoryEnabled, now } = deps;
  if (!memoryEnabled) {
    return {
      ok: false,
      reason: 'MEMORY_DISABLED',
      message: 'Together memory is turned off in settings.',
    };
  }
  if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'Add your Claude API key first.' };
  if (session.participantIds.length !== 2) {
    return { ok: false, reason: 'NOT_ALLOWED', message: 'Together isn’t available right now.' };
  }

  // The INITIATOR pays (§6.2) — mirror the couples turn's billing.
  const payer = session.initiatorPersonId;
  const person = await checkBudget(fs, key, {
    scope: 'person',
    personId: payer,
    now,
    override: deps.override,
  });
  const app = await checkBudget(fs, key, { scope: 'app', now, override: deps.override });
  if (person.state === 'over' || app.state === 'over') {
    return { ok: false, reason: 'BUDGET', message: 'AI budget reached for this period.' };
  }

  // The trust boundary: EXCLUDE every private aside (and its attachments) from the analyze input, host-side,
  // before prompt assembly (§3.8 — a code boundary, not a prompt instruction).
  const shared = (await listMessages(fs, key, session.id)).filter((m) => !m.privateAside);
  const humanShared = shared.filter((m) => m.role === 'user' && m.content.trim());
  if (humanShared.length === 0) {
    return { ok: false, reason: 'EMPTY', message: 'There’s nothing shared to wrap up yet.' };
  }

  const [pa, pb] = session.participantIds;
  const personA = pa ? await getPerson(fs, key, pa) : null;
  const personB = pb ? await getPerson(fs, key, pb) : null;
  const nameA = personA?.displayName ?? 'Partner A';
  const nameB = personB?.displayName ?? 'Partner B';
  // Strict name → id resolution (a wrong-subject twin would leak a reflection into the wrong person's context).
  const idByName = new Map<string, string>();
  if (pa) idByName.set(nameA.trim().toLowerCase(), pa);
  if (pb) idByName.set(nameB.trim().toLowerCase(), pb);

  const at = now.toISOString();
  // Existing pair agreements (from chat markers + prior reflect/wrap-up runs) — fed to the prompt as an
  // "already captured, don't repeat" list (the soft de-dup), and used again post-parse as the deterministic
  // de-dup backstop. Retired ones are excluded (a fresh action item may legitimately revive that ground).
  const priorAgreements = await listAgreements(fs, key, session.pairKey);
  const existingActive = priorAgreements.filter((a) => a.status !== 'retired');
  const existingTexts = new Set(existingActive.map((a) => normalizeAgreementText(a.text)));

  const system = [PERSONA, SAFETY, TOGETHER_WRAPUP_GUIDANCE].filter(Boolean).join('\n\n');
  // Attribute each shared human line so the model can write per-partner reflections; coach lines pass through.
  const messages = [
    ...shared.map((m) => ({
      role: m.role,
      content:
        m.role === 'user' ? `${m.authorPersonId === pa ? nameA : nameB}: ${m.content}` : m.content,
    })),
    {
      role: 'user' as const,
      content: ANALYSIS_INSTRUCTION(
        nameA,
        nameB,
        existingActive.map((a) => a.text),
      ),
    },
  ];

  let result;
  try {
    result = await client.stream(
      { apiKey, model, system, messages, maxTokens: 2500, extendedThinking: false },
      () => {},
    );
  } catch {
    return {
      ok: false,
      reason: 'ERROR',
      message: 'The wrap-up couldn’t be written. Please try again.',
    };
  }

  // Meter the paid call immediately — the tokens were spent even if parsing then fails.
  const usage = buildUsage(model, session.id, payer, at, result.usage);
  await recordUsage(fs, key, usage);

  let draft = TogetherAnalysisDraftSchema.safeParse(extractJsonObject(result.text)).data;
  // Salvage a leading `summary` ONLY for a complete-but-malformed reply — never a TRUNCATED one (the per-partner
  // crisisFlag is late in the contract, so a cut-off reply would silently drop it; report TRUNCATED instead, §8).
  if (!draft && classifyParseFailure(result.text) !== 'TRUNCATED') {
    const summary = salvageJsonObjectField(result.text, 'summary');
    if (summary?.trim()) draft = TogetherAnalysisDraftSchema.parse({ summary });
  }
  if (!draft) {
    const { reason, message } = classifyParseOutcome(result.text, 'summary');
    return { ok: false, reason, message, usage };
  }

  const metrics = {
    connectionValence: clampUnit(draft.connectionValence),
    frictionLevel: clampUnit(draft.frictionLevel),
  };

  // Action items → new STANDING pair agreements (§3.9). Deterministic de-dup: skip any whose normalized text
  // already exists in the ledger (a chat-marker agreement, or one from a prior reflect/wrap-up run), and de-dup
  // WITHIN this batch too. This is why "Reflect & note action items" then "Wrap up & reflect" never doubles
  // anything — the second pass sees the first pass's agreements and skips them (belt to the prompt's braces).
  const captured = new Set(existingTexts);
  for (const item of draft.actionItems) {
    const norm = normalizeAgreementText(item.text);
    if (!norm || captured.has(norm)) continue;
    captured.add(norm);
    await saveAgreement(
      fs,
      key,
      pa ?? '',
      pb ?? '',
      {
        text: item.text.trim(),
        ...(item.timeframe && item.timeframe.trim() ? { timeframe: item.timeframe.trim() } : {}),
        status: 'standing',
        sessionId: session.id,
      },
      now,
    );
  }

  // The pair's agreements to reference from the report — those made in THIS session (chat markers + the action
  // items just captured), re-listed so the freshly-minted ones are included. Standing/done (retired excluded).
  const agreements = await listAgreements(fs, key, session.pairKey);
  const sessionAgreementIds = agreements
    .filter((a) => a.provenance.sessionId === session.id && a.status !== 'retired')
    .map((a) => a.id);

  // Twins: one per partner, strictly matched by name → id. Two guards make a wrong-subject reflection
  // impossible: (1) if the partners share a display name the name→id map can't disambiguate them, so we write
  // NO twins at all (the report still stands); (2) an unresolved name writes no twin (fail-safe).
  const namesDistinct = nameA.trim().toLowerCase() !== nameB.trim().toLowerCase();
  const seen = new Set<string>();
  for (const block of namesDistinct ? draft.partners : []) {
    const subjectId = idByName.get(block.name.trim().toLowerCase());
    if (!subjectId || seen.has(subjectId)) continue; // no wrong-subject / duplicate twin
    seen.add(subjectId);

    // Existing 'together' insights for this session+subject. A twin is split in two so the reflection always
    // feeds: the MAIN twin (reflection + non-sexual facts, no restricted) feeds this partner's context in EVERY
    // topic; a companion INTIMACY twin (sexual facts, `restricted` + `lifeArea:'Intimacy'`) is own-context-only
    // and intimacy-topic-gated (the §50 precedent), so it never crosses to anyone else + resets per topic
    // (§3.8). Without this split, one restricted fact fail-closes the WHOLE insight out of the partner's context.
    const priorTwins = (await listInsightsForPerson(fs, key, subjectId)).filter(
      (i) => i.source === 'together' && i.provenance.togetherSessionId === session.id,
    );
    const priorMain = priorTwins.find((i) => !i.facts.some((f) => f.restricted));
    const priorIntimacy = priorTwins.find((i) => i.facts.some((f) => f.restricted));
    // Carry each prior twin fact's sharing forward by text — both `shareableWith` AND the user's explicit
    // `shareableTypes`, so re-running a wrap-up never reverts an un-share back to the partner default.
    const priorShares = new Map(priorTwins.flatMap((i) => i.facts).map((f) => [f.text.trim(), f]));
    const makeFacts = (items: string[], restricted: boolean): InsightFact[] => {
      const out: InsightFact[] = [];
      for (const item of items) {
        const t = item.trim();
        if (!t) continue;
        const carried = priorShares.get(t);
        out.push({
          id: uuid(),
          text: t,
          // Default to shared-with-partner (owner decision — see producedFactShare); a prior explicit scope
          // overrides the default; restricted twin facts stay private + intimacy-scoped.
          ...producedFactShare(restricted, carried?.shareableTypes),
          ...(restricted ? { lifeArea: 'Intimacy' } : {}),
          ...(carried?.shareableWith?.length ? { shareableWith: carried.shareableWith } : {}),
        });
      }
      return out;
    };

    const mainTwin: Insight = {
      id: priorMain?.id ?? uuid(),
      schemaVersion: 1,
      source: 'together',
      subjectPersonId: subjectId,
      ...(deps.relationshipId ? { relationshipId: deps.relationshipId } : {}),
      summary: block.reflection.trim() || draft.summary,
      facts: makeFacts(block.facts, false),
      metrics,
      confidence: 'medium',
      categories: ['Relationships'],
      approved: true, // twins auto-enter that partner's own context (like a session insight)
      provenance: { togetherSessionId: session.id, pairKey: session.pairKey, at },
      // crisisFlag lands on the AFFECTED partner's twin ONLY (set when true) — the report carries no crisis
      // detail (§8.5); a non-crisis twin has no flag, so the §40 aggregation only ever sees real signals.
      ...(block.crisisFlag === true ? { crisisFlag: true } : {}),
      createdAt: priorMain?.createdAt ?? at,
      updatedAt: at,
    };
    await saveInsight(fs, key, mainTwin);

    const sensitiveFacts = makeFacts(block.sensitiveFacts, true);
    if (sensitiveFacts.length > 0) {
      const intimacyTwin: Insight = {
        id: priorIntimacy?.id ?? uuid(),
        schemaVersion: 1,
        source: 'together',
        subjectPersonId: subjectId,
        ...(deps.relationshipId ? { relationshipId: deps.relationshipId } : {}),
        summary: `Intimacy notes from a Together session with ${subjectId === pa ? nameB : nameA}.`,
        facts: sensitiveFacts,
        confidence: 'medium',
        categories: ['Intimacy'],
        approved: true,
        provenance: { togetherSessionId: session.id, pairKey: session.pairKey, at },
        createdAt: priorIntimacy?.createdAt ?? at,
        updatedAt: at,
      };
      await saveInsight(fs, key, intimacyTwin);
    } else if (priorIntimacy) {
      // A re-run that produced no sexual facts drops a now-stale intimacy companion (never a leak either way).
      await deleteInsight(fs, subjectId, priorIntimacy.id);
    }
  }

  // The shared report (idempotent: reuse the id if one exists for this session). A 'wrapUp' marks the session
  // DONE (`wrappedUp` → the `complete` status derives from `wrappedUpAt`, §4.3). A mid-session 'reflect' NEVER
  // changes the wrapped-up state — it CARRIES FORWARD whatever the existing report had, so refreshing the
  // reflection of an already-wrapped-up session can't silently un-wrap it (only a new shared message reopens a
  // session, §4.3). `updatedAt` is the last-generated time staleness compares against (§3.8).
  const isWrapUp = (deps.mode ?? 'wrapUp') === 'wrapUp';
  const existingReport = await getReport(fs, key, session.id);
  const wrapFields: Pick<SharedReport, 'wrappedUp' | 'wrappedUpAt'> | Record<string, never> =
    isWrapUp
      ? { wrappedUp: true, wrappedUpAt: at }
      : existingReport?.wrappedUp
        ? { wrappedUp: true, wrappedUpAt: existingReport.wrappedUpAt ?? existingReport.updatedAt }
        : {};
  const report: SharedReport = {
    id: existingReport?.id ?? uuid(),
    schemaVersion: 1,
    sessionId: session.id,
    summary: draft.summary,
    themes: draft.themes,
    workedThrough: draft.workedThrough,
    agreementIds: sessionAgreementIds,
    metrics,
    ...wrapFields,
    createdAt: existingReport?.createdAt ?? at,
    updatedAt: at,
  };
  await saveReport(fs, key, report);

  return { ok: true, report, usage };
}

/** Re-export the session loader so the bridge can resolve the session for wrap-up in one import. */
export { getSession };

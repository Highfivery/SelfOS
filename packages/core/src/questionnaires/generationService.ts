import { z } from 'zod';
import {
  classifyParseOutcome,
  extractJsonArray,
  extractJsonObject,
  salvageJsonArray,
  tolerantArray,
} from '../ai/jsonSalvage';
import type { FileSystem } from '../host';
import { uuid } from '../id';
import {
  AnswerTypeSchema,
  type AiFailureReason,
  type Question,
  type QuestionnaireGenerateResult,
  type QuestionnaireImproveResult,
  type RelationshipType,
  type SensitivityTier,
} from '../schemas';
import type { IntimacyCoverage } from '../intimacy/coverage';
import { mergedIntimacyTopics } from '../intimacy/topics';
import {
  buildGenerationUserMessage,
  buildImproveUserMessage,
  buildVariantUserMessage,
  GENERATION_SYSTEM,
  IMPROVE_SYSTEM,
  INTIMACY_TYPE,
  SCENARIO_TYPE,
  SHARPEN_INSTRUCTION,
  VARIANT_SYSTEM,
  type IntimacyGenerateMode,
} from './aiPrompts';
import { normalizeOptions } from './questionnaireService';
import { runClaude, type AiDeps } from './aiCall';
import { emptyLedger, readLedger } from './askLedger';
import { gatherGenerationContext, type GenerationContextRequest } from './contextProviders';
import { readCustomIntimacyTopics } from './customTypeService';
import { isNearDuplicate } from './dedup';
import { readProfile, writeProfile } from './personalizationProfile';
import { planQuestions, steeringLifeAreas } from './planService';
import { hasDanglingReference, hasRecitation } from './selfContained';
import { semanticDedupFilter } from './semanticDedup';
import {
  buildLedgerReference,
  ensureTopics,
  mintTopics,
  rollUpCategoryLabels,
  topicStatuses,
  topicsWithNewMaterial,
  type Topic,
  type TopicMaterial,
  type TopicStatus,
} from './topicMap';

/**
 * AI question generation + per-question improve (08-questionnaires §3.1/§13.3). Mirrors `chatService`'s
 * budget → call → record path: every call is budget-gated (warn→block, owner override) and metered
 * through `06`, charged to the active person. Output is parsed + Zod-validated here (the model never
 * supplies ids); a model refusal (no usable questions) degrades to a calm result, not a throw.
 */

export type { AiFailureReason };
export type GenerateResult = QuestionnaireGenerateResult;
export type ImproveResult = QuestionnaireImproveResult;

// `runClaude` / `AiDeps` / `ClaudeCallResult` live in `./aiCall` (shared, cycle-free); re-exported here so every
// existing `from './generationService'` importer keeps working.
export { runClaude } from './aiCall';
export type { AiDeps, ClaudeCallResult } from './aiCall';

/** The model returns ungiven-id question objects; ids are minted here. matrix/allocation aren't generated. */
const GeneratedQuestionSchema = z.object({
  type: AnswerTypeSchema,
  prompt: z.string().min(1),
  required: z.boolean().optional(),
  help: z.string().optional(),
  options: z.array(z.string()).optional(),
  scale: z.object({ min: z.number(), max: z.number() }).optional(),
  // Write-time topic tagging (spec 71 §5.3). Tolerant + optional: a missing tag must never drop an otherwise
  // good question — it just lands untagged and the backfill can classify it later.
  topics: z.array(z.string()).catch([]).optional(),
  gist: z.string().catch('').optional(),
});

/** A bad generated question catches to this sentinel (empty prompt → dropped by the keep filter). */
const QUESTION_SENTINEL: z.infer<typeof GeneratedQuestionSchema> = {
  type: 'shortText',
  prompt: '',
};

/**
 * Generation returns an object: a short `title` (08 §16.4) + the questions array. The questions are parsed
 * per-element (37 §3.1): one malformed/out-of-enum question drops, the rest survive.
 */
const GeneratedSetSchema = z.object({
  title: z.string().optional(),
  questions: tolerantArray(
    GeneratedQuestionSchema,
    QUESTION_SENTINEL,
    (q) => q.prompt.trim() !== '',
  ),
});

const OPTION_TYPES = new Set(['singleChoice', 'multiChoice', 'ranking', 'thisOrThat']);
const SCALE_TYPES = new Set(['rating', 'slider']);

/** The stricter fuzzy threshold applied as a deterministic fallback when the semantic de-dup pass degrades
 *  (spec 69 §5.5) — more aggressive than the standard 0.6 so degraded generation still catches obvious re-asks. */
const STRICT_DEDUP_THRESHOLD = 0.45;

/**
 * Whether a model-returned rewrite of a KNOWN-GOOD question is usable as that question.
 *
 * A personalized variant (§17.14e) is answered by the recipient and never reviewed by the sender, so a
 * refusal sentence or a paragraph of prose coming back would silently become the question they're asked.
 * The canonical prompt is already the designed fallback for a missing element — this widens "missing" to
 * "not plausibly a rewrite of this question", using length rather than refusal-phrase matching, since a
 * legitimate question can easily contain "I won't" (CLAUDE.md §6: never assume a refusal).
 */
export function isUsableRewrite(canonical: string, candidate: string): boolean {
  const text = candidate.trim();
  if (text === '') return false;
  // Prose, an apology or an explanation rather than a reworded question. A personalization stays in the
  // same ballpark as what it personalizes; a hard floor keeps short questions from tripping the ratio.
  return text.length <= Math.max(400, canonical.trim().length * 3);
}

/** Map a validated generated object to a well-formed Question, dropping ones missing required fields. */
function toQuestion(raw: z.infer<typeof GeneratedQuestionSchema>): Question | null {
  // Clean the options FIRST: counting before trimming let a blank entry pad the list, so a question could
  // ship with a single choice. A list that can't be salvaged drops the whole question — a choice question
  // nobody can answer is worse than one fewer question.
  const needsOptions = OPTION_TYPES.has(raw.type);
  const options = needsOptions ? normalizeOptions(raw.options) : null;
  if (needsOptions && !options) return null;
  if (SCALE_TYPES.has(raw.type) && !raw.scale) return null;
  return {
    id: uuid(),
    type: raw.type,
    prompt: raw.prompt.trim(),
    required: raw.required ?? false,
    ...(raw.help?.trim() ? { help: raw.help.trim() } : {}),
    ...(options ? { options } : {}),
    ...(SCALE_TYPES.has(raw.type) && raw.scale ? { scale: raw.scale } : {}),
    // The gist rides the question so the ask ledger can be appended from the frozen snapshot at send time,
    // with no second classification call (spec 71 §5.3). `topicIds` are resolved/minted after generation,
    // once the raw labels can be reconciled against this person's topic map.
    ...(raw.gist?.trim() ? { gist: raw.gist.trim().slice(0, 120) } : {}),
  };
}

export interface GenerateRequest {
  type: string;
  sensitivity: SensitivityTier;
  brief?: string;
  context: GenerationContextRequest;
  existingPrompts: string[];
  count?: number;
  // Intimacy draft format (08 §17.12-C): direct questions, described scenarios, or a mix.
  intimacyMode?: IntimacyGenerateMode;
  // The recipient's full answered content (08 §17.4/§19.1), assembled host-side by the caller (bridge). Fed to
  // the model ONLY to avoid repeating + to go deeper — never surfaced to the author.
  recipientHistory?: string;
  // The exact prompts the recipient was already asked in prior questionnaires + answered in onboarding
  // (08 §23.5) — a structured list for the deterministic hard near-duplicate FILTER (the string
  // `recipientHistory` drives the model; this drives the code filter, so a re-ask the model slips past is
  // still dropped).
  recipientAskedPrompts?: readonly string[];
  // The DEDICATED, prioritized reference for the semantic de-dup pass (08 §23.5b): leads with the onboarding
  // answers (the authoritative "already have data for this"), so they are never truncated away the way the
  // full `recipientHistory` blob was. Falls back to `recipientHistory` when absent.
  dedupReference?: string;
  // The intimacy acts the recipient already rated in onboarding (08 §19.3) — reframes the intimacy seeding so
  // it goes deeper on rated acts instead of re-asking them.
  coveredIntimacyActs?: readonly { label: string; rating: string }[];
  // Which intimacy ground has already been worked (08 §27.2). This is what bounds the "go deeper" above so it
  // stops re-mining the same acts forever (#314) and steers each set to genuinely new ground.
  intimacyCoverage?: IntimacyCoverage;
  // Who the questionnaire is FOR (08 §24.4): name + pronouns + the author↔recipient relationship, so questions
  // read as written for this specific person in the right register. Assembled host-side by the bridge.
  recipient?: {
    name?: string;
    pronouns?: string;
    relationship?: { type: RelationshipType; closeness?: number };
  };
  // Differentiated steering from the recipient's Personalization Profile (spec 69 §5.9): what they've said
  // doesn't apply (avoid), touched a boundary (leave alone), or landed unclear (reword). Assembled host-side by
  // `gatherRecipientFeedbackGuidance`; how the app learns from skips/declines over time.
  feedbackGuidance?: string;
  // Partner-shared context for a SELF-send (spec 69 §5.4): the facts people close to them have shared TO them,
  // so a self/auto check-in can personalize + reciprocate a partner's desire. Restricted facts never cross (the
  // `scopeGrants` gate). Author-blind: only ever set when author == recipient.
  partnerContext?: string;
  // The HOUSEHOLD recipient (spec 71). Enables the ask ledger + emergent topic map: the planner picks ground
  // from what has actually been asked, and generated questions are tagged so the ledger can be appended at
  // send time. Absent (an external recipient, who has no household history) ⇒ generation runs unsteered,
  // which is the pre-71 behaviour minus the two blocks that pulled a typed draft off-register.
  recipientPersonId?: string;
  // The recipient's own material (insights from sessions/dreams/tests/reflections), for the topic-SCOPED
  // re-open signal (spec 71 §5.2). Ground re-opens only when the person has since revealed something about
  // THAT ground — never because an unrelated insight landed, which is the bug that left nine saturated
  // categories reporting `saturated: []` on a real vault. Absent ⇒ no re-open beyond request/dormancy.
  newMaterial?: readonly TopicMaterial[];
  // Ground the person explicitly pinned ("Ask me this") — leads the plan.
  requestedLabels?: readonly string[];
  now?: Date;
}

/** Generate questions from a brief and/or the configured structured context. */
/**
 * The least-worked OPEN ground for a recipient, per the ask ledger (spec 71 §5.2) — or `undefined` when the
 * ledger is not yet authoritative for them.
 *
 * This exists so the auto check-in engine's slot brief and the planner agree on what "new ground" means. The
 * brief GOVERNS generation, so when the engine picked ground from the legacy keyword coverage map while the
 * planner picked it from the ledger, the highest-volume path had two engines disagreeing — and the legacy one
 * had already been measured wrong (it missed a third of what had been asked, and its saturation never fired).
 */
export async function nextOpenGround(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  type: string,
  sensitivity: SensitivityTier,
  now: Date = new Date(),
): Promise<string | undefined> {
  const [profile, ledger] = await Promise.all([
    readProfile(fs, key, personId),
    readLedger(fs, key, personId),
  ]);
  if (ledger.backfilledAt === undefined) return undefined;
  const topics = ensureTopics(profile.topics);
  const areas = new Set(steeringLifeAreas(type, sensitivity));
  const open = topicStatuses({ topics, ledger, newMaterialTopicIds: [], now })
    .filter((s) => areas.has(s.topic.lifeArea) && !s.saturated)
    .sort((a, b) => a.stats.askedCount - b.stats.askedCount);
  return open[0]?.topic.label;
}

export async function generateQuestions(
  deps: AiDeps,
  request: GenerateRequest,
): Promise<GenerateResult> {
  const requestedCount = request.count ?? 5;
  // The semantic de-dup pass (08 §23.5, layer 3) runs when the recipient has known material to compare against
  // (reference de-dup) OR the questionnaire is a sensitive intimacy/scenario type (issue #192 — the model
  // over-produces near-identical sexual questions in one set, and the intra-batch dedup catches those even with
  // no recipient history). Either way the pass also drops candidates that duplicate EACH OTHER. When it will
  // run, OVER-ASK a small buffer so the questions it drops don't leave us short of the requested count; we trim
  // back after filtering. Prefer the DEDICATED, onboarding-first reference (§23.5b) — falls back to the history.
  const now = request.now ?? new Date();

  // ── Ground selection (spec 71 §5.5) ──────────────────────────────────────────────────────────────────
  // Load this recipient's ask ledger + topic map, scope the topics to what this TYPE and TIER may draw on,
  // and let the planner choose the ground BEFORE any question is written. `steeringLifeAreas` is the
  // tier-aware scope: an unfiltered intimacy set draws from Intimacy alone, which is precisely what stops a
  // Relationships topic ("Friendships") leading an explicit questionnaire.
  let topicMap: Topic[] = [];
  let ledger = emptyLedger(request.recipientPersonId ?? '');
  let statuses: TopicStatus[] = [];
  // The ledger only becomes AUTHORITATIVE once the one-time backfill has seeded this person's existing sends
  // (spec 71 §5.6). Until then it is empty or partial, so planning from it would tell the model almost nothing
  // has been asked — worse than the engine it replaces. Until the flag is set we keep the legacy intimacy
  // coverage steering; after it, the planner owns ground. That makes the migration a clean switch rather than
  // a window where neither signal is real.
  let ledgerAuthoritative = false;
  if (request.recipientPersonId) {
    const [profile, loaded] = await Promise.all([
      readProfile(deps.fs, deps.key, request.recipientPersonId),
      readLedger(deps.fs, deps.key, request.recipientPersonId),
    ]);
    ledger = loaded;
    ledgerAuthoritative = ledger.backfilledAt !== undefined;
    topicMap = ensureTopics(profile.topics);
    const areas = new Set(steeringLifeAreas(request.type, request.sensitivity));
    statuses = topicStatuses({
      topics: topicMap,
      ledger,
      newMaterialTopicIds: request.newMaterial
        ? topicsWithNewMaterial(request.newMaterial, topicMap, ledger)
        : [],
      ...(request.requestedLabels ? { requestedTopicIds: [...request.requestedLabels] } : {}),
      now,
    }).filter((s) => areas.has(s.topic.lifeArea));
  }
  // Plan only when there is ground to reason about. An EXTERNAL recipient has no household record, so there
  // are no statuses, no repetition risk to steer around, and nothing for a planning call to decide — spending
  // one would be pure cost. Generation's own guidance covers that case, exactly as it did before spec 71.
  const plan =
    statuses.length > 0 && ledgerAuthoritative
      ? await planQuestions(deps, {
          type: request.type,
          sensitivity: request.sensitivity,
          count: requestedCount,
          ...(request.brief !== undefined ? { brief: request.brief } : {}),
          ...(request.recipient !== undefined ? { recipient: request.recipient } : {}),
          statuses,
          ...(request.requestedLabels ? { requestedLabels: request.requestedLabels } : {}),
          ...(request.feedbackGuidance !== undefined
            ? { feedbackGuidance: request.feedbackGuidance }
            : {}),
        })
      : { threads: [], degraded: false };

  // The de-dup reference now leads with the ledger's compact ground summary (gists + per-topic counts). The
  // caller's raw-text reference still follows, but it is no longer the only defence — a person with hundreds
  // of asks previously had ~2.7% of their history survive the char cap (spec 71 §1 D5).
  const ledgerReference = ledgerAuthoritative ? buildLedgerReference(statuses, ledger) : '';
  const callerReference = (request.dedupReference ?? request.recipientHistory)?.trim() ?? '';
  const dedupReference = [ledgerReference, callerReference]
    .filter((s) => s.trim() !== '')
    .join('\n\n');
  const isSensitiveType = request.type === INTIMACY_TYPE || request.type === SCENARIO_TYPE;
  const willSemanticDedup = dedupReference !== '' || isSensitiveType;
  const askCount = willSemanticDedup ? Math.min(requestedCount + 3, 23) : requestedCount;

  // Pass the questionnaire type so the insights provider derives a relevance topic (28 §13.1) — an intimacy
  // questionnaire surfaces the author's Intimacy/Relationships portrait facts, etc.
  const context = await gatherGenerationContext(deps.fs, deps.key, {
    ...request.context,
    questionnaireType: request.type,
  });
  // The intimacy topic inventory (08 §16.5a) seeds the explicit framing for an intimacy questionnaire at the
  // explicit/unfiltered tiers — the built-in topics merged with the Owner's custom additions (vault prefs).
  const user = buildGenerationUserMessage({
    type: request.type,
    sensitivity: request.sensitivity,
    ...(request.brief !== undefined ? { brief: request.brief } : {}),
    context,
    existingPrompts: request.existingPrompts,
    count: askCount,
    intimacyTopics: mergedIntimacyTopics(await readCustomIntimacyTopics(deps.fs)),
    ...(request.intimacyMode !== undefined ? { intimacyMode: request.intimacyMode } : {}),
    ...(request.recipientHistory !== undefined
      ? { recipientHistory: request.recipientHistory }
      : {}),
    ...(request.coveredIntimacyActs !== undefined
      ? { coveredIntimacyActs: request.coveredIntimacyActs }
      : {}),
    ...(request.intimacyCoverage !== undefined
      ? { intimacyCoverage: request.intimacyCoverage }
      : {}),
    ...(request.recipient !== undefined ? { recipient: request.recipient } : {}),
    ...(request.feedbackGuidance !== undefined
      ? { feedbackGuidance: request.feedbackGuidance }
      : {}),
    ...(request.partnerContext !== undefined ? { partnerContext: request.partnerContext } : {}),
    ...(plan.threads.length > 0 ? { threads: plan.threads } : {}),
    ...(request.recipientPersonId
      ? {
          rollUpCategories: rollUpCategoryLabels(
            steeringLifeAreas(request.type, request.sensitivity),
          ),
        }
      : {}),
  });

  // A generous output budget (thinking is off) that SCALES with the (over-asked) count (08 §23.4) — a 20-question
  // set with long multi-choice option lists would blow past a fixed 2500 and truncate the JSON. ~350 tokens per
  // question with a 2500 floor (so a small set keeps the same headroom as before).
  const maxTokens = Math.max(2500, askCount * 350);
  const call = await runClaude(deps, GENERATION_SYSTEM, user, 'questionnaire.generate', maxTokens);
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  // Generation returns {title, questions}. Tolerate a legacy bare-array reply (older model responses) and a
  // truncated array (salvage the complete elements). Each is per-element tolerant (one bad question drops).
  const objParse = GeneratedSetSchema.safeParse(extractJsonObject(call.text));
  let set: z.infer<typeof GeneratedSetSchema> | null = null;
  if (objParse.success) {
    set = objParse.data;
  } else {
    const whole = extractJsonArray(call.text);
    const rawArray = Array.isArray(whole) ? whole : salvageJsonArray(call.text);
    const arr = tolerantArray(
      GeneratedQuestionSchema,
      QUESTION_SENTINEL,
      (q) => q.prompt.trim() !== '',
    ).parse(rawArray);
    if (arr.length > 0) set = { questions: arr };
  }
  if (!set) {
    // The call succeeded but no parseable JSON came back — classify it honestly (cut off vs unexpected
    // shape vs a detected refusal), never blame the brief (37 §3.1/§3.2).
    const { reason, message } = classifyParseOutcome(call.text, 'draft');
    return { ok: false, reason, usage: call.usage, message };
  }
  // Hard de-dup (08 §23.5): drop a built question that near-duplicates (a) one already kept this round, (b) a
  // question already in the draft, or (c) one the recipient was already asked in a prior questionnaire — not
  // just an exact-normalized repeat. This is the deterministic backstop to the model's soft "avoid overlap".
  const askedPrompts = request.recipientAskedPrompts ?? [];
  const questions: Question[] = [];
  const keptPrompts: string[] = [];
  // Raw topic labels per kept question, resolved against the person's map after the de-dup pass (so we only
  // mint vocabulary for questions that actually survive).
  const rawTopics = new Map<string, string[]>();
  for (const raw of set.questions) {
    const q = toQuestion(raw);
    if (!q) continue;
    // Recitation backstop (spec 71 §5.7): drop a question that quotes a known fact back at the person
    // ("You've marked explicit dirty talk as…") rather than simply naming it. `GENERATION_SYSTEM` forbids
    // this, but the rule had no enforcement and seven of one real recipient's questions opened that way.
    if (hasRecitation(q.prompt)) continue;
    // Self-contained backstop (08 §25.4): drop a question that makes an unambiguous back-reference to
    // context the recipient can't see ("…you mentioned", "your earlier answer"). The prompt rule is the
    // primary fix; this is a conservative deterministic guard (no false positives on legit questions).
    if (hasDanglingReference(q.prompt)) continue;
    if (isNearDuplicate(q.prompt, request.existingPrompts)) continue;
    if (isNearDuplicate(q.prompt, askedPrompts)) continue;
    if (isNearDuplicate(q.prompt, keptPrompts)) continue;
    questions.push(q);
    keptPrompts.push(q.prompt);
    if (raw.topics && raw.topics.length > 0) rawTopics.set(q.id, raw.topics);
  }
  if (questions.length === 0) {
    // A set parsed but yielded nothing new/usable (all duplicates or unbuildable) — a calm retry, not a
    // parse failure and not a data blame.
    return {
      ok: false,
      reason: 'MALFORMED',
      usage: call.usage,
      message: 'No new questions came back. Please try again.',
    };
  }

  // Semantic de-dup (08 §23.5, layer 3): a second bounded, metered call drops questions that mean the same as
  // something the recipient already shared/was asked, in different words (the fuzzy filter misses those). It is
  // FAIL-SAFE — on AI-off / over-budget / a parse miss it keeps every question. Then TRIM to the requested
  // count (we over-asked to absorb the drops). Fewer than requested is acceptable (all we had were new).
  let finalQuestions = questions;
  let dedupDegraded = false;
  if (willSemanticDedup && questions.length > 1) {
    const sem = await semanticDedupFilter(deps, questions, dedupReference);
    finalQuestions = sem.kept;
    // Surface the §26 flag (08 §28.4): the pass fell back to keep-all with no real filter signal (AI-off /
    // over-budget / unparseable / empty). A caller finally reads it so a silent no-op is observable.
    dedupDegraded = sem.degraded === true;
  }
  // Consume `degraded`, don't just report it (spec 69 §5.5): when the semantic pass fell back to keep-all, the
  // only meaning-level de-dup is gone, so tighten the DETERMINISTIC backstop — re-filter against the recipient's
  // already-asked prompts at a stricter (lower) threshold to catch near-dups the standard 0.6 pass let through.
  // Applied before the trim, so we keep up to `requestedCount` of the survivors.
  if (dedupDegraded && askedPrompts.length > 0) {
    finalQuestions = finalQuestions.filter(
      (q) => !isNearDuplicate(q.prompt, askedPrompts, STRICT_DEDUP_THRESHOLD),
    );
  }
  finalQuestions = finalQuestions.slice(0, requestedCount);

  // ── Topic tagging (spec 71 §5.3) ─────────────────────────────────────────────────────────────────────
  // Resolve the labels the model tagged each surviving question with against this person's map, minting any
  // genuinely new ground (alias-merged so near-synonyms can't fork into two half-counted topics), and stamp
  // the resolved ids onto the questions so they ride through draft → edit → send. This is what replaces the
  // keyword regex that credited 34.3% of a real recipient's intimacy questions to ZERO categories.
  if (request.recipientPersonId && finalQuestions.length > 0) {
    const areas = steeringLifeAreas(request.type, request.sensitivity);
    // Where does a NEWLY-INVENTED topic belong? Prefer the life area of the planner thread whose label the
    // model reused; otherwise, if this questionnaire draws on exactly ONE area (any explicit intimacy set),
    // that area is unambiguous. Only a genuinely multi-area questionnaire with no matching thread falls back
    // to `Other` — filing it under whichever area happened to sort first would mis-scope it on every later
    // draft, since the scope is what keeps a typed set on its own ground.
    const threadArea = new Map(
      plan.threads
        .filter((t) => t.lifeArea)
        .map((t) => [t.label.trim().toLowerCase(), t.lifeArea as string]),
    );
    const soleArea = areas.length === 1 ? areas[0] : undefined;
    const areaFor = (label: string): string | undefined =>
      threadArea.get(label.trim().toLowerCase()) ?? soleArea;
    let map = topicMap;
    const tagged: Question[] = [];
    for (const q of finalQuestions) {
      const labels = rawTopics.get(q.id) ?? [];
      if (labels.length === 0) {
        tagged.push(q); // untagged is acceptable — never drop a good question over a missing tag
        continue;
      }
      // The model is told the FIRST tag is the built-in family (§5.3); resolve it first so the specific
      // ground below is minted as its child and inherits its closure.
      const [familyLabel, ...specifics] = labels;
      const ids: string[] = [];
      let parentTopicId: string | undefined;
      if (familyLabel) {
        const m = mintTopics(map, [
          {
            label: familyLabel,
            ...(areaFor(familyLabel) ? { lifeArea: areaFor(familyLabel) as string } : {}),
          },
        ]);
        map = m.topics;
        parentTopicId = m.resolved[0];
        if (parentTopicId) ids.push(parentTopicId);
      }
      if (specifics.length > 0) {
        const m = mintTopics(
          map,
          specifics.map((label) => {
            const area = areaFor(label);
            return {
              label,
              ...(area ? { lifeArea: area } : {}),
              ...(parentTopicId ? { parentTopicId } : {}),
            };
          }),
        );
        map = m.topics;
        ids.push(...m.resolved.filter((id) => id !== parentTopicId));
      }
      tagged.push(ids.length > 0 ? { ...q, topicIds: ids } : q);
    }
    finalQuestions = tagged;
    // Persist the grown vocabulary. Best-effort: a write failure must not fail an otherwise-good draft (the
    // questions still carry their ids; the map self-heals on the next generation).
    if (map !== topicMap) {
      try {
        const profile = await readProfile(deps.fs, deps.key, request.recipientPersonId);
        await writeProfile(deps.fs, deps.key, {
          ...profile,
          topics: map,
          updatedAt: now.toISOString(),
        });
      } catch {
        // vocabulary growth is a learning side-effect, not part of generation's contract
      }
    }
  }

  const title = set.title?.trim();
  // We return the generation call's usage for the renderer's optimistic budget refresh; the semantic pass's
  // `questionnaire.dedup` usage is billed separately (recorded inside `runClaude`) — the ring reloads to reflect it.
  return {
    ok: true,
    questions: finalQuestions,
    ...(title ? { title } : {}),
    usage: call.usage,
    ...(dedupDegraded ? { dedupDegraded: true } : {}),
  };
}

/**
 * Generate one answerer's **personalized variant** of a compatibility questionnaire (08-questionnaires
 * §3.6/§13.5d/§17.12): rewrite each canonical prompt so it asks `forName` (the answerer) about THEIR
 * experience with `aboutName` (the OTHER participant) — so each person is asked about the other, not about
 * themselves. Keeps the SAME answer type + `canonicalId` so the two variants stay aligned. Only prompts are
 * personalized — the answer structure
 * (type/options/scale/branch) is preserved from the canonical question, and the question id is kept (so a
 * branch reference stays valid and the id doubles as the alignment key). The target context is limited to
 * **shareable** facts (the §13.3 privacy boundary — a `targetContext` with `includeAuthor: false`).
 */
export async function generateVariant(
  deps: AiDeps,
  input: {
    forName: string;
    forGender?: string;
    aboutName: string;
    aboutGender?: string;
    questions: Question[];
    targetContext: GenerationContextRequest;
  },
): Promise<QuestionnaireGenerateResult> {
  const context = await gatherGenerationContext(deps.fs, deps.key, input.targetContext);
  const user = buildVariantUserMessage({
    forName: input.forName,
    ...(input.forGender ? { forGender: input.forGender } : {}),
    aboutName: input.aboutName,
    ...(input.aboutGender ? { aboutGender: input.aboutGender } : {}),
    ...(context.trim() ? { context } : {}),
    questions: input.questions.map((q) => ({
      prompt: q.prompt,
      ...(q.options ? { options: q.options } : {}),
    })),
  });
  const call = await runClaude(deps, VARIANT_SYSTEM, user, 'questionnaire.generate', 1500);
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  // The model returns one object per question: { prompt, options }. Both the prompt AND options are
  // personalized — options carry the partner's gendered pronouns (§17.14e), so leaving them un-rewritten
  // was the "answers read as if the other person were answering" bug.
  const variantElement = z.object({
    prompt: z.string(),
    options: z.array(z.string()).nullable().optional(),
  });
  const VARIANT_SENTINEL: z.infer<typeof variantElement> = { prompt: '' };
  // Per-element + truncation tolerant (37 §3.1): map what came back; a short/partial reply just means the
  // trailing questions keep their canonical (un-personalized but still aligned) form. Index-aligned, so a
  // dropped element is NOT compacted — keep the empty sentinel so indices still line up with the questions.
  const whole = extractJsonArray(call.text);
  const rawArray = Array.isArray(whole) ? whole : salvageJsonArray(call.text);
  const variants = z.array(variantElement.catch(VARIANT_SENTINEL)).catch([]).parse(rawArray);
  if (variants.length === 0) {
    const { reason, message } = classifyParseOutcome(call.text, 'personalized questionnaire');
    return { ok: false, reason, usage: call.usage, message };
  }
  // SAFETY: an option rewrite is only accepted when it preserves the option COUNT (so the two variants stay
  // aligned + the answer structure is intact); otherwise keep the canonical options for that question.
  const questions: Question[] = input.questions.map((q, i) => {
    const out = variants[i];
    // Fall back to the canonical prompt when the rewrite isn't usable — the recipient answering a variant
    // nobody reviewed must never be handed a refusal or a wall of prose as their question.
    const rewritten = out?.prompt.trim() ?? '';
    const personalized = isUsableRewrite(q.prompt, rewritten) ? rewritten : '';
    // An option rewrite must preserve the COUNT (the two variants stay aligned) AND be a usable option set
    // — a blank or duplicated rewrite is rejected, keeping the canonical options for that question.
    const cleaned =
      q.options && out?.options && out.options.length === q.options.length
        ? normalizeOptions(out.options)
        : null;
    const rewrittenOptions = cleaned && cleaned.length === q.options?.length ? cleaned : undefined;
    return {
      ...q,
      canonicalId: q.canonicalId ?? q.id, // the alignment key (defaults to the canonical question id)
      ...(personalized ? { prompt: personalized } : {}),
      ...(rewrittenOptions ? { options: rewrittenOptions } : {}),
    };
  });
  return { ok: true, questions, usage: call.usage };
}

/**
 * Sharpen a single "too vague" question (08-questionnaires §28.2) — same topic, made concrete and probing so
 * it draws out a considered answer instead of a shrug. A thin wrapper over `improveQuestion` so the prompt
 * wording (`SHARPEN_INSTRUCTION`) stays server-side; the renderer just asks to "sharpen".
 */
export async function sharpenQuestion(
  deps: AiDeps,
  input: { prompt: string; type: string },
): Promise<ImproveResult> {
  return improveQuestion(deps, { ...input, instruction: SHARPEN_INSTRUCTION });
}

/** Reword a single question per an instruction ("warmer", "tighter", …). */
export async function improveQuestion(
  deps: AiDeps,
  input: { prompt: string; type: string; instruction: string },
): Promise<ImproveResult> {
  const user = buildImproveUserMessage(input);
  const call = await runClaude(deps, IMPROVE_SYSTEM, user, 'questionnaire.generate', 200);
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };
  const text = call.text
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
  if (text === '') {
    // Empty after stripping — classify honestly off the raw reply (an empty reply is a cut-off retry; a
    // decline is REFUSED) rather than the old catch-all "couldn't reword" (37 §3.2).
    const { reason, message } = classifyParseOutcome(call.text, 'reworded question');
    return { ok: false, reason, usage: call.usage, message };
  }
  return { ok: true, prompt: text, usage: call.usage };
}

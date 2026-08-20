import type { FileSystem } from '../../host';
import { uuid } from '../../id';
import { isSafeSegment } from '../../pathSafety';
import { deleteInsight, getInsight, saveInsight } from '../../insights';
import {
  TestResultSchema,
  type EroticLexicon,
  type Insight,
  type InsightFact,
  type TestResult,
} from '../../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../../vault';
import {
  applyDirectionalMarks,
  clearDirectionalMarks,
  type DirectionalMarks,
  derivedWantsToSay,
  lovedEntries,
  mergeLexicons,
  readLexicon,
  writeLexicon,
} from './lexicon';
import { takeCarriesDistress } from './distress';
import { recordTakeSaturation } from './saturation';
import { scoreSpine } from './spine';
import { nameFamilies } from './bank';
import type { AdaptiveTestDefinition } from './types';
import { getGuidancePrefs } from '../../conversations/guidanceService';
import { buildProfileReadBlock } from './steer';
import { DIRTY_TALK } from './instruments/dirtyTalk';

/**
 * 74-adaptive-tests §5 — the adaptive take's lifecycle: start a draft, record each phase, complete it.
 *
 * A take is **resumable across sittings**, so it exists as a `draft` `TestResult` from the first phase and is
 * only marked `complete` at synthesis. Three things happen on completion, in this order:
 *
 * 1. the lexicon is merged forward (the living store all three planned intimacy tests share),
 * 2. the result is scored on the FIXED spine and persisted,
 * 3. the derived Insight is written and the ground is marked worked-through in the ask ledger.
 *
 * The whole deterministic path is FREE — a take that never reaches an AI phase still produces an honest,
 * comparable profile (74 §7). Only the AI phases spend, and each is gated by the caller.
 */

const RESULT_SCHEMA_VERSION = 1;
const INSIGHT_SCHEMA_VERSION = 1;

function testsDir(personId: string): string {
  return `people/${personId}/tests`;
}

/**
 * A result path, with BOTH segments checked. `fs.remove` is recursive and `join` NORMALISES `..` rather than
 * refusing it, so a crafted `resultId` from the renderer could otherwise delete another person's lexicon or
 * the vault's recovery file. Returns null for anything unsafe; every caller treats that as "not found".
 */
function resultPath(personId: string, resultId: string): string | null {
  if (!isSafeSegment(personId) || !isSafeSegment(resultId)) return null;
  return `${testsDir(personId)}/${resultId}.enc`;
}

async function saveResult(fs: FileSystem, key: Uint8Array, result: TestResult): Promise<void> {
  const path = resultPath(result.subjectPersonId, result.id);
  if (!path) return;
  await writeEncryptedJson(fs, path, result, key);
}

export async function getAdaptiveResult(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  resultId: string,
): Promise<TestResult | null> {
  const path = resultPath(personId, resultId);
  if (!path) return null;
  const raw = await readEncryptedJson(fs, path, key);
  if (!raw) return null;
  const parsed = TestResultSchema.safeParse(raw);
  if (!parsed.success) return null;
  // Defense in depth: only ever serve a result whose subject matches the folder it was read from.
  return parsed.data.subjectPersonId === personId ? parsed.data : null;
}

/** Every result for one adaptive test, newest first (history + trends). Drafts included — the take resumes. */
export async function listAdaptiveResults(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  testId: string,
): Promise<TestResult[]> {
  const out: TestResult[] = [];
  for (const name of await fs.list(testsDir(personId))) {
    if (!name.endsWith('.enc') || name === 'lexicon.enc') continue;
    const raw = await readEncryptedJson(fs, `${testsDir(personId)}/${name}`, key);
    if (!raw) continue;
    const parsed = TestResultSchema.safeParse(raw);
    if (!parsed.success) continue; // a corrupt result is skipped, never thrown (the 50 precedent)
    if (parsed.data.subjectPersonId === personId && parsed.data.testId === testId) {
      out.push(parsed.data);
    }
  }
  out.sort((a, b) => (a.takenAt < b.takenAt ? 1 : a.takenAt > b.takenAt ? -1 : 0));
  return out;
}

/** The most recent COMPLETE result — what the report, the trends and every consumer read. */
export async function latestCompleteResult(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  testId: string,
): Promise<TestResult | null> {
  const all = await listAdaptiveResults(fs, key, personId, testId);
  return all.find((result) => result.status !== 'draft') ?? null;
}

/**
 * The person's own profile READING (74 §3.3a), for their own coach — or `''` when they have not taken it.
 *
 * The async half of `buildProfileReadBlock`: the interpretation lives on the latest complete take, not on the
 * merged lexicon, so a caller that only holds `fs`/`key`/`personId` had no way to reach it. That is why the
 * lede and readings were write-once until now.
 */
export async function profileReadBlock(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<string> {
  // The 18+ gate lives HERE, not in each caller. Three of them (their coach, goals, the weekly reflection)
  // would each have had to remember it, and the fourth would not have — which is exactly how the profile
  // ended up reaching six paths and not the other dozen. A profile can only exist behind the ack anyway; this
  // makes withdrawing it take effect on the next call rather than depending on who is asking.
  if ((await getGuidancePrefs(fs, key, personId)).adultAcknowledged !== true) return '';
  const latest = await latestCompleteResult(fs, key, personId, DIRTY_TALK.id);
  return latest ? buildProfileReadBlock(latest) : '';
}

/** An in-progress take to resume, if there is one. */
export async function openDraft(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  testId: string,
): Promise<TestResult | null> {
  const all = await listAdaptiveResults(fs, key, personId, testId);
  return all.find((result) => result.status === 'draft') ?? null;
}

/**
 * Start a take, or resume the draft already in flight. Free — no AI, no budget check. A retake is a NEW
 * result (prior results are kept, so trends stay honest), but it inherits the prior take's `insightId` so the
 * single derived Insight is UPDATED rather than duplicated (the spec-50 rule).
 */
export async function startAdaptiveTake(
  fs: FileSystem,
  key: Uint8Array,
  def: AdaptiveTestDefinition,
  personId: string,
  now: Date,
  newId: () => string = uuid,
): Promise<TestResult> {
  const existing = await openDraft(fs, key, personId, def.id);
  if (existing) return existing;
  const prior = await latestCompleteResult(fs, key, personId, def.id);
  const at = now.toISOString();
  const draft: TestResult = {
    id: newId(),
    schemaVersion: RESULT_SCHEMA_VERSION,
    kind: 'adaptive',
    status: 'draft',
    testId: def.id,
    testVersion: def.version,
    subjectPersonId: personId,
    answers: [],
    /*
     * Carry the prior take's answers forward.
     *
     * A retake used to start with `turns: []`, so every line reaction, question answer and moment pick from
     * last time vanished the moment they tapped Retake — while the MARKS survived (those live in the
     * lexicon). "Keep what you marked" plainly means keep what they told us too; losing it also meant the
     * next pass could not build on any of it, and there was nothing to review or edit.
     *
     * `stampTurn` replaces by item id, so re-answering one of these updates it rather than duplicating.
     * "Start fresh" goes through `abandonAdaptiveTake`, which wipes everything — that path is unchanged.
     */
    turns: prior?.turns ?? [],
    scores: [],
    ...(prior ? { reTakeOf: prior.id } : {}),
    ...(prior?.insightId ? { insightId: prior.insightId } : {}),
    takenAt: at,
    createdAt: at,
    updatedAt: at,
  };
  await saveResult(fs, key, draft);
  return draft;
}

/**
 * Start over from the top — and mean it.
 *
 * This used to delete the take record and reset the position, then re-seed the deck from the person's
 * lexicon, which still held every mark: the screen came back looking exactly as they left it. The owner's
 * expectation, taken as the requirement (2026-08-17): **it clears everything for that person.**
 *
 * That includes the hard nos, deliberately. A `never` is the strongest thing in the model — it suppresses
 * that word everywhere in the app — so leaving them behind would have left the deck full of settled "off the
 * table" rows, which is the state the person is trying to leave. The caller is responsible for making it an
 * informed act (the UI confirms, and says the suppression list goes with it).
 *
 * `key` is required because this rewrites the lexicon rather than only removing a file.
 */
export async function abandonAdaptiveTake(
  fs: FileSystem,
  personId: string,
  resultId: string,
  key?: Uint8Array,
): Promise<void> {
  const path = resultPath(personId, resultId);
  if (path) await fs.remove(path);
  if (!key) return;
  const lexicon = await readLexicon(fs, key, personId);
  if (!lexicon) return;
  await writeLexicon(fs, key, {
    ...lexicon,
    entries: [],
    boundaries: [],
    registers: {},
    contexts: {},
    themes: [],
    wantsToSay: [],
    // `address` and `identity` are kept: they are who the two of you are, not answers about words — and
    // re-asking them would make "start over" mean "answer the setup again", which it doesn't.
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Record a marking pass — the deck ("The words") or the pet names (74 §3.6.8/§3.6.26).
 *
 * ONE function, because since Option B the two phases do the same thing: an entry is answered per direction,
 * `love | okay | never` on each side it is offered. They differed only in the turn they stamp, so that is all
 * this takes a parameter for. The deck used to have its own whole-entry writer plus a second 0–4 "split" pass
 * — that pair is gone (§3.6.26), and with it the class of bug where one phase's writer grew a fix the other
 * never got.
 *
 * Writes straight through to the person's lexicon (the living store), and stamps a turn on the draft so the
 * take carries a record of what it asked, not just what came back.
 */
export async function recordMarkingPass(
  fs: FileSystem,
  key: Uint8Array,
  def: AdaptiveTestDefinition,
  input: {
    personId: string;
    resultId: string;
    /** Which phase is stamping — the turn record, and nothing else. */
    phase: 'bank' | 'names';
    marks: DirectionalMarks;
    /** Directions the person took back, per key (74 §3.4). An absent key undoes nothing. */
    cleared?: Readonly<Record<string, readonly ('hear' | 'say')[]>>;
    /**
     * Which sides each key was SHOWN on for this person (74 §3.6.6). Resolved by the caller, which knows the
     * orientation. Recorded on the entry so a side that was never offered is never read as a refusal —
     * without it, every loved hear-only entry becomes a goal the person never declined.
     */
    sides?: Readonly<Record<string, readonly ('hear' | 'say')[]>>;
    /**
     * An AUTOSAVE, not the end of the pass. The lexicon is written either way — that is the point, so nothing
     * is lost — but only completing the pass stamps a turn. A turn per tap would put thousands of them in the
     * result and make `turns` useless as a record of what was actually asked.
     */
    autosave?: boolean;
  },
  now: Date,
): Promise<EroticLexicon> {
  const lexicon = await readLexicon(fs, key, input.personId, now);
  const source = `test:${input.resultId}`;
  const marked = applyDirectionalMarks(
    lexicon,
    def.bank,
    input.marks,
    source,
    now,
    input.sides ?? {},
  );
  // Un-marking is scoped to the take still being OPEN. Without the draft check, `source` scoping is only as
  // strong as a renderer-supplied string: passing a COMPLETED take's id makes `source` match its entries.
  // Result ids are handed to the renderer in `adaptiveState().history`, so that is a reachable string, not a
  // hypothetical one (74 §3.2).
  const draft = await openDraft(fs, key, input.personId, def.id);
  const clearable = draft?.id === input.resultId ? (input.cleared ?? {}) : {};
  const next = clearDirectionalMarks(marked, clearable, now);
  await writeLexicon(fs, key, next);
  if (input.autosave) return next;
  const item =
    input.phase === 'names'
      ? {
          id: 'names',
          pack: 'names',
          text: `${nameFamilies(def.bank).length} registers of names, marked both ways`,
          options: [],
        }
      : {
          id: 'bank',
          pack: 'bank',
          text: `${def.bank.entries.length} entries across ${def.bank.families.length} families`,
          options: [],
        };
  await stampTurn(fs, key, input.personId, input.resultId, {
    phase: input.phase,
    item,
    answer: Object.keys(input.marks).length,
    at: now.toISOString(),
  });
  return next;
}

/** Append one turn to a draft (pure-ish: read, append, write). Unknown/complete results are left alone. */
export async function stampTurn(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  resultId: string,
  turn: NonNullable<TestResult['turns']>[number],
): Promise<void> {
  const draft = await getAdaptiveResult(fs, key, personId, resultId);
  if (!draft || draft.status !== 'draft') return;
  // REPLACE a turn for the same item rather than appending a second one. Answers are editable (74 §3.6.16 —
  // "a way to see what has been answered, edit those answers"), and appending made a changed answer a
  // duplicate: both reached the synthesis, and the ask ledger counted the item twice.
  //
  // 74 §3.6.35 — replaced IN PLACE. The three AI steps render their set FROM the turns now, so a
  // filter-and-append moved whatever you just answered to the bottom of the list: answer the second of six
  // lines and it jumps past the other five. Position is the order it was written in, and answering is not a
  // re-write of that order.
  const turns = draft.turns ?? [];
  const at = turns.findIndex((t) => t.phase === turn.phase && t.item.id === turn.item.id);
  const next = at >= 0 ? turns.map((t, i) => (i === at ? turn : t)) : [...turns, turn];
  await saveResult(fs, key, { ...draft, turns: next, updatedAt: turn.at });
}

/**
 * 74 §3.6.37 — delete one generated item: off the screen for good, and never offered again.
 *
 * A skip and a delete are different acts. Skipping keeps the item visible and answerable (§3.6.17); deleting
 * says the thing itself was no good. Owner-reported: *"there should be a way to delete questions, not just
 * skip them."*
 *
 * It is a TOMBSTONE rather than a removal, and that is the whole design. The same `turns` list is what stops
 * a phase re-offering something: the bridge builds each phase's avoid-list from these texts and reads back
 * which ambiguities have already been put to them. Drop the row and the model is free to write the identical
 * question again, and "Ask me more" will spend a call re-asking the ambiguity behind it — the exact opposite
 * of what deleting a bad question is for.
 *
 * So the row stays, carrying its text, and the ANSWER goes with the deletion. Everything downstream then
 * follows with no new filters, because every consumer of an answer already tests for one:
 * `answersDigest` skips it, the report's "what you told it" reads through `isAnsweredTurn`, and
 * `takeCarriesDistress` is a `typeof` check. Deleting an answered item stops it feeding the profile
 * immediately, which is what the screen promises when it says so.
 */
export async function deleteTurn(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  resultId: string,
  phase: string,
  itemId: string,
  now: Date,
): Promise<void> {
  const draft = await getAdaptiveResult(fs, key, personId, resultId);
  if (!draft || draft.status !== 'draft') return;
  const turns = draft.turns ?? [];
  const at = turns.findIndex((turn) => turn.phase === phase && turn.item.id === itemId);
  if (at < 0) return;
  const next = turns.map((turn, i) =>
    // `answer` is dropped, not blanked: an empty string is a string, and every consumer that reads one tests
    // `typeof answer === 'string'` — which is how a skip used to be counted as an answer (§3.6.17).
    i === at ? { phase: turn.phase, item: turn.item, at: turn.at, deleted: true } : turn,
  );
  await saveResult(fs, key, { ...draft, turns: next, updatedAt: now.toISOString() });
}

/**
 * 74 §3.6.35 — record what a generating phase just PUT IN FRONT OF THEM, before they respond to any of it.
 *
 * The lines, probe and scenario steps used to keep their generated set in renderer state alone, and only a
 * reaction reached the draft. So the set was gone on the next load — a line you had not reacted to, a question
 * you had not answered and a moment you had not picked were all unreachable, which is what made "see and change
 * everything it generated" impossible. Worse, the bridge builds each phase's avoid-list from these same turns,
 * so an unreacted line was not on it and "write me more" could hand back the very lines it had just replaced.
 *
 * An offer carries NO answer, which is what distinguishes it from a response (`isAnsweredTurn`). Existing turns
 * are never touched: re-generating a scene or re-reading a round must not blank an answer already given.
 */
export async function stampOffers(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  resultId: string,
  phase: string,
  items: readonly NonNullable<TestResult['turns']>[number]['item'][],
  now: Date,
): Promise<void> {
  if (items.length === 0) return;
  const draft = await getAdaptiveResult(fs, key, personId, resultId);
  if (!draft || draft.status !== 'draft') return;
  const turns = draft.turns ?? [];
  const known = new Set(turns.filter((t) => t.phase === phase).map((t) => t.item.id));
  const fresh = items
    .filter((item) => !known.has(item.id))
    .map((item) => ({ phase, item, at: now.toISOString() }));
  if (fresh.length === 0) return;
  await saveResult(fs, key, {
    ...draft,
    turns: [...turns, ...fresh],
    updatedAt: now.toISOString(),
  });
}

/**
 * Add one AI phase's spend to the draft (74 §6). Every phase already records its own `UsageEvent`, so the
 * Usage dashboard was always right — but `TestResult.costUsd` carried only the SYNTHESIS call, which makes the
 * per-take figure understate a take that ran several rounds of lines and probes. The bridge redacts that field
 * for non-admins, so it is a money figure the app is going to show: it has to be the whole cost, not the last
 * call's.
 *
 * A no-op on anything that isn't the open draft, and never fatal — a lost accrual costs an accurate figure,
 * never the take.
 */
export async function accruePhaseCost(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  resultId: string,
  costUsd: number,
): Promise<void> {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return;
  const draft = await getAdaptiveResult(fs, key, personId, resultId);
  if (!draft || draft.status !== 'draft') return;
  await saveResult(fs, key, { ...draft, costUsd: (draft.costUsd ?? 0) + costUsd });
}

/**
 * Complete a take: score the lexicon on the fixed spine, persist the result, write the derived Insight, and
 * mark the ground worked-through. `profile`/`narrative` come from the AI synthesis when it ran; a take that
 * never reached it still completes with the deterministic scores and an honest, thinner report.
 */
export async function completeAdaptiveTake(
  fs: FileSystem,
  key: Uint8Array,
  def: AdaptiveTestDefinition,
  input: {
    personId: string;
    resultId: string;
    profile?: TestResult['profile'];
    narrative?: string;
    lede?: string;
    readings?: TestResult['readings'];
    costUsd?: number;
  },
  now: Date,
): Promise<TestResult | null> {
  const draft = await getAdaptiveResult(fs, key, input.personId, input.resultId);
  if (!draft) return null;

  let lexicon = await readLexicon(fs, key, input.personId, now);
  // Fold the synthesis back into the living lexicon, so the next take (and every consumer) reads one store.
  if (input.profile) {
    lexicon = mergeLexicons(lexicon, {
      ...lexicon,
      registers: input.profile.registers,
      contexts: input.profile.contexts,
      themes: input.profile.themes,
      wantsToSay: input.profile.wantsToSay,
      ...(input.profile.voice !== undefined ? { voice: input.profile.voice } : {}),
      updatedAt: now.toISOString(),
    });
  }
  // The goal list is DERIVED from the hear/say gap rather than asked — nothing in the bank asks for it, and
  // it is what the practice session runs on (74 §3.3).
  lexicon = { ...lexicon, wantsToSay: derivedWantsToSay(lexicon), updatedAt: now.toISOString() };
  await writeLexicon(fs, key, lexicon);

  const at = now.toISOString();
  // §8.3 — a disclosure anywhere in the take flags the result, so the report leads with resources and the
  // flag feeds `aggregateCrisisSignal` like any other (40 §3.5).
  const crisisFlag = takeCarriesDistress(draft.turns);
  const result: TestResult = {
    ...draft,
    status: 'complete',
    ...(crisisFlag ? { crisisFlag: true } : {}),
    scores: scoreSpine(lexicon, def.spine),
    ...(input.profile ? { profile: input.profile } : {}),
    ...(input.narrative ? { narrative: input.narrative } : {}),
    ...(input.lede ? { lede: input.lede } : {}),
    ...(input.readings && input.readings.length > 0 ? { readings: input.readings } : {}),
    // ADD, never replace: the phases before this one accrued their spend onto the draft, and overwriting
    // would silently drop it — leaving an admin reading the synthesis call's price as the take's price.
    ...(input.costUsd !== undefined || draft.costUsd !== undefined
      ? { costUsd: (draft.costUsd ?? 0) + (input.costUsd ?? 0) }
      : {}),
    insightId: draft.insightId ?? uuid(),
    takenAt: at,
    updatedAt: at,
  };
  await saveResult(fs, key, result);
  await saveInsight(fs, key, await buildAdaptiveInsight(fs, key, def, result, lexicon, at));
  // Best-effort, as `recordTakeSaturation` itself states: the result and the Insight are already written, so
  // letting a ledger failure throw here would report a take that SUCCEEDED as failed — and the person would
  // be looking at a "that didn't go through" over a completed profile. A retry heals it (the ledger write is
  // idempotent by construction), and so does the next completed take.
  try {
    await recordTakeSaturation(fs, key, {
      personId: input.personId,
      resultId: result.id,
      testId: def.id,
      topicIds: def.saturates,
      gist: def.saturationGist,
      at,
    });
  } catch {
    // The take stands. The planner simply hasn't been told yet.
  }
  return result;
}

/** How many loved entries the Insight names. Enough to be useful to a coach, short enough to stay a fact. */
const INSIGHT_FACT_CAP = 8;

/**
 * The derived Insight. Facts are tagged `lifeArea: 'Intimacy'`, which is what makes the existing relevance
 * gate do the work: the profile reaches the taker's own intimacy-topic context only, is excluded from the
 * topic-free digests, and never reaches another person's context (50 §5.4 / 54).
 *
 * Boundaries are NOT written as facts. A coach does not need "she hates the word manwhore" in its context to
 * behave correctly — the suppression list does that structurally, and putting a boundary in a prompt is how
 * it ends up being restated back to her.
 */
async function buildAdaptiveInsight(
  fs: FileSystem,
  key: Uint8Array,
  def: AdaptiveTestDefinition,
  result: TestResult,
  lexicon: EroticLexicon,
  fallbackCreatedAt: string,
): Promise<Insight> {
  const insightId = result.insightId ?? uuid();
  const existing = result.insightId
    ? await getInsight(fs, key, result.subjectPersonId, insightId)
    : null;

  const facts: InsightFact[] = [];
  const push = (id: string, text: string): void => {
    facts.push({
      id: `${insightId}:${id}`,
      text,
      // OWN-CONTEXT ONLY, unlike the other test results (54's partner default). Two reasons, both specific to
      // this instrument: the facts are VERBATIM sexual language rather than a trait score, and the
      // cross-shared path is NOT topic-gated — a partner-shared fact reaches their prompt in a session about
      // work. The partner path for this profile is the silent steer (§5.7), which is gated, unattributed and
      // re-checked on every call; `restricted` keeps the raw vocabulary out of every other route.
      shareable: false,
      restricted: true,
      lifeArea: def.lifeArea,
    });
  };

  const hear = lovedEntries(lexicon, 'hear').slice(0, INSIGHT_FACT_CAP);
  if (hear.length > 0) push('hear', `Loves to hear: ${hear.map((e) => e.text).join(', ')}.`);
  const say = lovedEntries(lexicon, 'say').slice(0, INSIGHT_FACT_CAP);
  if (say.length > 0) push('say', `Comfortable saying: ${say.map((e) => e.text).join(', ')}.`);
  const goals = lexicon.wantsToSay.slice(0, INSIGHT_FACT_CAP);
  if (goals.length > 0) {
    push('wants-to-say', `Wants to be able to say (but freezes): ${goals.join(', ')}.`);
  }
  for (const score of result.scores) {
    if (score.normalized >= 0.6 && score.band) {
      const label = def.spine.find((d) => d.key === score.key)?.label ?? score.key;
      push(score.key, `${label} — ${score.band}.`);
    }
  }
  if (lexicon.voice) push('voice', `How it should sound: ${lexicon.voice}`);

  return {
    id: insightId,
    schemaVersion: INSIGHT_SCHEMA_VERSION,
    source: 'test',
    subjectPersonId: result.subjectPersonId,
    summary: def.insightSummary,
    facts,
    metrics: Object.fromEntries(result.scores.map((score) => [score.key, score.normalized])),
    confidence: 'high', // they told us directly, word by word
    categories: [def.lifeArea],
    approved: true,
    ...(result.crisisFlag ? { crisisFlag: true } : {}),
    provenance: { testId: def.id, testResultId: result.id, at: result.takenAt },
    createdAt: existing?.createdAt ?? fallbackCreatedAt,
    updatedAt: result.takenAt,
  };
}

/**
 * Delete EVERY take of an adaptive test — results, the derived Insight, and the lexicon entries this
 * instrument wrote (§8.5: "deletion has to be real here"). Boundaries are kept: a hard no outlives the take
 * that recorded it, because deleting a profile must never quietly re-open something they ruled out.
 */
export async function deleteAllAdaptiveResults(
  fs: FileSystem,
  key: Uint8Array,
  def: AdaptiveTestDefinition,
  personId: string,
  now: Date,
): Promise<void> {
  const all = await listAdaptiveResults(fs, key, personId, def.id);
  const takeIds = new Set(all.map((result) => `test:${result.id}`));
  for (const result of all) {
    const path = resultPath(personId, result.id);
    if (path) await fs.remove(path);
  }
  const insightId = all.find((result) => result.insightId)?.insightId;
  if (insightId) await deleteInsight(fs, personId, insightId);

  const lexicon = await readLexicon(fs, key, personId, now);
  await writeLexicon(fs, key, {
    ...lexicon,
    /*
     * Delete is delete (owner, 2026-08-19). A hard no used to be kept here, back when it was permanent and
     * outlived the profile that recorded it. It is a PREFERENCE now (74 §3.6.11), so keeping one through a
     * delete would leave the person suppressing words they had asked the app to forget — the opposite of
     * what the button says.
     *
     * Still scoped to what THIS instrument's takes wrote: the lexicon is shared, so another test's entries
     * are not ours to delete. Boundaries carry no source to scope by, and they are written by this take's
     * probe phase, so they go with it — the same thing "start over" already does.
     */
    entries: lexicon.entries.filter((entry) => !(entry.source && takeIds.has(entry.source))),
    boundaries: [],
    registers: {},
    contexts: {},
    themes: [],
    wantsToSay: [],
    updatedAt: now.toISOString(),
  });
}

/**
 * Delete one take. If it was the last, the derived Insight goes too; otherwise the Insight is re-derived from
 * the newest surviving take so a deletion never leaves a stale profile feeding the coach (the spec-50 rule).
 * The LEXICON is deliberately untouched — it is the living store the other intimacy tests share, and deleting
 * one take must not silently drop a boundary recorded during it. `deleteAllAdaptiveResults` is the surface
 * that clears both.
 */
export async function deleteAdaptiveResult(
  fs: FileSystem,
  key: Uint8Array,
  def: AdaptiveTestDefinition,
  personId: string,
  resultId: string,
  now: Date,
): Promise<void> {
  const all = await listAdaptiveResults(fs, key, personId, def.id);
  const target = all.find((result) => result.id === resultId);
  const path = resultPath(personId, resultId);
  if (!path) return;
  await fs.remove(path);
  const remaining = all.filter((result) => result.id !== resultId && result.status !== 'draft');
  if (remaining.length === 0) {
    if (target?.insightId) await deleteInsight(fs, personId, target.insightId);
    return;
  }
  const latest = remaining[0];
  if (!latest) return;
  const lexicon = await readLexicon(fs, key, personId, now);
  await saveInsight(
    fs,
    key,
    await buildAdaptiveInsight(fs, key, def, latest, lexicon, latest.takenAt),
  );
}

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
  applyBankMarks,
  applyDirections,
  applyNameMarks,
  clearNameMarks,
  type NameMarks,
  clearMarks,
  derivedWantsToSay,
  lovedEntries,
  mergeLexicons,
  readLexicon,
  writeLexicon,
  type BankMarks,
} from './lexicon';
import { takeCarriesDistress } from './distress';
import { recordTakeSaturation } from './saturation';
import { scoreSpine } from './spine';
import { nameFamilies } from './bank';
import type { AdaptiveTestDefinition } from './types';

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
    turns: [],
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
 * Record pass 1 of the bank — the marks. Writes straight through to the person's lexicon (the living store),
 * and stamps a turn on the draft so the take carries a record of what it asked, not just what came back.
 */
export async function recordBankPass(
  fs: FileSystem,
  key: Uint8Array,
  def: AdaptiveTestDefinition,
  input: {
    personId: string;
    resultId: string;
    marks: BankMarks;
    /** Marks the person took back — un-marked in the same sitting (74 §3.4). */
    cleared?: readonly string[];
    /**
     * Which sides each key was SHOWN on for this person (74 §3.6.6). Resolved by the caller, which knows the
     * orientation. Recorded on the entry so a side that was never offered is never read as a refusal —
     * without it, every loved hear-only entry becomes a goal the person never declined.
     */
    sides?: Readonly<Record<string, readonly ('hear' | 'say')[]>>;
    /**
     * An AUTOSAVE, not the end of the pass. The lexicon is written either way — that is the point, so nothing
     * is lost — but only completing the pass stamps a turn. A turn per tap would put ~1,100 of them in the
     * result and make `turns` useless as a record of what was actually asked.
     */
    autosave?: boolean;
  },
  now: Date,
): Promise<EroticLexicon> {
  const lexicon = await readLexicon(fs, key, input.personId, now);
  const source = `test:${input.resultId}`;
  const marked = applyBankMarks(lexicon, def.bank, input.marks, source, now, input.sides ?? {});
  // Un-marking is scoped to THIS take's own marks, and only while the take is still OPEN. Without the draft
  // check, `source` scoping is only as strong as a renderer-supplied string: passing a COMPLETED take's id
  // makes `source` match its entries and lifts a boundary that take settled. Result ids are handed to the
  // renderer in `adaptiveState().history`, so that is a reachable string, not a hypothetical one (74 §3.2).
  const draft = await openDraft(fs, key, input.personId, def.id);
  const clearable = draft?.id === input.resultId ? (input.cleared ?? []) : [];
  const next = clearMarks(marked, clearable, now, source);
  await writeLexicon(fs, key, next);
  if (input.autosave) return next;
  await stampTurn(fs, key, input.personId, input.resultId, {
    phase: 'bank',
    item: {
      id: 'bank',
      pack: 'bank',
      text: `${def.bank.entries.length} entries across ${def.bank.families.length} families`,
      options: [],
    },
    answer: Object.keys(input.marks).length,
    at: now.toISOString(),
  });
  return next;
}

/**
 * Record the PET-NAME phase (74 §3.6.8) — two marks per name, autosaved a tap at a time like the deck.
 *
 * Same shape as `recordBankPass` on purpose: the un-mark is scoped to this take's own marks AND to the take
 * still being open, because `source` on its own is only as strong as a renderer-supplied string.
 */
export async function recordNamePass(
  fs: FileSystem,
  key: Uint8Array,
  def: AdaptiveTestDefinition,
  input: {
    personId: string;
    resultId: string;
    marks: NameMarks;
    /** Directions taken back, per key (74 §3.4). */
    cleared?: Readonly<Record<string, readonly ('hear' | 'say')[]>>;
    autosave?: boolean;
  },
  now: Date,
): Promise<EroticLexicon> {
  const lexicon = await readLexicon(fs, key, input.personId, now);
  const source = `test:${input.resultId}`;
  const marked = applyNameMarks(lexicon, def.bank, input.marks, source, now);
  const draft = await openDraft(fs, key, input.personId, def.id);
  const clearable = draft?.id === input.resultId ? (input.cleared ?? {}) : {};
  const next = clearNameMarks(marked, clearable, now, source);
  await writeLexicon(fs, key, next);
  if (input.autosave) return next;
  await stampTurn(fs, key, input.personId, input.resultId, {
    phase: 'names',
    item: {
      id: 'names',
      pack: 'names',
      text: `${nameFamilies(def.bank).length} registers of names, marked both ways`,
      options: [],
    },
    answer: Object.keys(input.marks).length,
    at: now.toISOString(),
  });
  return next;
}

/** Record pass 2 — the hear/say split on what pass 1 marked. */
export async function recordSplitPass(
  fs: FileSystem,
  key: Uint8Array,
  input: {
    personId: string;
    resultId: string;
    splits: Record<string, { hear?: number; say?: number }>;
    /** As above — an autosave persists the ratings but does not close the pass. */
    autosave?: boolean;
  },
  now: Date,
): Promise<EroticLexicon> {
  const lexicon = await readLexicon(fs, key, input.personId, now);
  const next = applyDirections(lexicon, input.splits, now);
  await writeLexicon(fs, key, next);
  if (input.autosave) return next;
  await stampTurn(fs, key, input.personId, input.resultId, {
    phase: 'split',
    item: { id: 'split', pack: 'bank', text: 'hear / say split', options: [] },
    answer: Object.keys(input.splits).length,
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
  await saveResult(fs, key, {
    ...draft,
    turns: [...(draft.turns ?? []), turn],
    updatedAt: turn.at,
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
 * Boundaries are NOT written as facts. A coach does not need "she hates the word whore" in its context to
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
    // Only what THIS instrument's takes wrote. A shared lexicon means another test's entries are not ours to
    // delete — and a boundary is nobody's to delete but theirs.
    entries: lexicon.entries.filter(
      (entry) => entry.state === 'never' || !(entry.source && takeIds.has(entry.source)),
    ),
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

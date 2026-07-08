import type { FileSystem } from '../host';
import { uuid } from '../id';
import { deleteInsight, getInsight, saveInsight } from '../insights';
import {
  TestResultSchema,
  type Insight,
  type InsightFact,
  type LifeArea,
  type TestResult,
  type TestSubscaleScore,
} from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { scoresToMetrics, scoreTest, type ScoreAnswers } from './scoring';
import type { TestDefinition, TestGroupId } from './types';
import { detectWellbeingCrisis, resolveWellbeingBand } from './wellbeingCrisis';

/**
 * 50-self-assessments §5.4 — the result → Insight bridge. `takeTest` deterministically scores a take
 * (`scoreTest`, free), persists an encrypted `TestResult` under the taker's own folder, and bridges an
 * `Insight` (`source: 'test'`, `approved: true`, `subjectPersonId` = the taker) so the result auto-feeds the
 * person's OWN coaching context. A retake reuses the prior result's `insightId` (the Insight is UPDATED, not
 * duplicated) + sets `reTakeOf` + adds a trend point. Sensitive (kink/sexuality) results write **`restricted`**
 * facts tagged `lifeArea: 'Intimacy'`, so they only surface in an intimacy-topic context (§3.4).
 */

const RESULT_SCHEMA_VERSION = 1;
const INSIGHT_SCHEMA_VERSION = 1;

function testsDir(personId: string): string {
  return `people/${personId}/tests`;
}
function resultPath(personId: string, resultId: string): string {
  return `${testsDir(personId)}/${resultId}.enc`;
}

/** The life-area an instrument's insight is tagged with (drives Memory grouping + the relevance gate). A
 *  wellbeing instrument may override via `def.lifeArea` (mood/anxiety → Emotions; ADHD/autism → Health). */
const GROUP_LIFE_AREA: Record<TestGroupId, LifeArea> = {
  personality: 'Emotions & patterns',
  relationships: 'Relationships',
  intimacy: 'Intimacy',
  wellbeing: 'Emotions & patterns',
};

/** The life-area for a definition: its explicit `lifeArea`, else the group default. */
function lifeAreaFor(def: TestDefinition): LifeArea {
  return def.lifeArea ?? GROUP_LIFE_AREA[def.group];
}

/** Persist (or overwrite) a result under its taker's encrypted folder. */
async function saveResult(fs: FileSystem, key: Uint8Array, result: TestResult): Promise<void> {
  await writeEncryptedJson(fs, resultPath(result.subjectPersonId, result.id), result, key);
}

/** All of a person's results for one test, newest first (the history + trend series, §3.3). */
export async function listResults(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  testId: string,
): Promise<TestResult[]> {
  const out: TestResult[] = [];
  for (const name of await fs.list(testsDir(personId))) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(fs, `${testsDir(personId)}/${name}`, key);
    if (!raw) continue;
    const parsed = TestResultSchema.safeParse(raw);
    if (!parsed.success) continue; // a corrupt result file is skipped, not crashed (§7)
    // Defense in depth: only serve results whose subject matches the folder + the requested test.
    if (parsed.data.subjectPersonId === personId && parsed.data.testId === testId) {
      out.push(parsed.data);
    }
  }
  out.sort((a, b) => (a.takenAt < b.takenAt ? 1 : a.takenAt > b.takenAt ? -1 : 0));
  return out;
}

/** The person's latest result for a test, or null. */
export async function latestResult(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  testId: string,
): Promise<TestResult | null> {
  return (await listResults(fs, key, personId, testId))[0] ?? null;
}

/** A non-pathologizing fact line for one subscale ("Openness — leans higher"). */
function factText(score: TestSubscaleScore, label: string): string {
  return score.band ? `${label} — ${score.band}` : label;
}

/** The salient facts for an insight. Non-sensitive tests emit one fact per subscale (concise); a sensitive
 * (kink) test emits only the categories that drew real interest (normalized ≥ 0.5), so the coach gets the
 * signal, not 14 "little pull" lines. Sexuality emits all (orientation is meaningful at any point). A WELLBEING
 * reflection (51) emits a single plain, non-pathologizing fact from the resolved band's NON-diagnostic display
 * copy — never the clinical key, never "you have," always framed as a self-reflection (§5.4/§8.1); it is
 * `shareable: false` with NO `shareableWith`/`shareableTypes` ever (§8.4 — never shared with anyone else). */
function buildFacts(
  def: TestDefinition,
  scores: TestSubscaleScore[],
  insightId: string,
): InsightFact[] {
  const lifeArea = lifeAreaFor(def);

  if (def.wellbeing) {
    const total = scores[0];
    const band = total ? resolveWellbeingBand(def, total.raw) : undefined;
    if (!band) return [];
    return [
      {
        id: `${insightId}:${total?.key ?? 'wellbeing'}`,
        // The gentle display copy, with the boundary made explicit so the coach treats it as a reflection.
        text: `${band.display} (a self-reflection, not a clinical finding).`,
        // 54: shared with the PARTNER relationship type by default — the gentle non-diagnostic text only
        // (never the clinical band), partner-only. The person can un-share any test result.
        shareable: false,
        shareableTypes: ['partner'],
        lifeArea,
      },
    ];
  }

  const labelOf = new Map(def.scoring.subscales.map((sub) => [sub.key, sub.label]));
  const isKink = def.id === 'kink-interests';
  const facts: InsightFact[] = [];
  for (const score of scores) {
    if (isKink && score.normalized < 0.5) continue; // only surface categories with real interest
    facts.push({
      id: `${insightId}:${score.key}`,
      text: factText(score, labelOf.get(score.key) ?? score.key),
      // 54: test results default-share with the PARTNER relationship type. Sensitive (kink/sexuality) facts
      // are NOT `restricted` (so they can reach the partner) but keep `lifeArea: 'Intimacy'` — the own-context
      // relevance gate (insightStore) keys off the sensitive life-area, so they still surface only in intimacy
      // contexts AND never feed the topic-free digests; `restricted` stays reserved for break-glass intake facts.
      shareable: false,
      shareableTypes: ['partner'],
      lifeArea,
    });
  }
  return facts;
}

/** A short, non-diagnostic summary line — second person, matching the rest of the person's Memory + the
 * facts below it (which are already "you"/"your"). Feeds the coach as a header for the facts. */
function buildSummary(def: TestDefinition): string {
  switch (def.group) {
    case 'personality':
      return 'How you describe your own personality (a self-assessment).';
    case 'relationships':
      return 'How you relate in close relationships (an attachment self-assessment).';
    case 'intimacy':
      return def.id === 'kink-interests'
        ? 'Your consensual-adult intimacy interests (a private self-assessment).'
        : 'How you see your own sexuality & orientation (a private self-assessment).';
    case 'wellbeing':
      // A gentle, non-diagnostic header — a self-reflection check-in, never a screening or diagnosis (§8.1).
      return `A wellbeing self-reflection (${def.title.toLowerCase()}) — a check-in, not a diagnosis.`;
  }
}

/**
 * Map a pre-fix (third-person) self-assessment summary to its second-person form (the strings were stored on
 * the insight at take time, so existing insights keep the old wording until this normalizes it read-time).
 * Pure + exact-match — a no-op for any other summary. Applied where insights are read (insightStore), so both
 * Memory display AND coaching context see the consistent "you/your" wording.
 */
const LEGACY_TEST_SUMMARY_FIX: Record<string, string> = {
  'How they describe their own personality (a self-assessment).':
    'How you describe your own personality (a self-assessment).',
  'How they relate in close relationships (an attachment self-assessment).':
    'How you relate in close relationships (an attachment self-assessment).',
  'Their consensual-adult intimacy interests (a private self-assessment).':
    'Your consensual-adult intimacy interests (a private self-assessment).',
  'How they see their own sexuality & orientation (a private self-assessment).':
    'How you see your own sexuality & orientation (a private self-assessment).',
};

export function normalizeTestSummary(summary: string): string {
  return LEGACY_TEST_SUMMARY_FIX[summary] ?? summary;
}

/**
 * Score a take deterministically, persist a `TestResult`, and bridge the derived `Insight`. Returns the saved
 * result (with its `insightId`). `now`/`newId` are injected so the host (and tests) control time/ids. No AI,
 * no budget — scoring is free.
 */
export async function takeTest(
  fs: FileSystem,
  key: Uint8Array,
  def: TestDefinition,
  input: { personId: string; answers: ScoreAnswers },
  now: Date,
  newId: () => string = uuid,
): Promise<TestResult> {
  const at = now.toISOString();
  const scores = scoreTest(def, input.answers);

  // Wellbeing (51): resolve the internal clinical band from the total raw and stamp it as the score's `band`
  // (the clinicalKey — kept for trends, NEVER shown clinically; the display copy is resolved at render). Then
  // run the deterministic, AI-free crisis hook (item-level PHQ-9 item-9 OR band-level high score, §5.2).
  let crisisFlag = false;
  if (def.wellbeing) {
    const total = scores[0];
    const band = total ? resolveWellbeingBand(def, total.raw) : undefined;
    if (total && band) total.band = band.clinicalKey;
    crisisFlag = detectWellbeingCrisis(def, input.answers, band);
  }

  // A retake reuses the single derived Insight (UPDATE, not duplicate) + chains via `reTakeOf` to the prior
  // result. The new TestResult is always a NEW file (trends keep every dated take).
  const prior = await latestResult(fs, key, input.personId, def.id);
  const insightId = prior?.insightId ?? newId();

  const result: TestResult = {
    id: newId(),
    schemaVersion: RESULT_SCHEMA_VERSION,
    testId: def.id,
    testVersion: def.version,
    subjectPersonId: input.personId,
    answers: Object.entries(input.answers)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([questionId, value]) => ({
        questionId,
        value: value as TestResult['answers'][number]['value'],
      })),
    scores,
    ...(prior ? { reTakeOf: prior.id } : {}),
    ...(crisisFlag ? { crisisFlag: true } : {}),
    insightId,
    takenAt: at,
    createdAt: at,
    updatedAt: at,
  };
  await saveResult(fs, key, result);
  await saveInsight(fs, key, await buildInsightForResult(fs, key, def, result, at));
  return result;
}

/**
 * Build the derived `Insight` for a stored `TestResult` (deterministically, from its persisted `scores` +
 * `crisisFlag`). Reused by `takeTest` and by `deleteResult`'s re-derivation, so the single Insight always
 * reflects whichever result it points at. Preserves the Insight's original `createdAt` on update.
 */
async function buildInsightForResult(
  fs: FileSystem,
  key: Uint8Array,
  def: TestDefinition,
  result: TestResult,
  fallbackCreatedAt: string,
): Promise<Insight> {
  const insightId = result.insightId ?? uuid();
  const existing = result.insightId
    ? await getInsight(fs, key, result.subjectPersonId, insightId)
    : null;
  return {
    id: insightId,
    schemaVersion: INSIGHT_SCHEMA_VERSION,
    source: 'test',
    subjectPersonId: result.subjectPersonId,
    summary: buildSummary(def),
    facts: buildFacts(def, result.scores, insightId),
    metrics: scoresToMetrics(result.scores),
    confidence: 'high', // a deterministic self-report is high-confidence about what they answered
    categories: [lifeAreaFor(def)],
    approved: true, // auto-feed own context (50 §3.4 / §11 Q3), reviewable + editable in Memory
    // A crisis-flagged wellbeing result (51 §5.2) feeds `aggregateCrisisSignal` (40 §3.5) like any flag.
    ...(result.crisisFlag ? { crisisFlag: true } : {}),
    provenance: { testId: def.id, testResultId: result.id, at: result.takenAt },
    createdAt: existing?.createdAt ?? fallbackCreatedAt,
    updatedAt: result.takenAt,
  };
}

/**
 * Delete one result file. If it was the LAST result for that test, the derived Insight is removed too; if
 * results remain (and the definition is supplied), the Insight is RE-DERIVED from the new latest remaining
 * result — so deleting the most recent take never leaves a stale trend or a stale `crisisFlag` feeding
 * `aggregateCrisisSignal` (40 §3.5). `def` omitted (legacy callers) ⇒ the Insight is left untouched.
 */
export async function deleteResult(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  testId: string,
  resultId: string,
  def?: TestDefinition,
): Promise<void> {
  const all = await listResults(fs, key, personId, testId);
  const target = all.find((result) => result.id === resultId);
  await fs.remove(resultPath(personId, resultId));
  const remaining = all.filter((result) => result.id !== resultId);
  if (remaining.length === 0) {
    if (target?.insightId) await deleteInsight(fs, personId, target.insightId);
    return;
  }
  // listResults is newest-first → remaining[0] is the latest surviving take.
  const latest = remaining[0];
  if (def && latest) {
    await saveInsight(fs, key, await buildInsightForResult(fs, key, def, latest, latest.takenAt));
  }
}

/** Delete ALL results for a test + the derived Insight (the "Delete all results" action, §3.3). */
export async function deleteAllResults(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  testId: string,
): Promise<void> {
  const all = await listResults(fs, key, personId, testId);
  for (const result of all) await fs.remove(resultPath(personId, result.id));
  const insightId = all.find((result) => result.insightId)?.insightId;
  if (insightId) await deleteInsight(fs, personId, insightId);
}

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

/** The life-area an instrument's insight is tagged with (drives Memory grouping + the relevance gate). */
const GROUP_LIFE_AREA: Record<TestGroupId, LifeArea> = {
  personality: 'Emotions & patterns',
  relationships: 'Relationships',
  intimacy: 'Intimacy',
};

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
 * signal, not 14 "little pull" lines. Sexuality emits all (orientation is meaningful at any point). */
function buildFacts(
  def: TestDefinition,
  scores: TestSubscaleScore[],
  insightId: string,
): InsightFact[] {
  const labelOf = new Map(def.scoring.subscales.map((sub) => [sub.key, sub.label]));
  const lifeArea = GROUP_LIFE_AREA[def.group];
  const sensitive = def.sensitive ?? false;
  const isKink = def.id === 'kink-interests';
  const facts: InsightFact[] = [];
  for (const score of scores) {
    if (isKink && score.normalized < 0.5) continue; // only surface categories with real interest
    facts.push({
      id: `${insightId}:${score.key}`,
      text: factText(score, labelOf.get(score.key) ?? score.key),
      shareable: false, // own-only v1 (50 §11 Q6) — sensitive results are never shareable
      ...(sensitive ? { restricted: true } : {}),
      lifeArea,
    });
  }
  return facts;
}

/** A short, non-diagnostic summary line (feeds the coach as a header for the facts). */
function buildSummary(def: TestDefinition): string {
  switch (def.group) {
    case 'personality':
      return 'How they describe their own personality (a self-assessment).';
    case 'relationships':
      return 'How they relate in close relationships (an attachment self-assessment).';
    case 'intimacy':
      return def.id === 'kink-interests'
        ? 'Their consensual-adult intimacy interests (a private self-assessment).'
        : 'How they see their own sexuality & orientation (a private self-assessment).';
  }
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
    insightId,
    takenAt: at,
    createdAt: at,
    updatedAt: at,
  };
  await saveResult(fs, key, result);

  const insight: Insight = {
    id: insightId,
    schemaVersion: INSIGHT_SCHEMA_VERSION,
    source: 'test',
    subjectPersonId: input.personId,
    summary: buildSummary(def),
    facts: buildFacts(def, scores, insightId),
    metrics: scoresToMetrics(scores),
    confidence: 'high', // a deterministic self-report is high-confidence about what they answered
    categories: [GROUP_LIFE_AREA[def.group]],
    approved: true, // auto-feed own context (50 §3.4 / §11 Q3), reviewable + editable in Memory
    provenance: { testId: def.id, testResultId: result.id, at },
    createdAt: prior
      ? ((await getInsight(fs, key, input.personId, insightId))?.createdAt ?? at)
      : at,
    updatedAt: at,
  };
  await saveInsight(fs, key, insight);
  return result;
}

/** Delete one result file. If it was the LAST result for that test, the derived Insight is removed too. */
export async function deleteResult(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  testId: string,
  resultId: string,
): Promise<void> {
  const all = await listResults(fs, key, personId, testId);
  const target = all.find((result) => result.id === resultId);
  await fs.remove(resultPath(personId, resultId));
  const remaining = all.filter((result) => result.id !== resultId);
  if (remaining.length === 0 && target?.insightId) {
    await deleteInsight(fs, personId, target.insightId);
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

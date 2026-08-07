import { z } from 'zod';

import { extractJsonArray, salvageJsonArray, tolerantArray } from '../ai/jsonSalvage';
import { buildIntimacyCoverage } from '../intimacy/coverage';
import { formatIntakeForGeneration, getIntakeSession } from '../intake/intakeService';

import { runClaude, type AiDeps } from './aiCall';
import {
  applyCoverageAssessments,
  deriveCoverageSkeleton,
  GENERAL_LIFE_AREAS,
  type CoverageAssessment,
} from './coverageModel';
import { readProfile, writeProfile } from './personalizationProfile';
import {
  gatherRecipientInsightFacts,
  gatherRecipientIntimacyAsks,
  gatherRecipientMaterialSignals,
  gatherRecipientPriorAnswers,
} from './recipientHistory';

/**
 * The AI coverage-placement pass (spec 69 §5.6, Phase 2b) — reads a bounded digest of the person's own answers
 * + insights and scores, per general life area, how deeply they've been explored (0 = no data … 1 = thoroughly
 * explored), optionally minting sub-topics where an area is genuinely multi-strand. The result is merged onto
 * the deterministic skeleton (Intimacy stays send-history driven) and written to their Personalization Profile,
 * so generation can steer to NEW ground. Metered `questionnaire.profile`; budget-gated; fail-safe (a failed
 * pass leaves the last-good coverage rather than wiping it).
 *
 * It reads the person's OWN data into their OWN profile, so there is no cross-person boundary here.
 */

const DIGEST_CAP = 16000;

const COVERAGE_SYSTEM = `You map how thoroughly someone has been explored across the areas of their life, to help a
coaching app ask about NEW ground instead of repeating itself.

You will be given (a) a digest of what the person has already shared (onboarding answers, prior questionnaire
answers, and distilled insights) and (b) a fixed list of life areas. For EACH life area, judge how deeply that
area has been explored in the digest and return a "depth" from 0 to 1:
- 0.0 = nothing at all is known about this area
- 0.3 = lightly touched (a fact or two)
- 0.7 = explored in real depth
- 1.0 = thoroughly explored from many angles

Only where an area has clearly SEVERAL distinct strands, you may add up to 3 "subTopics", each a short label
with its own depth, so the app can tell which strands are new. Keep sub-topics rare — most areas need none.

Return ONLY a JSON array, one object per life area you were given, like:
[{"lifeArea":"Work & purpose","depth":0.6,"subTopics":[{"label":"Career direction","depth":0.2}]}, ...]
No prose, no markdown, no commentary — just the JSON array.`;

const AssessmentSchema = z.object({
  lifeArea: z.string(),
  depth: z.number().catch(0),
  subTopics: z
    .array(z.object({ label: z.string(), depth: z.number().catch(0) }))
    .optional()
    .catch(undefined),
});
const ASSESSMENT_SENTINEL: z.infer<typeof AssessmentSchema> = { lifeArea: '', depth: 0 };

function buildUser(digest: string): string {
  return [
    `Life areas to score (return exactly these, by this name):`,
    GENERAL_LIFE_AREAS.map((a) => `- ${a}`).join('\n'),
    ``,
    digest.trim()
      ? `What the person has already shared:\n${digest.trim()}`
      : `The person has shared nothing yet — every area's depth is 0.`,
  ].join('\n');
}

export interface CoverageRefreshResult {
  ok: boolean;
  degraded?: boolean;
  reason?: string;
}

/**
 * Recompute the person's coverage map. Household-scoped by the caller. On any AI failure (no key / over budget /
 * unparseable) the existing coverage is left untouched and `degraded` is set — never wiped.
 */
export async function refreshCoverage(
  deps: AiDeps,
  recipientPersonId: string,
): Promise<CoverageRefreshResult> {
  const [priorAnswers, insightFacts, session, intimacyAsks, signals] = await Promise.all([
    gatherRecipientPriorAnswers(deps.fs, deps.key, recipientPersonId),
    gatherRecipientInsightFacts(deps.fs, deps.key, recipientPersonId),
    getIntakeSession(deps.fs, deps.key, recipientPersonId),
    gatherRecipientIntimacyAsks(deps.fs, deps.key, recipientPersonId),
    gatherRecipientMaterialSignals(deps.fs, deps.key, recipientPersonId),
  ]);
  const intake = session
    ? formatIntakeForGeneration(session)
    : { text: '', coveredActs: [], prompts: [] };

  // The Intimacy branch is deterministic (send-history driven) — computed here, never asked of the model.
  const intimacyCoverage = buildIntimacyCoverage({
    coveredActs: intake.coveredActs,
    askedIntimacy: intimacyAsks,
    ...(signals.newMaterialAt !== undefined ? { newMaterialAt: signals.newMaterialAt } : {}),
    ...(session?.updatedAt ? { profileEditedAt: session.updatedAt } : {}),
    now: deps.now,
  });

  const digest = [
    intake.text.trim() ? `Onboarding answers:\n${intake.text.trim()}` : '',
    priorAnswers.trim() ? `Prior questionnaire answers:\n${priorAnswers.trim()}` : '',
    insightFacts.trim() ? insightFacts.trim() : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, DIGEST_CAP);

  const call = await runClaude(
    deps,
    COVERAGE_SYSTEM,
    buildUser(digest),
    'questionnaire.profile',
    1500,
  );
  if (!call.ok) {
    // Fail-safe: keep the last-good coverage; a caller can log the degrade.
    return { ok: false, degraded: true, reason: call.reason };
  }

  const rawArray = extractJsonArray(call.text) ?? salvageJsonArray(call.text);
  const parsed = tolerantArray(AssessmentSchema, ASSESSMENT_SENTINEL, (a) =>
    GENERAL_LIFE_AREAS.includes(a.lifeArea),
  ).parse(rawArray);
  // Empty/garbled reply → leave coverage as-is (fail-safe), flag degraded.
  if (parsed.length === 0) return { ok: false, degraded: true, reason: 'MALFORMED' };

  const assessments: CoverageAssessment[] = parsed.map((a) => ({
    lifeArea: a.lifeArea,
    depth: a.depth,
    ...(a.subTopics ? { subTopics: a.subTopics } : {}),
  }));

  const skeleton = deriveCoverageSkeleton(intimacyCoverage);
  const topics = applyCoverageAssessments(skeleton, assessments);
  const profile = await readProfile(deps.fs, deps.key, recipientPersonId);
  await writeProfile(deps.fs, deps.key, {
    ...profile,
    coverage: { topics, lastPlacementAt: deps.now.toISOString() },
    updatedAt: deps.now.toISOString(),
  });
  return { ok: true };
}

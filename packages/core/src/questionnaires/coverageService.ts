import { z } from 'zod';

import { extractJsonArray, salvageJsonArray, tolerantArray } from '../ai/jsonSalvage';
import { formatIntakeForGeneration, getIntakeSession } from '../intake/intakeService';

import { runClaude, type AiDeps } from './aiCall';
import {
  applyCoverageAssessments,
  buildCoverageGuidance,
  deriveCoverageSkeleton,
  GENERAL_LIFE_AREAS,
  type CoverageAssessment,
} from './coverageModel';
import { buildOwnSuppressionBlock } from '../tests/adaptive/steer';
import { readLedger } from './askLedger';
import { gatherRecipientPartnerContext } from './partnerContext';
import {
  applyReciprocity,
  buildFeedbackGuidance,
  mergeCandidates,
  readProfile,
  writeProfile,
} from './personalizationProfile';
import {
  gatherRecipientAskedPrompts,
  gatherRecipientInsightFacts,
  gatherRecipientPriorAnswers,
} from './recipientHistory';
import { ensureTopics } from './topicMap';
import { foldTopicMap } from './transparencyView';

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
area has been explored in the digest and return a "depth" from 0 to 1.

Be HONEST and CONSERVATIVE — the point is to keep asking about new ground, and over-scoring makes the app think
it is "done" when it never is. Real depth is built up from MANY angles over MANY exchanges; a person has almost
always been explored far LESS than they seem. Anchor to this and round DOWN when unsure:
- 0.0 = nothing at all is known about this area
- 0.2 = a fact or two mentioned in passing (this is where MOST touched areas sit)
- 0.4 = a few real, specific things known, but plenty of obvious angles untouched
- 0.7 = genuinely explored from SEVERAL distinct angles, with follow-up and nuance (RARE — reserve it)
- 0.9-1.0 = exhaustively explored from many angles over time (VERY rare; almost never true for a single area)

Most areas should land at 0.4 or below. Do not give an area 0.7+ just because a few facts are present — that
bar is for sustained, multi-angle exploration, not "a fact or two".

Sub-topics are RARE — most areas need NONE, and returning none is the right default. Only add "subTopics"
(up to 3) for an area you scored 0.5 or higher (already explored in real depth) that genuinely has SEVERAL
distinct strands with their own coverage, so the app can tell which strand is still new. Do NOT sub-divide a
lightly-touched area (below 0.5), and never invent a strand you have no real data about.

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
  const [priorAnswers, insightFacts, session] = await Promise.all([
    gatherRecipientPriorAnswers(deps.fs, deps.key, recipientPersonId),
    gatherRecipientInsightFacts(deps.fs, deps.key, recipientPersonId),
    getIntakeSession(deps.fs, deps.key, recipientPersonId),
  ]);
  const intake = session
    ? formatIntakeForGeneration(session)
    : { text: '', coveredActs: [], prompts: [] };

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

  const skeleton = deriveCoverageSkeleton();
  // Fold the ask ledger in BEFORE persisting. The skeleton's intimacy rows are structure only (all zeros), and
  // `applyCoverageAssessments` deliberately never scores Intimacy — so persisting them raw would leave every
  // category permanently `explored:false, depth:0`, and `buildCoverageGuidance` (which reads the persisted
  // profile directly, NOT the folded view) would then put the most worked-through ground in the vault under
  // "NEW / UNEXPLORED GROUND — lead here" for the candidate feed. Measured: all 14 categories, sorted ahead of
  // general areas that carry real depth.
  const [ledger, profileForTopics] = await Promise.all([
    readLedger(deps.fs, deps.key, recipientPersonId),
    readProfile(deps.fs, deps.key, recipientPersonId),
  ]);
  const topics = foldTopicMap(
    applyCoverageAssessments(skeleton, assessments),
    ensureTopics(profileForTopics.topics),
    ledger,
  );
  // Persist the reciprocity ledger (spec 69 §5.4 follow-on) on the same cadence: a partner's shared desire →
  // a candidate to reflect back (bounded by the fresh window so a stable desire stops being re-nudged).
  const partner = await gatherRecipientPartnerContext(deps.fs, deps.key, recipientPersonId);
  const profile = await readProfile(deps.fs, deps.key, recipientPersonId);
  const withCoverage = {
    ...profile,
    coverage: { topics, lastPlacementAt: deps.now.toISOString() },
    updatedAt: deps.now.toISOString(),
  };
  await writeProfile(
    deps.fs,
    deps.key,
    applyReciprocity(withCoverage, partner.reciprocity, deps.now),
  );
  return { ok: true };
}

// ── The next-topics candidate pass (spec 70 §3.2/§5.3) ──────────────────────────────────────────────────────

/** Cap the candidate grounding digest so the prompt stays economical (cheaper than the full coverage digest —
 *  this pass reads only the distilled facts + intake, never a second full re-decrypt of every response). */
const CANDIDATE_DIGEST_CAP = 12000;
/** Over-ask a little past the FEED cap so `mergeCandidates` (dedup + per-area cap) still fills the feed. */
const CANDIDATE_ASK_COUNT = 12;

const CANDIDATE_SYSTEM = `You help a coaching app decide the most interesting, worthwhile questions to ask
someone NEXT — the specific things it is curious about, drawn from what it already knows about them and where it
hasn't been yet. Exploration is never finished: there is always a genuinely new angle, and always a thread worth
going deeper on.

You'll be given some steering (where this person has and hasn't been explored, what they've said doesn't apply
or lands as a boundary, and what they've shared) and asked for a set of candidate questions. Follow these rules:
- Lead with NEW GROUND — most candidates should open up territory this person hasn't been asked about.
- A MINORITY may go DEEPER on a specific thing they already shared — a fresh, more specific angle, never a
  re-ask of the same question.
- Each candidate is a single, concrete, answerable question in warm plain language — not a topic label.
- NEVER propose anything they've indicated doesn't apply, touches a boundary they'd rather leave, or that they
  have clearly already answered.
- Tag each: "new" (unaddressed ground) or "go-deeper" (a follow-up on something already shared).
- Give each candidate its life area, using ONE of the area names from the steering.

Return ONLY a JSON array, one object per candidate, like:
[{"lifeArea":"Work & purpose","prompt":"What part of your work still feels unfinished to you?","kind":"new"}, ...]
Return up to ${CANDIDATE_ASK_COUNT}. No prose, no markdown, no commentary — just the JSON array.`;

const CandidateProposalSchema = z.object({
  lifeArea: z.string(),
  prompt: z.string(),
  kind: z.enum(['new', 'go-deeper']).catch('new'),
  topicId: z.string().optional().catch(undefined),
});
const CANDIDATE_SENTINEL: z.infer<typeof CandidateProposalSchema> = {
  lifeArea: '',
  prompt: '',
  kind: 'new',
};

function buildCandidateUser(steering: string, grounding: string, suppression: string): string {
  // Cap the (unbounded) grounding BEFORE assembly — like `buildUser` — so the trailing instruction + count are
  // never truncated away, however long the person's history is.
  const g = grounding.trim().slice(0, CANDIDATE_DIGEST_CAP);
  return [
    steering.trim()
      ? steering.trim()
      : 'This person is new — you have almost no data. Lead entirely with warm, foundational new-ground questions.',
    '',
    g
      ? `What they have shared (draw go-deeper candidates from this; never re-ask it verbatim):\n${g}`
      : '',
    '',
    // 74 §5.8a — CANDIDATE_SYSTEM already tells the model to propose nothing that "touches a boundary they'd
    // rather leave". Until now it was never given the boundaries: an instruction with no data behind it, and
    // the prompts it writes are rendered verbatim to the person on the Explored tab with nobody reviewing
    // them. Same defect `challengeSuggestService` documents and fixed.
    suppression.trim(),
    '',
    `Propose up to ${CANDIDATE_ASK_COUNT} candidate questions now.`,
  ]
    .filter((s) => s !== '')
    .join('\n');
}

export interface CandidateRefreshResult {
  ok: boolean;
  degraded?: boolean;
  reason?: string;
}

/**
 * Recompute the person's "what's next" candidate feed (spec 70 §3.2/§5.3) — one metered `questionnaire.profile`
 * pass that proposes concrete candidate questions from the recalibrated coverage map + the feedback ledger +
 * their distilled facts, tagged new vs. go-deeper. Runs on the same daily cadence as `refreshCoverage` (right
 * after it, so it reads the freshly-placed coverage). Merged with existing curation (`markCandidateAsked` +
 * `mergeCandidates`), so a pinned candidate carries forward and an asked one drops off.
 *
 * Reads the person's OWN data into their OWN profile — no cross-person boundary. Budget-gated; fail-safe: any AI
 * failure (no key / over budget / unparseable) leaves the last-good candidates untouched and flags `degraded`.
 * Uses the CHEAP reads (distilled insight facts + intake), not a second full re-decrypt of every response.
 */
export async function refreshNextCandidates(
  deps: AiDeps,
  recipientPersonId: string,
): Promise<CandidateRefreshResult> {
  // The just-placed coverage map + differentiated feedback → the steering (where to go, what to avoid). Read the
  // profile ONCE and reuse it as the merge base, so a concurrent write between refreshCoverage and here can't be
  // clobbered by a stale read.
  const profile = await readProfile(deps.fs, deps.key, recipientPersonId);
  const steering = [buildCoverageGuidance(profile), buildFeedbackGuidance(profile, deps.now)]
    .filter((s) => s.trim() !== '')
    .join('\n\n');

  const [insightFacts, session, askedPrompts, suppression] = await Promise.all([
    gatherRecipientInsightFacts(deps.fs, deps.key, recipientPersonId),
    getIntakeSession(deps.fs, deps.key, recipientPersonId),
    gatherRecipientAskedPrompts(deps.fs, deps.key, recipientPersonId),
    buildOwnSuppressionBlock(deps.fs, deps.key, recipientPersonId),
  ]);
  const intake = session ? formatIntakeForGeneration(session) : { text: '' };
  const grounding = [
    insightFacts.trim(),
    intake.text.trim() ? `Onboarding:\n${intake.text.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const call = await runClaude(
    deps,
    CANDIDATE_SYSTEM,
    buildCandidateUser(steering, grounding, suppression),
    'questionnaire.profile',
    1500,
  );
  if (!call.ok) return { ok: false, degraded: true, reason: call.reason };

  const rawArray = extractJsonArray(call.text) ?? salvageJsonArray(call.text);
  const parsed = tolerantArray(
    CandidateProposalSchema,
    CANDIDATE_SENTINEL,
    (c) => c.prompt.trim() !== '' && c.lifeArea.trim() !== '',
  ).parse(rawArray);
  // Empty/garbled reply → keep the last-good candidates (fail-safe), flag degraded.
  if (parsed.length === 0) return { ok: false, degraded: true, reason: 'MALFORMED' };

  const next = mergeCandidates(
    profile,
    parsed.map((c) => ({
      lifeArea: c.lifeArea.trim(),
      prompt: c.prompt.trim(),
      kind: c.kind,
      ...(c.topicId ? { topicId: c.topicId } : {}),
    })),
    askedPrompts,
    deps.now,
  );
  await writeProfile(deps.fs, deps.key, next);
  return { ok: true };
}

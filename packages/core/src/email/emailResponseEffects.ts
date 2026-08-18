import type { FileSystem } from '../host';
import type { MutualGreenLight } from '../schemas';
import { getPerson } from '../people/peopleService';
import { getAssignment } from '../questionnaires/assignmentService';
import { submitResponse, isAnswerable } from '../questionnaires/answerService';
import { analyzeAssignment } from '../questionnaires/analysisService';
import { listInsightsForPerson } from '../insights/insightStore';
import type { AiDeps } from '../questionnaires/aiCall';
import { allAdultAcknowledged } from '../together/adultGate';
import { getYnmOptIn } from '../together/ynmService';
import { pairKeyFor } from '../together/togetherService';
import { isTakenUp, listEmailResponses } from './emailResponse';
import { listEmailPartners } from './emailIntimacy';
import { listSentSuggestions } from './emailSuggestionService';

/**
 * The email response loop (67 §3.6) — what a drained tap DOES beyond being recorded. De-dup / resurface /
 * more-less tuning are READ at generation time from the response history (see `buildAvoidSet` + the prompt),
 * so they need no write here. This module owns the two effects that need cross-record work: the mutual green
 * light (a cross-partner match) and applying an embedded check-in answer (submit + analyze).
 */

/**
 * Compute the active person's mutual green lights (67 §3.6): shared suggestions where BOTH the person AND
 * the partner tapped `im-game` on their own copy (matched by `sharedSuggestionKey`). Reads across both
 * partners' vaults host-side (the master key decrypts all persons; this is core, not the IPC boundary — a
 * shared, mutually-consented intimacy signal, like `relationshipSynthesisService`).
 */
export async function computeMutualGreenLights(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<MutualGreenLight[]> {
  const [mySuggestions, myResponses] = await Promise.all([
    listSentSuggestions(fs, key, personId),
    listEmailResponses(fs, key, personId),
  ]);
  // Shared keys I said `im-game` to (join my response → my suggestion's sharedSuggestionKey + partner).
  const myById = new Map(mySuggestions.map((s) => [s.id, s]));
  const greenBySharedKey = new Map<string, { partnerId: string; text: string }>();
  for (const r of myResponses) {
    if (!isTakenUp(r) || !r.suggestionId) continue;
    const s = myById.get(r.suggestionId);
    if (s?.sharedSuggestionKey && s.partnerPersonId)
      greenBySharedKey.set(s.sharedSuggestionKey, { partnerId: s.partnerPersonId, text: s.text });
  }
  if (greenBySharedKey.size === 0) return [];

  // Green lights are intimacy suggestions (their shared key is `intimacy:<pairKey>`), so consent is
  // re-checked LIVE before surfacing — matching `resolveIntimacyEmailTarget`. After a break-up (partner→ex)
  // or a revoked Yes/No/Maybe opt-in, a stale "you're both up for this" must NOT persist.
  const livePartners = new Set((await listEmailPartners(fs, key, personId)).map((p) => p.id));

  const out: MutualGreenLight[] = [];
  for (const [sharedKey, mine] of greenBySharedKey) {
    if (!livePartners.has(mine.partnerId)) continue; // no longer a partner → revoked
    const pairKey = pairKeyFor(personId, mine.partnerId);
    const [partnerSuggestions, partnerResponses, partner, bothAcked, mineOptIn, theirsOptIn] =
      await Promise.all([
        listSentSuggestions(fs, key, mine.partnerId),
        listEmailResponses(fs, key, mine.partnerId),
        getPerson(fs, key, mine.partnerId),
        allAdultAcknowledged(fs, key, [personId, mine.partnerId]),
        getYnmOptIn(fs, key, personId, pairKey),
        getYnmOptIn(fs, key, mine.partnerId, pairKey),
      ]);
    if (!partner || !bothAcked || !mineOptIn || !theirsOptIn) continue; // consent revoked → no green light
    const partnerSharedIds = new Set(
      partnerSuggestions.filter((s) => s.sharedSuggestionKey === sharedKey).map((s) => s.id),
    );
    const partnerSaidYes = partnerResponses.some(
      (r) => isTakenUp(r) && r.suggestionId && partnerSharedIds.has(r.suggestionId),
    );
    if (partnerSaidYes)
      out.push({
        partnerId: mine.partnerId,
        partnerName: partner.displayName,
        label: mine.text,
        sharedSuggestionKey: sharedKey,
      });
  }
  return out;
}

/**
 * Apply drained embedded-check-in answers (67 §3.5) — for each `checkin-answer` response whose auto check-in
 * assignment isn't yet analyzed, record the answer (`submitResponse`) then analyze it (`analyzeAssignment`),
 * exactly as an in-app answer. The two effects are handled SEPARATELY + idempotently: an ANSWERABLE
 * assignment is submitted; the answer is then analyzed UNLESS an Insight for this assignment already exists.
 * `analyzeAssignment` doesn't flip the assignment status (it dedups by `provenance.assignmentId` but would
 * re-bill on every call), so the terminal signal is "an Insight exists" — that both prevents a re-bill loop
 * after a success AND retries a prior run whose analysis failed after the answer was recorded. Returns the
 * count analyzed this run.
 */
export async function applyEmailCheckinAnswers(deps: AiDeps, personId: string): Promise<number> {
  const { fs, key } = deps;
  const responses = await listEmailResponses(fs, key, personId);
  const seen = new Set<string>();
  let analyzed = 0;
  for (const r of responses) {
    if (r.kind !== 'checkin-answer' || !r.assignmentId || !r.questionId) continue;
    if (seen.has(r.assignmentId)) continue;
    seen.add(r.assignmentId);
    let assignment = await getAssignment(fs, key, r.assignmentId);
    if (!assignment) continue; // gone → skip
    // 1) Record the answer if still answerable (flips the assignment → submitted). Its own try/catch so a
    //    submit failure doesn't skip a DIFFERENT assignment's analysis.
    if (isAnswerable(assignment.status)) {
      try {
        await submitResponse(fs, key, {
          assignmentId: r.assignmentId,
          answers: [{ questionId: r.questionId, value: r.answer }],
        });
        assignment = await getAssignment(fs, key, r.assignmentId);
      } catch {
        continue; // submit failed → still answerable → retried next run
      }
    }
    // 2) Analyze — only once the answer is recorded AND no Insight exists yet for this assignment (the
    //    terminal signal, since analyzeAssignment doesn't set a status). Covers this run's fresh submit AND a
    //    prior run whose analysis failed after the answer was already recorded, without re-billing a success.
    if (!assignment || isAnswerable(assignment.status)) continue;
    const insights = await listInsightsForPerson(fs, key, assignment.senderPersonId);
    const alreadyAnalyzed = insights.some((i) => i.provenance.assignmentId === r.assignmentId);
    if (alreadyAnalyzed) continue;
    try {
      await analyzeAssignment(deps, { assignmentId: r.assignmentId });
      analyzed += 1;
    } catch {
      // Analysis failed (budget/transient) — the answer is recorded; retried next run.
    }
  }
  return analyzed;
}

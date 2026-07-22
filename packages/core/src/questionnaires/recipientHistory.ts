import type { FileSystem } from '../host';
import { getPerson } from '../people/peopleService';
import { listInsightsForPerson } from '../insights';
import { formatAnswerForDisplay, isDeclined, type AnswerValue } from './answering';
import { getAssignmentSnapshot, listAssignments } from './assignmentService';
import { getResponse } from './responseService';

/**
 * Gather a recipient's **full answered content** as de-dup grounding for AI generation (08-questionnaires
 * §17.4). Runs **host-side** (in the bridge, with the master key) and the result is fed to Claude ONLY so it
 * can skip what the recipient has already covered — the author never sees this text, and the generation
 * prompt forbids the model from quoting or alluding to it (avoid-not-reference). It unifies the four sources:
 * onboarding intake, Sessions, prior questionnaires, and profile/insights — because a person's Insights are
 * the distilled layer fed by intake/sessions/dreams/questionnaires, plus the actual prompts of questionnaires
 * already sent to them.
 *
 * Household recipients only (an external recipient has no household history — the caller skips this).
 */
export async function gatherRecipientHistory(
  fs: FileSystem,
  key: Uint8Array,
  recipientPersonId: string,
): Promise<string> {
  const parts: string[] = [];

  // Profile facts they've already given.
  const person = await getPerson(fs, key, recipientPersonId);
  if (person) {
    const profile: string[] = [];
    if (person.occupation) profile.push(`occupation: ${person.occupation}`);
    if (person.location) profile.push(`location: ${person.location}`);
    if (person.relationshipStatus)
      profile.push(`relationship status: ${person.relationshipStatus}`);
    if (person.parentalStatus) profile.push(`parental status: ${person.parentalStatus}`);
    if (person.goals) profile.push(`goals: ${person.goals}`);
    if (person.interests?.length) profile.push(`interests: ${person.interests.join(', ')}`);
    if (person.values?.length) profile.push(`values: ${person.values.join(', ')}`);
    if (profile.length) parts.push(`Profile they've already shared — ${profile.join('; ')}.`);
  }

  // Everything they've reflected on (intake portrait, sessions, dreams, prior questionnaire analyses all
  // distil into their own Insights). Bounded to the most recent set to keep the prompt economical.
  const facts = await gatherRecipientInsightFacts(fs, key, recipientPersonId);
  if (facts.trim()) parts.push(facts);

  // The exact questions they've ALREADY been asked (so we never repeat a prompt across questionnaires).
  const prompts = await gatherRecipientAskedPrompts(fs, key, recipientPersonId);
  if (prompts.length) {
    parts.push('Questions they have already been asked (do NOT repeat these):');
    for (const p of prompts.slice(0, 40)) parts.push(`- ${p}`);
  }

  return parts.join('\n');
}

/**
 * The recipient's distilled Insight summaries + facts (08-questionnaires §24.3-A2) — everything the app has
 * learned about them across intake, sessions, dreams, tests, Together, and prior questionnaire analyses. Fed
 * into the SEMANTIC de-dup reference (so a fact revealed in a session or a kink test can't be re-asked) AND used
 * to personalize. Bounded to the most recent set; host-side, author-blind.
 */
export async function gatherRecipientInsightFacts(
  fs: FileSystem,
  key: Uint8Array,
  recipientPersonId: string,
): Promise<string> {
  const insights = await listInsightsForPerson(fs, key, recipientPersonId);
  if (insights.length === 0) return '';
  const lines: string[] = [
    'Themes they have already explored (from sessions, reflections, tests, dreams):',
  ];
  for (const insight of insights.slice(0, 15)) {
    lines.push(`- ${insight.summary}`);
    for (const fact of insight.facts.slice(0, 5)) lines.push(`  • ${fact.text}`);
  }
  return lines.join('\n');
}

/**
 * The exact prompts a recipient has already been asked across every prior questionnaire (08-questionnaires
 * §23.5) — the structured list that drives the deterministic hard near-duplicate FILTER in generation (distinct
 * from the formatted `gatherRecipientHistory` text that drives the model). Deduped, host-side, author-blind.
 */
export async function gatherRecipientAskedPrompts(
  fs: FileSystem,
  key: Uint8Array,
  recipientPersonId: string,
): Promise<string[]> {
  const asked = await listAssignments(fs, key, { recipientPersonId });
  const prompts = new Set<string>();
  for (const assignment of asked) {
    const snapshot = await getAssignmentSnapshot(fs, key, assignment.id);
    if (!snapshot) continue;
    for (const q of snapshot.questions) {
      const p = q.prompt.trim();
      if (p) prompts.add(p);
    }
  }
  return [...prompts];
}

/**
 * Gather the recipient's actual ANSWERS to prior questionnaires (08-questionnaires §24.3-A1) — the raw
 * question→answer pairs, so de-dup knows exactly what they already told us, not just which questions were
 * asked. Decrypts each `ResponseSet` host-side; author-blind (fed only to the de-dup pass, never returned).
 * This finally implements the §19.1 claim (prior answers, not just prompts). Household recipients only.
 */
/**
 * Assemble the DEDICATED, prioritized de-dup reference for the semantic pass (08-questionnaires §23.5b) from
 * the four already-gathered sources — a PURE function so every mint path shares one budgeting rule and can't
 * drift (the auto-checkin engine, the manual bridge, and Your Story's biographer check-ins all call it).
 *
 * Each section gets its OWN character budget so a heavy onboarding can't truncate away the prior-questionnaire
 * answers or the session/dream/test insight facts (the §23.5b bug this exists to prevent). Onboarding leads
 * because it is the authoritative "we already have data for this". Empty sections drop out.
 */
export function buildDedupReference(inputs: {
  /** `formatIntakeForGeneration(session).text` — the recipient's raw onboarding answers. */
  intakeText: string;
  /** `gatherRecipientPriorAnswers` — raw Q→A from prior questionnaires. */
  priorAnswers: string;
  /** `gatherRecipientInsightFacts` — distilled facts from sessions/dreams/tests/etc. */
  insightFacts: string;
  /** `gatherRecipientAskedPrompts` — the exact prompts already asked. */
  priorPrompts: readonly string[];
}): string {
  const cap = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}\n…` : s);
  const intake = inputs.intakeText.trim();
  const priorAnswers = inputs.priorAnswers.trim();
  const insightFacts = inputs.insightFacts.trim();
  return [
    intake
      ? `ALREADY ANSWERED in their onboarding — do NOT re-ask ANY of this, including specific sub-preferences, acts, positions, kinks, and options they selected (e.g. MMF/FFM, particular porn genres, yes/no on an act):\n${cap(intake, 14000)}`
      : '',
    priorAnswers
      ? `ALREADY ANSWERED in prior questionnaires (do NOT re-ask any of this):\n${cap(priorAnswers, 4000)}`
      : '',
    insightFacts
      ? `ALREADY KNOWN about them from sessions, reflections, tests, and dreams (do NOT re-ask these):\n${cap(insightFacts, 3000)}`
      : '',
    inputs.priorPrompts.length
      ? `ALREADY ASKED in prior questionnaires:\n${cap(inputs.priorPrompts.map((p) => `- ${p}`).join('\n'), 2000)}`
      : '',
  ]
    .filter((s) => s.trim() !== '')
    .join('\n\n');
}

/**
 * The TITLES of every questionnaire already sent to a recipient (08-questionnaires §23.5 / gap-finder). A
 * questionnaire's title captures its TOPIC, so this is the topic-level de-dup signal fed to the gap-finder as
 * `avoidSuggestions` — so it proposes a genuinely NEW area instead of re-suggesting a covered one (the layer
 * question-level de-dup can't help with: a whole questionnaire on an already-covered topic). Deduped,
 * host-side, author-blind. Household recipients only.
 */
export async function gatherRecipientQuestionnaireTitles(
  fs: FileSystem,
  key: Uint8Array,
  recipientPersonId: string,
): Promise<string[]> {
  const asked = await listAssignments(fs, key, { recipientPersonId });
  const titles = new Set<string>();
  for (const assignment of asked) {
    const snapshot = await getAssignmentSnapshot(fs, key, assignment.id);
    const title = snapshot?.title.trim();
    if (title) titles.add(title);
  }
  return [...titles];
}

/**
 * The INTIMACY questionnaires already sent to a recipient, one entry each, as `{ text, at }` — the signal the
 * intimacy coverage map (08 §27.2) uses to work out which ground has already been covered.
 *
 * One entry per questionnaire (title + all its prompts joined), NOT per question: coverage counts how many
 * CHECK-INS worked a category, so `SATURATION_ASKS` means "three check-ins on this ground", not three
 * questions. Sensitive types/tiers only — a general check-in that happens to mention a body part is not
 * intimacy ground. Host-side, author-blind. Household recipients only.
 */
export async function gatherRecipientIntimacyAsks(
  fs: FileSystem,
  key: Uint8Array,
  recipientPersonId: string,
): Promise<{ text: string; at?: string }[]> {
  const asked = await listAssignments(fs, key, { recipientPersonId });
  const out: { text: string; at?: string }[] = [];
  for (const assignment of asked) {
    const snapshot = await getAssignmentSnapshot(fs, key, assignment.id);
    if (!snapshot) continue;
    const sensitive =
      snapshot.type === 'intimacy' ||
      snapshot.type === 'scenario' ||
      snapshot.sensitivity === 'explicit' ||
      snapshot.sensitivity === 'unfiltered' ||
      snapshot.sensitivity === 'intimacyGeneral';
    if (!sensitive) continue;
    const text = [snapshot.title, ...snapshot.questions.map((q) => q.prompt)]
      .map((s) => s.trim())
      .filter((s) => s !== '')
      .join(' ');
    if (text === '') continue;
    out.push({ text, ...(assignment.createdAt ? { at: assignment.createdAt } : {}) });
  }
  return out;
}

/**
 * The recipient's newest Insight timestamp — the "new material has landed" signal that RE-OPENS worked-through
 * intimacy ground (08 §27.4). An Insight is the distilled layer fed by intake/sessions/dreams/questionnaires,
 * so its newest timestamp covers all four sources in one cheap read. Absent → that re-open signal never fires.
 *
 * The sibling `profileEditedAt` signal is supplied by the CALLER from the intake session's `updatedAt` — it is
 * not read here because `questionnaires → intake` would be an import cycle (intake already imports this
 * package's `answering`), and every caller already loads the session for `formatIntakeForGeneration`.
 */
export async function gatherRecipientMaterialSignals(
  fs: FileSystem,
  key: Uint8Array,
  recipientPersonId: string,
): Promise<{ newMaterialAt?: string }> {
  const insights = await listInsightsForPerson(fs, key, recipientPersonId);
  let newest: string | undefined;
  for (const insight of insights) {
    const at = insight.updatedAt || insight.createdAt;
    if (at && (newest === undefined || at > newest)) newest = at;
  }
  return newest !== undefined ? { newMaterialAt: newest } : {};
}

/** One answered questionnaire's Q→A block, with the provenance a corpus item needs (64 §15.2). */
export interface RecipientAnswerBlock {
  /** The send this came from — the stable id a `StorySourceRef {kind:'response'}` cites. */
  assignmentId: string;
  /** The as-sent title (from the frozen snapshot), e.g. for the corpus label. */
  title: string;
  /** When they submitted it, when known — chronology for the biography. */
  submittedAt?: string;
  /** The formatted `Q: … / A: …` lines for this questionnaire (never empty). */
  text: string;
}

/**
 * Every answered questionnaire the person has responded to, ONE block each (64 §15.2). Declined questions
 * (§25.5) carry no answer content and are dropped — never fed as biography material or as "known data".
 *
 * This is the granular read; `gatherRecipientPriorAnswers` joins it for the de-dup path, so the two can
 * never drift.
 */
export async function gatherRecipientPriorAnswersByAssignment(
  fs: FileSystem,
  key: Uint8Array,
  recipientPersonId: string,
): Promise<RecipientAnswerBlock[]> {
  const asked = await listAssignments(fs, key, { recipientPersonId });
  const blocks: RecipientAnswerBlock[] = [];
  for (const assignment of asked) {
    const snapshot = await getAssignmentSnapshot(fs, key, assignment.id);
    if (!snapshot) continue;
    const response = await getResponse(fs, key, assignment.id);
    if (!response || response.answers.length === 0) continue;
    const byId = new Map(response.answers.map((a) => [a.questionId, a.value]));
    const lines: string[] = [];
    for (const q of snapshot.questions) {
      if (!byId.has(q.id)) continue;
      // A per-question decline (§25.5) carries no answer content — never feed "Skipped" as biography
      // material (Your Story) or as "known data" the recipient told us (generation de-dup).
      if (isDeclined(byId.get(q.id) as AnswerValue | undefined)) continue;
      const display = formatAnswerForDisplay(q, byId.get(q.id)).trim();
      if (display) lines.push(`  Q: ${q.prompt}\n  A: ${display}`);
    }
    if (lines.length > 0) {
      blocks.push({
        assignmentId: assignment.id,
        title: snapshot.title,
        ...(response.submittedAt ? { submittedAt: response.submittedAt } : {}),
        text: lines.join('\n'),
      });
    }
  }
  return blocks;
}

/**
 * How many questionnaires the person actually ANSWERED (64 §15.2) — the cheap count behind the invitation's
 * chip row. Deliberately does NOT decrypt each frozen snapshot the way
 * `gatherRecipientPriorAnswersByAssignment` must: a count only needs to know a response exists and carries
 * at least one non-declined answer, which halves the reads on a person with a long auto-check-in history.
 */
export async function countAnsweredQuestionnaires(
  fs: FileSystem,
  key: Uint8Array,
  recipientPersonId: string,
): Promise<number> {
  const asked = await listAssignments(fs, key, { recipientPersonId });
  let count = 0;
  for (const assignment of asked) {
    const response = await getResponse(fs, key, assignment.id);
    if (!response) continue;
    // A wholly-declined response feeds nothing, so it isn't material the book can draw on (§25.5).
    if (response.answers.some((a) => !isDeclined(a.value))) count += 1;
  }
  return count;
}

/** The whole answer history as ONE string (the de-dup reference). Byte-identical to the pre-§15.2 output. */
export async function gatherRecipientPriorAnswers(
  fs: FileSystem,
  key: Uint8Array,
  recipientPersonId: string,
): Promise<string> {
  const blocks = await gatherRecipientPriorAnswersByAssignment(fs, key, recipientPersonId);
  return blocks.map((b) => `From "${b.title}":\n${b.text}`).join('\n\n');
}

import type { FileSystem } from '../host';
import { getPerson } from '../people/peopleService';
import { listInsightsForPerson } from '../insights';
import { formatAnswerForDisplay } from './answering';
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
export async function gatherRecipientPriorAnswers(
  fs: FileSystem,
  key: Uint8Array,
  recipientPersonId: string,
): Promise<string> {
  const asked = await listAssignments(fs, key, { recipientPersonId });
  const blocks: string[] = [];
  for (const assignment of asked) {
    const snapshot = await getAssignmentSnapshot(fs, key, assignment.id);
    if (!snapshot) continue;
    const response = await getResponse(fs, key, assignment.id);
    if (!response || response.answers.length === 0) continue;
    const byId = new Map(response.answers.map((a) => [a.questionId, a.value]));
    const lines: string[] = [];
    for (const q of snapshot.questions) {
      if (!byId.has(q.id)) continue;
      const display = formatAnswerForDisplay(q, byId.get(q.id)).trim();
      if (display) lines.push(`  Q: ${q.prompt}\n  A: ${display}`);
    }
    if (lines.length > 0) blocks.push(`From "${snapshot.title}":\n${lines.join('\n')}`);
  }
  return blocks.join('\n\n');
}

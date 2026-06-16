import type { FileSystem } from '../host';
import { getPerson } from '../people/peopleService';
import { listInsightsForPerson } from '../insights';
import { getAssignmentSnapshot, listAssignments } from './assignmentService';

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
  const insights = await listInsightsForPerson(fs, key, recipientPersonId);
  if (insights.length) {
    parts.push('Themes they have already explored:');
    for (const insight of insights.slice(0, 15)) {
      parts.push(`- ${insight.summary}`);
      for (const fact of insight.facts.slice(0, 5)) parts.push(`  • ${fact.text}`);
    }
  }

  // The exact questions they've ALREADY been asked (so we never repeat a prompt across questionnaires).
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
  if (prompts.size) {
    parts.push('Questions they have already been asked (do NOT repeat these):');
    for (const p of [...prompts].slice(0, 40)) parts.push(`- ${p}`);
  }

  return parts.join('\n');
}

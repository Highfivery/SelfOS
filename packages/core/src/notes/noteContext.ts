import type { FileSystem } from '../host';
import { listGoals } from '../goals/goalService';
import { listInsightsForPerson } from '../insights/insightStore';
import { getIntakeSession } from '../intake/intakeService';
import { getPerson } from '../people/peopleService';
import type { Person } from '../schemas';

/**
 * The recipient digest a note is drafted from (76 §5.2).
 *
 * ── This is the ONE place in SelfOS that reads a person's record without the sharing gate. ──
 *
 * Everywhere else, what reaches another person is filtered: `factSharedWithViewer` drops `restricted`
 * and flagged facts, `isPersonFieldShared` honours `privateFields`, and `summarizeForContext` applies
 * the sensitive-life-area relevance gate. None of that applies here. It is a deliberate owner decision
 * (2026-08-21) and it is confined to this function — every other cross-person path keeps its gate, and
 * their tests must stay green.
 *
 * The bound is what already ships: the Owner is the full-access role and can read all of this directly
 * today. What is new is that it can now reach a generated message.
 *
 * Every read is individually guarded. A missing or corrupt source must degrade the draft, never fail
 * it — a note the owner can't write because one file is unreadable is a worse outcome than a thinner
 * note.
 */

const CAP = 2400; // the whole digest, so one enormous portrait can't crowd out everything else

async function safe<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

/** Profile lines — every field, locked or not. `privateFields` is deliberately not consulted. */
function profileLines(person: Person): string[] {
  const out: string[] = [];
  const add = (label: string, value: string | undefined): void => {
    if (value && value.trim()) out.push(`${label}: ${value.trim()}`);
  };
  add('Pronouns', person.pronouns);
  add('Occupation', person.occupation);
  add('Location', person.location);
  add('Relationship status', person.relationshipStatus);
  add('Children', person.parentalStatus);
  add('Living situation', person.livingSituation);
  add('Goals they named', person.goals);
  add('How they like to be talked to', person.communicationStyle);
  add('Faith', person.faith);
  add('Health notes', person.healthNotes);
  if (person.interests?.length) add('Interests', person.interests.join(', '));
  if (person.values?.length) add('Values', person.values.join(', '));
  add('Notes', person.notes);
  return out;
}

export interface NoteContext {
  recipientName: string;
  /** The assembled digest, ready to drop into a prompt. Empty when there is genuinely nothing on file. */
  digest: string;
}

export async function buildNoteContext(
  fs: FileSystem,
  key: Uint8Array,
  recipientPersonId: string,
): Promise<NoteContext> {
  // The id comes from the renderer and lands in a path. `getPerson` has no guard of its own and the
  // node FileSystem resolves with a bare `join`, which NORMALIZES `..` rather than refusing it — the
  // 2026-08-14 `pathSafety` lesson. This is the one function that performs the unfiltered read, so it
  // is the last place that should be trusting a caller-supplied segment.
  if (!/^[A-Za-z0-9_-]+$/.test(recipientPersonId)) {
    return { recipientName: 'them', digest: '' };
  }
  const person = await safe(() => getPerson(fs, key, recipientPersonId), null);
  const recipientName = person?.displayName ?? 'them';

  const sections: string[] = [];

  if (person) {
    const lines = profileLines(person);
    if (lines.length > 0) sections.push(`WHO THEY ARE\n${lines.join('\n')}`);
  }

  // The onboarding portrait — the single richest description of a person in the app.
  const intake = await safe(() => getIntakeSession(fs, key, recipientPersonId), null);
  if (intake?.portrait?.trim()) sections.push(`THEIR PORTRAIT\n${intake.portrait.trim()}`);

  // Insights: their own approved ones. Restricted facts included — that is the point of this function.
  //
  // NOTE the coarseness: `listInsightsForPerson` uses `.parse`, so ONE corrupt insight throws and this
  // guard drops the WHOLE section rather than that record. That is a real degradation, not a no-op —
  // it cost time to find during development precisely because it is silent. It is kept because a note
  // the owner cannot write at all is worse than a thinner one, but a richer read belongs here later.
  const insights = await safe(() => listInsightsForPerson(fs, key, recipientPersonId), []);
  const approved = insights
    .filter((i) => i.approved)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 12);
  if (approved.length > 0) {
    const lines = approved.map((i) => {
      const facts = i.facts
        .filter((f) => !f.flaggedInaccurate)
        .map((f) => f.text)
        .slice(0, 4);
      return `- ${i.summary}${facts.length ? ` (${facts.join('; ')})` : ''}`;
    });
    sections.push(`WHAT SELFOS HAS LEARNED\n${lines.join('\n')}`);
  }

  const goals = await safe(() => listGoals(fs, key, recipientPersonId), []);
  const open = goals.filter((g) => g.status === 'open' || g.status === 'inProgress').slice(0, 6);
  if (open.length > 0) {
    sections.push(`WHAT THEY'RE WORKING ON\n${open.map((g) => `- ${g.text}`).join('\n')}`);
  }

  let digest = sections.join('\n\n');
  if (digest.length > CAP) digest = `${digest.slice(0, CAP)}\n…`;

  return { recipientName, digest };
}

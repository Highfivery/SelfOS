import type { FileSystem } from '../host';
import { listInsightsForPerson, summarizeForContext } from '../insights';
import type { Person } from '../schemas';
import { getPerson, listPeople } from './peopleService';
import { listRelationships } from './relationshipService';

/**
 * The SHAREABLE descriptive profile fields (13-dream-images §4.6) formatted as "Label: value" lines — the
 * same "may feed others' AI" bucket as `publicNotes` (04 §3.4). Used both for the person's own context and
 * for the people they relate to. `birthday` is intentionally NOT surfaced here (it's reused for the
 * image-depiction's exact age, 13 §5.2, not narrated into chat context).
 */
export function shareableProfileLines(person: Person): string[] {
  const lines: string[] = [];
  const add = (label: string, value: string | undefined): void => {
    const trimmed = value?.trim();
    if (trimmed) lines.push(`${label}: ${trimmed}`);
  };
  add('Gender', person.gender);
  add('Appearance', person.appearanceDescription);
  add('Ethnicity', person.ethnicity);
  add('Occupation', person.occupation);
  if (person.interests?.length) add('Interests', person.interests.join(', '));
  add('Location', person.location);
  add('Goals', person.goals);
  add('Communication style', person.communicationStyle);
  if (person.values?.length) add('Values', person.values.join(', '));
  if (person.languages?.length) add('Languages', person.languages.join(', '));
  if (person.importantDates?.length)
    add('Important dates', person.importantDates.map((d) => `${d.label} (${d.date})`).join(', '));
  return lines;
}

/**
 * The PRIVATE descriptive fields (13-dream-images §4.6) — surfaced ONLY in the person's own context block,
 * never about a related/linked person (the shareable-vs-private boundary, like `privateNotes`). Never sent
 * to the image provider (13 §8.2).
 */
export function privateProfileLines(person: Person): string[] {
  const lines: string[] = [];
  if (person.healthNotes?.trim()) lines.push(`Health notes: ${person.healthNotes.trim()}`);
  if (person.faith?.trim()) lines.push(`Faith: ${person.faith.trim()}`);
  return lines;
}

/**
 * Assemble the AI context block for a person's session (04-people-roles §3.4). Includes the person's
 * OWN full profile (their session, their data) plus only the **shareable** facts about the people they
 * relate to — other people's private notes are never included. The chat proxy feeds this to Claude.
 */
export async function buildContext(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<string> {
  const person = await getPerson(fs, key, personId);
  if (!person) return '';

  const people = await listPeople(fs, key);
  const relationships = await listRelationships(fs, key);
  const byId = new Map(people.map((candidate) => [candidate.id, candidate]));

  const lines: string[] = [];
  lines.push(
    `You are supporting ${person.displayName}${person.pronouns ? ` (${person.pronouns})` : ''}.`,
  );
  if (person.publicNotes) lines.push(`About them: ${person.publicNotes}`);
  // Their own shareable descriptive fields (13 §4.6) — part of their own full profile.
  for (const line of shareableProfileLines(person)) lines.push(`  ${line}`);
  if (person.privateNotes) lines.push(`Private (their own): ${person.privateNotes}`);
  // Their own private descriptive fields — only in their own context, never about a related person.
  for (const line of privateProfileLines(person)) lines.push(`  ${line}`);

  const theirs = relationships.filter(
    (relationship) =>
      relationship.fromPersonId === personId || relationship.toPersonId === personId,
  );
  const related: { id: string; displayName: string }[] = [];
  if (theirs.length > 0) {
    lines.push('People in their life:');
    for (const relationship of theirs) {
      const otherId =
        relationship.fromPersonId === personId
          ? relationship.toPersonId
          : relationship.fromPersonId;
      const other = byId.get(otherId);
      if (!other) continue;
      related.push({ id: other.id, displayName: other.displayName });
      // Only shareable data about others — never their private notes.
      const about = other.publicNotes ? ` — ${other.publicNotes}` : '';
      const aboutRel = relationship.publicNotes ? ` (${relationship.publicNotes})` : '';
      lines.push(`- ${other.displayName} (${relationship.type})${about}${aboutRel}`);
      // Their shareable descriptive fields (13 §4.6) — never their private health/faith.
      for (const line of shareableProfileLines(other)) lines.push(`  · ${line}`);
    }
  }

  // Insight / memory layer (08-questionnaires §4.4): their own approved insights + shareable facts about
  // the people they relate to. Others' private facts are never included (the shareable-vs-private split).
  const insightContext = await summarizeForContext(fs, key, personId, related);
  if (insightContext) lines.push(insightContext);

  return lines.join('\n');
}

/**
 * The distinct people a person has a relationship with (the share-target set for per-dream sharing,
 * 12-dreams §3.4): a shareable/targeted fact on this person's Insight only reaches someone they relate to.
 * This is the de-duped share-target view of the same relationship traversal `buildContext` does inline
 * above — kept separate so the tested context path stays untouched; they must stay in lockstep.
 */
export async function listRelatedPeople(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<{ id: string; displayName: string }[]> {
  const people = await listPeople(fs, key);
  const byId = new Map(people.map((candidate) => [candidate.id, candidate]));
  const out: { id: string; displayName: string }[] = [];
  const seen = new Set<string>();
  for (const relationship of await listRelationships(fs, key)) {
    if (relationship.fromPersonId !== personId && relationship.toPersonId !== personId) continue;
    const otherId =
      relationship.fromPersonId === personId ? relationship.toPersonId : relationship.fromPersonId;
    if (seen.has(otherId)) continue;
    const other = byId.get(otherId);
    if (!other) continue;
    seen.add(otherId);
    out.push({ id: other.id, displayName: other.displayName });
  }
  return out;
}

/** Exact age in whole years from an ISO `birthday` as of `now`; null if unparseable or in the future. */
export function ageFromBirthday(birthday: string, now: Date): number | null {
  const born = new Date(birthday);
  if (Number.isNaN(born.getTime())) return null;
  let age = now.getFullYear() - born.getFullYear();
  const monthDelta = now.getMonth() - born.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

/**
 * A **name-free** physical depiction of a People-graph-linked person, from the **shareable** subset only
 * (appearance + gender + ethnicity + exact age from `birthday`) — the single place the dream-image
 * depiction subset is assembled (13-dream-images §5.2/§8.2). It NEVER includes the person's name, their
 * notes, or any private field (`privateNotes`/`healthNotes`/`faith`), so a figure can resemble someone the
 * dreamer knows without naming or exposing them. Returns '' when there's nothing depictable (or the person
 * is unknown). The name-exclusion is structural: the displayName is never read into the returned string.
 */
export async function buildDepictionNote(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  now: Date,
): Promise<string> {
  const person = (await listPeople(fs, key)).find((candidate) => candidate.id === personId);
  if (!person) return '';
  const parts: string[] = [];
  if (person.appearanceDescription?.trim())
    parts.push(`appearance: ${person.appearanceDescription.trim()}`);
  if (person.gender?.trim()) parts.push(`gender: ${person.gender.trim()}`);
  if (person.birthday) {
    const age = ageFromBirthday(person.birthday, now);
    if (age !== null) parts.push(`age ${age}`);
  }
  if (person.ethnicity?.trim()) parts.push(`ethnicity: ${person.ethnicity.trim()}`);
  return parts.length > 0 ? `a figure — ${parts.join(', ')}` : '';
}

const MAX_LINKED_FACTS_PER_PERSON = 5;

/**
 * The shareable context for a specific set of **People-graph-linked** people — used to foreground who from
 * the viewer's life appeared in a given dream (12-dreams §3.1/§5.1). For each known `personId`, surfaces
 * their display name, the relationship to the viewer (type + relationship public notes) when one exists,
 * their **public** notes, and the **shareable** facts from their approved insights (broadcast `shareable`
 * OR `shareableWith` targeted at the viewer). It is the **shareable-vs-private** boundary (04 §3.4 / 12
 * §8.4) applied to dream people: a linked person's **private notes and non-shareable facts are never
 * included**, even if they aren't a relationship-graph relation. Returns formatted lines, or '' when there
 * is nothing shareable to add. Unknown ids and refs without a `personId` (free names) are skipped — those
 * are already in the dream narrative.
 */
export async function buildLinkedPeopleContext(
  fs: FileSystem,
  key: Uint8Array,
  viewerId: string,
  personIds: string[],
): Promise<string> {
  const ids = [...new Set(personIds.filter((id) => id && id !== viewerId))];
  if (ids.length === 0) return '';

  const byId = new Map((await listPeople(fs, key)).map((candidate) => [candidate.id, candidate]));
  const relationships = await listRelationships(fs, key);

  const lines: string[] = [];
  for (const id of ids) {
    const person = byId.get(id);
    if (!person) continue;
    const relationship = relationships.find(
      (r) =>
        (r.fromPersonId === viewerId && r.toPersonId === id) ||
        (r.fromPersonId === id && r.toPersonId === viewerId),
    );
    const relType = relationship ? ` (${relationship.type})` : '';
    const about = person.publicNotes ? ` — ${person.publicNotes}` : '';
    const aboutRel = relationship?.publicNotes ? ` (${relationship.publicNotes})` : '';
    lines.push(`- ${person.displayName}${relType}${about}${aboutRel}`);
    // Their shareable descriptive fields (13 §4.6) — never their private health/faith.
    for (const line of shareableProfileLines(person)) lines.push(`  · ${line}`);
    // Only shareable facts about them — never their private/non-shareable facts (the privacy boundary).
    const facts = (await listInsightsForPerson(fs, key, id))
      .filter((insight) => insight.approved)
      .flatMap((insight) =>
        insight.facts.filter(
          (fact) => fact.shareable || (fact.shareableWith?.includes(viewerId) ?? false),
        ),
      )
      .slice(0, MAX_LINKED_FACTS_PER_PERSON);
    for (const fact of facts) lines.push(`  · ${fact.text}`);
  }

  if (lines.length === 0) return '';
  return ['People from your life who appeared in this dream:', ...lines].join('\n');
}

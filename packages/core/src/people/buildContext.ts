import type { FileSystem } from '../host';
import { summarizeOpenCommitments } from '../goals';
import {
  insightFeedsContext,
  listInsightsForPerson,
  summarizeForContext,
  type RelatedForContext,
} from '../insights';
import {
  factSharedWithViewer,
  isPersonFieldShared,
  type ContextTopic,
  type Person,
  type PersonFieldKey,
} from '../schemas';
import { confidentialityPreamble } from '../sharing';
import { getPerson, listPeople } from './peopleService';
import { listRelationships } from './relationshipService';
import { relationshipTypesFromSubjectToViewer } from './relationshipScope';
import { buildSharedIntakeAnswerLines } from './sharedIntakeAnswers';

/**
 * A person's descriptive profile fields (13-dream-images §4.6) formatted as "Label: value" lines, gated by
 * per-item shareability (15-shareability §4.1/§5). `audience: 'self'` emits every populated field (it's
 * their own coaching context — all their data is used); `'others'` emits only fields the owner has left
 * **shared** (`isPersonFieldShared`). `pronouns` (in the name line) and `birthday` (depiction-only age, 13
 * §5.2) are handled by the callers, not here.
 */
export function profileLines(person: Person, audience: 'self' | 'others'): string[] {
  const lines: string[] = [];
  const shows = (key: PersonFieldKey): boolean =>
    audience === 'self' || isPersonFieldShared(person, key);
  const add = (key: PersonFieldKey, label: string, value: string | undefined): void => {
    const trimmed = value?.trim();
    if (trimmed && shows(key)) lines.push(`${label}: ${trimmed}`);
  };
  const addList = (key: PersonFieldKey, label: string, values: string[] | undefined): void => {
    if (values?.length && shows(key)) lines.push(`${label}: ${values.join(', ')}`);
  };
  add('gender', 'Gender', person.gender);
  add('appearanceDescription', 'Appearance', person.appearanceDescription);
  add('ethnicity', 'Ethnicity', person.ethnicity);
  add('occupation', 'Occupation', person.occupation);
  add('relationshipStatus', 'Relationship status', person.relationshipStatus);
  add('parentalStatus', 'Children', person.parentalStatus);
  add('livingSituation', 'Living situation', person.livingSituation);
  add('sexualOrientation', 'Sexual orientation', person.sexualOrientation);
  add('relationshipStyle', 'Relationship style', person.relationshipStyle);
  addList('interests', 'Interests', person.interests);
  add('location', 'Location', person.location);
  add('goals', 'Goals', person.goals);
  add('communicationStyle', 'Communication style', person.communicationStyle);
  addList('values', 'Values', person.values);
  addList('languages', 'Languages', person.languages);
  if (person.importantDates?.length && shows('importantDates'))
    lines.push(
      `Important dates: ${person.importantDates.map((d) => `${d.label} (${d.date})`).join(', ')}`,
    );
  add('notes', 'Notes', person.notes);
  add('healthNotes', 'Health notes', person.healthNotes);
  add('faith', 'Faith', person.faith);
  return lines;
}

/** A related person's shared pronouns suffix for their context line, or '' (locked / unset). */
function sharedPronouns(person: Person): string {
  return person.pronouns?.trim() && isPersonFieldShared(person, 'pronouns')
    ? ` [${person.pronouns.trim()}]`
    : '';
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
  // The call's topic (28-portrait-synthesis-optimization §pillar-2): when present, the pinned onboarding
  // portrait emits the facts relevant to these life-areas (+ the always-on core). Absent ⇒ core + fill.
  topic?: ContextTopic,
  // 58-together §6.3 — code-enforced restricted exclusion for Together couples prompts (default OFF, so every
  // solo caller is byte-identical). Threaded into `summarizeForContext` → the own-insight fact filter.
  options?: { excludeRestricted?: boolean },
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
  // Their own full profile — every populated field, including ones they've locked from others (it's their
  // own coaching context). Notes/health/faith are now part of `profileLines` (15-shareability §4.1/§4.3).
  for (const line of profileLines(person, 'self')) lines.push(`  ${line}`);

  const theirs = relationships.filter(
    (relationship) =>
      relationship.fromPersonId === personId || relationship.toPersonId === personId,
  );
  const related: RelatedForContext[] = [];
  const seenRelated = new Set<string>();
  if (theirs.length > 0) {
    lines.push('People in their life:');
    for (const relationship of theirs) {
      const otherId =
        relationship.fromPersonId === personId
          ? relationship.toPersonId
          : relationship.fromPersonId;
      const other = byId.get(otherId);
      if (!other) continue;
      // Resolve cross-sharing ONCE per related person, even with several edges (42 §5.2): the type(s)
      // describing how the related person relates to THIS viewer, and their shared structured intake answers.
      if (!seenRelated.has(other.id)) {
        seenRelated.add(other.id);
        const grantedTypes = relationshipTypesFromSubjectToViewer(
          other.id,
          personId,
          relationships,
        );
        const sharedAnswerLines = await buildSharedIntakeAnswerLines(
          fs,
          key,
          other.id,
          grantedTypes,
        );
        related.push({
          id: other.id,
          displayName: other.displayName,
          grantedTypes,
          ...(sharedAnswerLines.length > 0 ? { sharedAnswerLines } : {}),
        });
      }
      // Only data the owner has left SHARED reaches a related person's context (15-shareability §5). The
      // relationship's notes flow only when `notesShared !== false`.
      const relNote =
        other && relationship.notes && relationship.notesShared !== false
          ? ` (${relationship.notes})`
          : '';
      lines.push(`- ${other.displayName} (${relationship.type})${sharedPronouns(other)}${relNote}`);
      for (const line of profileLines(other, 'others')) lines.push(`  · ${line}`);
    }
  }

  // Insight / memory layer (08-questionnaires §4.4): their own approved insights + shareable facts about
  // the people they relate to. Others' private facts are never included (the shareable-vs-private split).
  const insightContext = await summarizeForContext(
    fs,
    key,
    personId,
    related,
    topic,
    person.displayName,
    options,
  );
  if (insightContext) lines.push(insightContext);

  // Open commitments (39-living-memory §5.2): a small bounded grounding line so the coach is AWARE of the
  // person's tracked goals. Awareness only — the proactive follow-up/nudging is spec 40. Per-subject; behind
  // the same context bound. `new Date()` is correct here — this is the live, time-of-call context assembly.
  const commitments = await summarizeOpenCommitments(fs, key, personId, new Date());
  if (commitments) lines.push(commitments);

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
 * dreamer knows without naming or exposing them. Each depiction part is gated by per-field shareability
 * (15-shareability §3.4/§5): a locked appearance/gender/ethnicity/birthday is withheld from the image too.
 * Returns '' when there's nothing depictable (or the person is unknown). The name-exclusion is structural:
 * the displayName is never read into the returned string.
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
  if (person.appearanceDescription?.trim() && isPersonFieldShared(person, 'appearanceDescription'))
    parts.push(`appearance: ${person.appearanceDescription.trim()}`);
  if (person.gender?.trim() && isPersonFieldShared(person, 'gender'))
    parts.push(`gender: ${person.gender.trim()}`);
  if (person.birthday && isPersonFieldShared(person, 'birthday')) {
    const age = ageFromBirthday(person.birthday, now);
    if (age !== null) parts.push(`age ${age}`);
  }
  if (person.ethnicity?.trim() && isPersonFieldShared(person, 'ethnicity'))
    parts.push(`ethnicity: ${person.ethnicity.trim()}`);
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
 *
 * Cross-shared facts here go through the SAME `factSharedWithViewer` gate as `summarizeForContext`
 * (42-relationship-scoped-sharing §5.2): broadcast / per-person / relationship-type-scoped (`shareableTypes`
 * resolved against the live graph), never `restricted` (18 §8.4) and never `flaggedInaccurate` (20 §3.6).
 * When any cross-shared fact crosses over, the block is prefixed with the confidentiality preamble (42 §3.4)
 * so the dream coach uses but never discloses it — "shared ≠ shown" holds on the dreams surface too.
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
  let anyCrossShared = false;
  for (const id of ids) {
    const person = byId.get(id);
    if (!person) continue;
    const relationship = relationships.find(
      (r) =>
        (r.fromPersonId === viewerId && r.toPersonId === id) ||
        (r.fromPersonId === id && r.toPersonId === viewerId),
    );
    const relType = relationship ? ` (${relationship.type})` : '';
    const relNote =
      relationship?.notes && relationship.notesShared !== false ? ` (${relationship.notes})` : '';
    lines.push(`- ${person.displayName}${relType}${sharedPronouns(person)}${relNote}`);
    // Only the fields the owner has left SHARED (15-shareability §5) — never a locked field.
    const profile = profileLines(person, 'others');
    for (const line of profile) lines.push(`  · ${line}`);
    if (profile.length > 0) anyCrossShared = true;
    // Only shareable facts about them, and only from insights that still feed context (a dream with
    // `informsContext` off is suppressed, 15-shareability §4.2). The relationship type(s) describing how the
    // linked person relates to the viewer gate `shareableTypes` against the live graph (42 §5.2).
    const granted = relationshipTypesFromSubjectToViewer(id, viewerId, relationships);
    const approved = (await listInsightsForPerson(fs, key, id)).filter(
      (insight) => insight.approved,
    );
    const feedable: typeof approved = [];
    for (const insight of approved) {
      if (await insightFeedsContext(fs, key, insight)) feedable.push(insight);
    }
    const facts = feedable
      .flatMap((insight) =>
        // The single gate (42 §5.1): broadcast / per-person / type-scoped, never restricted or flagged.
        insight.facts.filter((fact) => factSharedWithViewer(fact, viewerId, granted)),
      )
      .slice(0, MAX_LINKED_FACTS_PER_PERSON);
    for (const fact of facts) lines.push(`  · ${fact.text}`);
    if (facts.length > 0) anyCrossShared = true;
  }

  if (lines.length === 0) return '';
  const header = 'People from your life who appeared in this dream:';
  // Guard the cross-shared block with the confidentiality rule, as `summarizeForContext` does (42 §3.4).
  const preamble = anyCrossShared
    ? [confidentialityPreamble(byId.get(viewerId)?.displayName ?? '')]
    : [];
  return [...preamble, header, ...lines].join('\n');
}

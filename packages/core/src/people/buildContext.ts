import type { FileSystem } from '../host';
import { summarizeForContext } from '../insights';
import { getPerson, listPeople } from './peopleService';
import { listRelationships } from './relationshipService';

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
  if (person.privateNotes) lines.push(`Private (their own): ${person.privateNotes}`);

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

import type { FileSystem } from '@selfos/core/host';
import { getPerson, listPeople } from './peopleService';
import { listRelationships } from './relationshipService';

/**
 * Assemble the AI context block for a person's session (04-people-roles §3.4). Includes the person's
 * OWN full profile (their session, their data) plus only the **shareable** facts about the people they
 * relate to — other people's private notes are never included. The chat proxy feeds this to Claude.
 */
export async function buildContext(fs: FileSystem, key: Buffer, personId: string): Promise<string> {
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
  if (theirs.length > 0) {
    lines.push('People in their life:');
    for (const relationship of theirs) {
      const otherId =
        relationship.fromPersonId === personId
          ? relationship.toPersonId
          : relationship.fromPersonId;
      const other = byId.get(otherId);
      if (!other) continue;
      // Only shareable data about others — never their private notes.
      const about = other.publicNotes ? ` — ${other.publicNotes}` : '';
      const aboutRel = relationship.publicNotes ? ` (${relationship.publicNotes})` : '';
      lines.push(`- ${other.displayName} (${relationship.type})${about}${aboutRel}`);
    }
  }

  return lines.join('\n');
}

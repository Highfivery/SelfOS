import type { FileSystem } from '../host';
import type { OwnerEmailActivityEntry } from '../schemas';
import { listPeople } from '../people/peopleService';
import { listEmailActivity } from './emailSend';

/**
 * The owner Email-activity view (67 §3.7 / Phase 6) — EVERY member's sent email, newest-first, each row
 * tagged with the member's display name. Full visibility (the owner is the full-access role, §3.7); gated
 * on `people.manage` at the bridge (never a member-facing surface, and member copy never implies it exists).
 * Reads host-side with the master key across all persons' activity shards.
 */
export async function listAllEmailActivity(
  fs: FileSystem,
  key: Uint8Array,
): Promise<OwnerEmailActivityEntry[]> {
  const people = await listPeople(fs, key);
  const nameById = new Map(people.map((p) => [p.id, p.displayName]));
  const out: OwnerEmailActivityEntry[] = [];
  for (const person of people) {
    for (const entry of await listEmailActivity(fs, key, person.id)) {
      out.push({ ...entry, personName: nameById.get(entry.personId) ?? entry.personId });
    }
  }
  const when = (e: OwnerEmailActivityEntry): string => e.sentAt ?? e.scheduledAt ?? '';
  return out.sort((a, b) => (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0));
}

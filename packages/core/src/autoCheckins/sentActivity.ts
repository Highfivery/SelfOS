import type { FileSystem } from '../host';
import { listAssignments } from '../questionnaires/assignmentService';
import { listQuestionnaires } from '../questionnaires/questionnaireService';

/**
 * The per-stream compact read (spec 69 §3.4/§13) — for an auto-checkin stream an owner points at ANOTHER
 * person, what the OWNER has sent via it. Own-scoped by construction: it counts only the owner's OWN
 * auto-checkin sends (their authored questionnaires, their `createdAt`) — never the target's coverage, answers,
 * or feedback (the transparency read stays own-scoped; §6/§8).
 */
export interface AutoCheckinStreamActivity {
  /** How many auto check-ins the owner has sent this person. */
  sentCount: number;
  /** ISO timestamp of the most recent one, or null if none. */
  latestAt: string | null;
}

/**
 * Map each OTHER-person recipient the owner has auto-checked-in to → the owner's own sent activity for them.
 * Cheap: two list reads (auto-checkin questionnaire defs + the owner's sent assignments), no per-snapshot
 * decrypt. Self-sends are excluded (the panel's per-stream read is for other-person streams).
 */
export async function autoCheckinSentActivity(
  fs: FileSystem,
  key: Uint8Array,
  ownerId: string,
): Promise<Record<string, AutoCheckinStreamActivity>> {
  const [defs, assignments] = await Promise.all([
    listQuestionnaires(fs, key),
    listAssignments(fs, key, { senderPersonId: ownerId }),
  ]);
  const autoQuestionnaireIds = new Set(defs.filter((q) => q.autoCheckin).map((q) => q.id));
  const out: Record<string, AutoCheckinStreamActivity> = {};
  for (const a of assignments) {
    if (a.recipient.kind !== 'person' || !autoQuestionnaireIds.has(a.questionnaireId)) continue;
    if (a.recipient.personId === ownerId) continue; // self stream — not an other-person read
    const pid = a.recipient.personId;
    const cur = out[pid] ?? { sentCount: 0, latestAt: null };
    cur.sentCount += 1;
    if (!cur.latestAt || a.createdAt > cur.latestAt) cur.latestAt = a.createdAt;
    out[pid] = cur;
  }
  return out;
}

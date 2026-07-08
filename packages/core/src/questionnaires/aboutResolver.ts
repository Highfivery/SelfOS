import type { FileSystem } from '../host';
import type { Insight, Recipient } from '../schemas';
import { getAssignment, listAssignments } from './assignmentService';

/**
 * "Who is a sent-questionnaire insight ABOUT?" (issue #129). A questionnaire you send to someone else
 * produces an Insight for YOUR coaching (`subjectPersonId` = you) whose facts describe THEIR answers, so
 * Memory should group it as a "response to your questionnaire," not mislabel it "about you." This resolves
 * that recipient — a household person id (`aboutPersonId`) or an external display name (`aboutName`) —
 * relative to the subject, so a **self check-in** (recipient === subject) resolves to `null` and stays a
 * normal "about you" insight.
 */
export interface InsightAbout {
  aboutPersonId?: string;
  aboutName?: string;
}

/**
 * Map a send's recipient to the "about" person, RELATIVE to the subject (the sender). Returns `null` for a
 * self-recipient (a self check-in — the insight is genuinely about the subject). An external recipient with
 * no name falls back to a generic label so it still groups as a response.
 */
export function aboutFromRecipient(
  recipient: Recipient,
  subjectPersonId: string,
): InsightAbout | null {
  if (recipient.kind === 'person') {
    if (recipient.personId === subjectPersonId) return null;
    return { aboutPersonId: recipient.personId };
  }
  const name = recipient.displayName?.trim() || recipient.email?.trim() || recipient.phone?.trim();
  return { aboutName: name || 'a recipient' };
}

/**
 * Resolve who a questionnaire-sourced Insight is about, for the Memory "responses" grouping (#129). Prefers
 * the values the producers stamped into `provenance`; falls back to joining the assignment/compatibility
 * group for a pre-#129 insight. Returns `null` for a non-questionnaire insight, a self check-in, or when the
 * originating send has been deleted and nothing was stamped.
 */
export async function resolveInsightAbout(
  fs: FileSystem,
  key: Uint8Array,
  insight: Insight,
): Promise<InsightAbout | null> {
  if (insight.source !== 'questionnaire') return null;
  const prov = insight.provenance;
  if (prov.aboutPersonId) return { aboutPersonId: prov.aboutPersonId };
  if (prov.aboutName) return { aboutName: prov.aboutName };

  if (prov.assignmentId) {
    const assignment = await getAssignment(fs, key, prov.assignmentId);
    return assignment ? aboutFromRecipient(assignment.recipient, insight.subjectPersonId) : null;
  }
  if (prov.compatibilityGroupId) {
    const group = (await listAssignments(fs, key, {})).filter(
      (a) => a.compatibilityGroupId === prov.compatibilityGroupId,
    );
    const others = group
      .map((a) => aboutFromRecipient(a.recipient, insight.subjectPersonId))
      .filter((o): o is InsightAbout => o !== null);
    // "You + a partner" has exactly one non-self participant. Prefer a household person; else a named one.
    return others.find((o) => o.aboutPersonId) ?? others.find((o) => o.aboutName) ?? null;
  }
  return null;
}

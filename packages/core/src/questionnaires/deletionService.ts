import type { FileSystem } from '../host';
import { deleteCompatibilityReport } from './alignmentService';
import { deleteAssignment, getAssignment, listAssignments } from './assignmentService';
import { garbageCollectImages } from './imageGc';
import { deleteQuestionnaire } from './questionnaireService';

/**
 * Deletion + purge (08-questionnaires §3.9). Removing a send or a whole questionnaire removes every artifact
 * derived from it — the encrypted responses, the snapshot, the assignment, and (for compatibility) the joint
 * report folder. It deliberately **keeps the derived Insight** (20-memory-dashboard §3.7): an insight is the
 * coach's lasting memory, so it persists even when its source is deleted (its provenance link then shows the
 * source is gone). The role rules (who may delete what, when) are enforced one layer up in the bridge; these
 * services do the teardown.
 *
 * (The relay link revoke for an external send lands with the relay slice, §13.6.)
 */

/** Delete one send entirely — its snapshot, assignment, response (and a compat group's report). The Insight
 * persists (§3.7). */
export async function deleteSend(
  fs: FileSystem,
  key: Uint8Array,
  assignmentId: string,
): Promise<void> {
  // A compatibility member belongs to a paired group with a shared alignment report; deleting either member
  // breaks the pair, so remove the group's joint report folder. The sender's/participants' Insights persist.
  const assignment = await getAssignment(fs, key, assignmentId);
  if (assignment?.compatibilityGroupId) {
    await deleteCompatibilityReport(fs, key, assignment.compatibilityGroupId);
  }
  await deleteAssignment(fs, assignmentId);
  // The deleted send's snapshot no longer references its images — reap any now-orphaned ones (kept if
  // still referenced by the live def or another snapshot).
  await garbageCollectImages(fs, key);
}

/**
 * Purge a questionnaire and everything downstream of it: every send of it (snapshot + assignment +
 * response + any derived Insight), then the definition itself. Idempotent — a missing piece is a no-op.
 */
export async function purgeQuestionnaire(
  fs: FileSystem,
  key: Uint8Array,
  questionnaireId: string,
): Promise<void> {
  const sends = (await listAssignments(fs, key)).filter(
    (a) => a.questionnaireId === questionnaireId,
  );
  // Tear down any compatibility report folders this questionnaire spawned (the derived Insights persist, §3.7).
  const groupIds = new Set(
    sends.flatMap((a) => (a.compatibilityGroupId ? [a.compatibilityGroupId] : [])),
  );
  for (const groupId of groupIds) await deleteCompatibilityReport(fs, key, groupId);
  for (const send of sends) await deleteAssignment(fs, send.id);
  await deleteQuestionnaire(fs, questionnaireId);
  // Purge-on-delete: with the def + all its snapshots gone, this questionnaire's images are now
  // unreferenced — reap them (and any pre-existing orphans) in one pass.
  await garbageCollectImages(fs, key);
}

/** Whether a questionnaire has any sends (gates a non-owner creator's "delete only while unsent"). */
export async function hasSends(
  fs: FileSystem,
  key: Uint8Array,
  questionnaireId: string,
): Promise<boolean> {
  const sends = await listAssignments(fs, key);
  return sends.some((a) => a.questionnaireId === questionnaireId);
}

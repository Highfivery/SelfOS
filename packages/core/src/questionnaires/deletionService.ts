import type { FileSystem } from '../host';
import { deleteInsight, listAllInsights } from '../insights';
import { purgeCompatibilityGroup } from './alignmentService';
import { deleteAssignment, getAssignment, listAssignments } from './assignmentService';
import { garbageCollectImages } from './imageGc';
import { deleteQuestionnaire } from './questionnaireService';

/**
 * Deletion + purge (08-questionnaires §3.9). Removing a send or a whole questionnaire also removes every
 * artifact derived from it — the encrypted responses **and** any Insight drafted from them — so nothing
 * is left dangling in the vault or the coach's context. The role rules (who may delete what, when) are
 * enforced one layer up in the bridge; these services do the thorough teardown.
 *
 * (The relay link revoke for an external send lands with the relay slice, §13.6.)
 */

/** Delete every Insight (across all subjects) drafted from any of the given assignment ids. */
async function purgeInsightsFor(
  fs: FileSystem,
  key: Uint8Array,
  assignmentIds: ReadonlySet<string>,
): Promise<void> {
  for (const insight of await listAllInsights(fs, key)) {
    const from = insight.provenance.assignmentId;
    if (from && assignmentIds.has(from)) {
      await deleteInsight(fs, insight.subjectPersonId, insight.id);
    }
  }
}

/** Delete one send entirely — its snapshot + assignment + response, and any Insight derived from it. */
export async function deleteSend(
  fs: FileSystem,
  key: Uint8Array,
  assignmentId: string,
): Promise<void> {
  // A compatibility member belongs to a paired group with a shared alignment report + a group-level
  // Insight; deleting either member breaks the pair, so tear the group's report + Insight down too.
  const assignment = await getAssignment(fs, key, assignmentId);
  if (assignment?.compatibilityGroupId) {
    await purgeCompatibilityGroup(fs, key, assignment.compatibilityGroupId);
  }
  await purgeInsightsFor(fs, key, new Set([assignmentId]));
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
  // Tear down any compatibility groups (report folders + group-level Insights) this questionnaire spawned.
  const groupIds = new Set(
    sends.flatMap((a) => (a.compatibilityGroupId ? [a.compatibilityGroupId] : [])),
  );
  for (const groupId of groupIds) await purgeCompatibilityGroup(fs, key, groupId);
  await purgeInsightsFor(fs, key, new Set(sends.map((a) => a.id)));
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

import type { FileSystem } from '../host';
import { QuestionnaireSchema, type Questionnaire } from '../schemas';
import { readEncryptedJson } from '../vault';
import { DEFS_DIR, MEDIA_DIR, snapshotPath } from './paths';
import { listAssignments } from './assignmentService';
import { deleteQuestionnaireImage } from './imageService';

/**
 * Garbage-collection for author-attached question images (08-questionnaires §3.9 / §13.2 follow-up).
 * Images live in a **shared** media dir decoupled from any one questionnaire (so they can be attached
 * before a draft is saved), which means they can be orphaned two ways: a draft "remove" that's then
 * saved (the §13.2 design — remove only clears the draft, the file is reaped later), and purging a
 * questionnaire/send that referenced them.
 *
 * The one correctness rule: an image removed from a definition may **still be frozen in an already-sent
 * snapshot**, which the recipient + Results still need — so the reference scan covers BOTH the live
 * definitions AND every send snapshot, and only media referenced by neither is deleted.
 */

function imagePathsOf(questionnaire: Questionnaire): string[] {
  return questionnaire.questions.flatMap((q) => (q.media ? [q.media.imagePath] : []));
}

/** Every image path referenced by a live definition OR a frozen send snapshot. */
export async function collectReferencedImagePaths(
  fs: FileSystem,
  key: Uint8Array,
): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (const name of await fs.list(DEFS_DIR)) {
    if (!name.endsWith('.enc')) continue;
    const raw = await readEncryptedJson(fs, `${DEFS_DIR}/${name}`, key);
    if (raw) for (const path of imagePathsOf(QuestionnaireSchema.parse(raw))) referenced.add(path);
  }
  // Send snapshots are frozen as-sent copies — an image dropped from the def can still live here.
  for (const assignment of await listAssignments(fs, key)) {
    const raw = await readEncryptedJson(fs, snapshotPath(assignment.id), key);
    if (raw) for (const path of imagePathsOf(QuestionnaireSchema.parse(raw))) referenced.add(path);
  }
  return referenced;
}

/**
 * Delete every stored image not referenced by any definition or send snapshot; returns the deleted
 * paths. Idempotent (a second run finds nothing). Safe to run after any destructive op or an
 * image-removing save — it reaps both that op's now-orphaned images and any pre-existing orphans.
 */
export async function garbageCollectImages(fs: FileSystem, key: Uint8Array): Promise<string[]> {
  const referenced = await collectReferencedImagePaths(fs, key);
  const deleted: string[] = [];
  for (const name of await fs.list(MEDIA_DIR)) {
    if (!name.endsWith('.enc')) continue;
    const path = `${MEDIA_DIR}/${name}`;
    if (!referenced.has(path)) {
      await deleteQuestionnaireImage(fs, path); // isMediaPath-guarded
      deleted.push(path);
    }
  }
  return deleted;
}

import type { FileSystem } from '../host';
import { ResponseSetSchema, type ResponseSet } from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { responsePath } from './paths';

/**
 * The answers to one assignment (08-questionnaires §4.3), stored encrypted in the send folder. One
 * ResponseSet per assignment; re-asks chain via `reAskOf`. Raw answers never feed the coach directly —
 * analysis derives an Insight (a later slice); this layer just persists them.
 */

/** Save (or overwrite) the response for an assignment. */
export async function saveResponse(
  fs: FileSystem,
  key: Uint8Array,
  response: ResponseSet,
): Promise<void> {
  await writeEncryptedJson(fs, responsePath(response.assignmentId), response, key);
}

/** Read the response for an assignment; null if not yet answered. */
export async function getResponse(
  fs: FileSystem,
  key: Uint8Array,
  assignmentId: string,
): Promise<ResponseSet | null> {
  const raw = await readEncryptedJson(fs, responsePath(assignmentId), key);
  return raw ? ResponseSetSchema.parse(raw) : null;
}

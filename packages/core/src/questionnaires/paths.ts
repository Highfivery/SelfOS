/** Vault storage paths for the questionnaire engine (08-questionnaires §4.1). */

export const DEFS_DIR = 'questionnaires/defs';
export const SENDS_DIR = 'questionnaires/sends';

/** Plain-JSON, non-secret questionnaire prefs (custom types; later: message templates). §4.1. */
export const PREFS_PATH = 'config/questionnaires.json';

/** Shared dir for encrypted author-attached question images (§4.2), decoupled from a def's lifecycle. */
export const MEDIA_DIR = 'questionnaires/media';

/** An encrypted question image, addressed by a random id. */
export function imagePath(imageId: string): string {
  return `${MEDIA_DIR}/${imageId}.enc`;
}

/** Guard: a caller-supplied image path must point inside the media dir (no arbitrary vault file access). */
export function isMediaPath(path: string): boolean {
  return path.startsWith(`${MEDIA_DIR}/`) && path.endsWith('.enc') && !path.includes('..');
}

/** A created questionnaire definition. */
export function defPath(id: string): string {
  return `${DEFS_DIR}/${id}.enc`;
}

/** A single send's folder (one per assignment): snapshot + assignment + response. */
export function sendDir(assignmentId: string): string {
  return `${SENDS_DIR}/${assignmentId}`;
}

/** The immutable questionnaire snapshot frozen at send time. */
export function snapshotPath(assignmentId: string): string {
  return `${sendDir(assignmentId)}/questionnaire.enc`;
}

export function assignmentPath(assignmentId: string): string {
  return `${sendDir(assignmentId)}/assignment.enc`;
}

export function responsePath(assignmentId: string): string {
  return `${sendDir(assignmentId)}/response.enc`;
}

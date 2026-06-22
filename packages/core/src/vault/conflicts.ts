/**
 * Sync-provider conflict-copy name patterns (00-architecture §4.3) — shared by the Electron host (which
 * walks the folder) and the iOS host (belt-and-suspenders alongside `NSFileVersion`, 33 §5.C/§5.E) so both
 * apply identical rules. We never touch these files — only surface them so the user resolves them. Patterns
 * cover the common, clearly-marked cases; ambiguous duplicates (e.g. Google Drive "(1)") are intentionally
 * NOT flagged to avoid false positives.
 */
const CONFLICT_PATTERNS: readonly RegExp[] = [
  /\(.*conflicted copy.*\)/i, // Dropbox / iCloud
  /\.sync-conflict-\d{8}-\d{6}/i, // Syncthing
];

export function isConflictCopy(fileName: string): boolean {
  return CONFLICT_PATTERNS.some((pattern) => pattern.test(fileName));
}

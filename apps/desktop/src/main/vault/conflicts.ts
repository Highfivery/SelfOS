import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Best-effort detection of sync-provider conflict copies (00-architecture §4.3). We never touch
 * these files — we only surface them so the user can resolve them. Patterns cover the common,
 * clearly-marked cases; ambiguous duplicates (e.g. Google Drive "(1)") are intentionally not flagged
 * to avoid false positives.
 */
const CONFLICT_PATTERNS: readonly RegExp[] = [
  /\(.*conflicted copy.*\)/i, // Dropbox
  /\.sync-conflict-\d{8}-\d{6}/i, // Syncthing
];

export function isConflictCopy(fileName: string): boolean {
  return CONFLICT_PATTERNS.some((pattern) => pattern.test(fileName));
}

/** Recursively find conflict-copy files within a directory. Returns absolute paths. */
export async function findConflicts(dir: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (isConflictCopy(entry.name)) {
        found.push(full);
      }
    }
  }

  await walk(dir);
  return found;
}

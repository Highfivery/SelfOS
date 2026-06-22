import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isConflictCopy } from '@selfos/core/vault';

// `isConflictCopy` (the sync-provider conflict-copy name matcher) now lives in `@selfos/core/vault` so the
// Electron + iOS hosts apply identical rules (33-multi-device-housekeeping §5.E). Re-exported for callers.
export { isConflictCopy };

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

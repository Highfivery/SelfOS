import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FileSystem } from '@selfos/core/host';
import { notifyWrite } from '../vault/writeObserver';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The Electron host's `FileSystem` (07-mobile-platform §5.3): Node `fs` rooted at the vault directory.
 * Vault-relative paths resolve under `vaultDir`. Writes are atomic (temp-file + rename) and notify the
 * write-observer so the file-watcher suppresses our own echo (00-architecture §4.3).
 */
export function createNodeFileSystem(vaultDir: string): FileSystem {
  const resolve = (path: string): string => join(vaultDir, path);
  // "Absent" covers both a missing entry (ENOENT) and a path component that is a file, not a directory
  // (ENOTDIR) — e.g. reading `people/.DS_Store/profile.enc` when a stray file sits in `people/`. Both
  // mean "nothing to read/list here", matching the old pathExists-guarded behavior.
  const isMissing = (error: unknown): boolean => {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
  };

  return {
    async read(path) {
      try {
        return await readFile(resolve(path));
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async writeAtomic(path, data) {
      const target = resolve(path);
      await mkdir(dirname(target), { recursive: true });
      // Atomic temp-file + rename. On an iCloud-Drive / Dropbox vault the sync daemon can evict or
      // relocate the temp file between writeFile and rename (ENOENT on the rename SOURCE), so retry the
      // whole sequence with a fresh temp + a short backoff. Re-throw any non-ENOENT error immediately.
      const maxAttempts = 5;
      let lastError: unknown;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${attempt}`;
        try {
          await writeFile(tmp, data);
          await rename(tmp, target);
          notifyWrite(target);
          return;
        } catch (error) {
          lastError = error;
          await rm(tmp, { force: true }).catch(() => {}); // clean up the orphaned temp, if any
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          await sleep(25 * (attempt + 1)); // let the sync daemon settle before retrying
        }
      }
      throw lastError;
    },
    async list(dir) {
      try {
        return await readdir(resolve(dir));
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
    },
    async remove(path) {
      await rm(resolve(path), { recursive: true, force: true });
    },
  };
}

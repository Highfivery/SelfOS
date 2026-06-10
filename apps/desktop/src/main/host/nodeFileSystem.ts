import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FileSystem } from '@selfos/core/host';
import { notifyWrite } from '../vault/writeObserver';

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
      const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(tmp, data);
      await rename(tmp, target);
      notifyWrite(target);
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

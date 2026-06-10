/**
 * The vault filesystem host (07-mobile-platform §5.1). Platform-agnostic business logic depends only on
 * this interface; each platform supplies an implementation — Node `fs` on Electron, a security-scoped
 * iCloud-Drive plugin on iOS. Paths are **vault-relative** (POSIX `/` separators); the host resolves
 * them against the vault root. Bytes in/out keep the layer free of node `Buffer`.
 *
 * Kept minimal — only what today's services need. `watch`/`ensureAccess` (iOS security scope) arrive
 * with the iOS shell (§5.4); they are not scaffolded here.
 */
export interface FileSystem {
  /** Read a file's bytes, or `null` if it does not exist. */
  read(path: string): Promise<Uint8Array | null>;
  /** Write bytes atomically (temp-file + rename / coordinated write), creating parent directories. */
  writeAtomic(path: string, data: Uint8Array): Promise<void>;
  /** Names of the entries (files + directories) directly under `dir`; `[]` if `dir` is absent. */
  list(dir: string): Promise<string[]>;
  /** Remove a file or directory (recursively); a no-op if the target does not exist. */
  remove(path: string): Promise<void>;
}

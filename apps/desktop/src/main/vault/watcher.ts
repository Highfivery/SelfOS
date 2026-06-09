import { watch, type FSWatcher } from 'chokidar';
import { onWrite } from './writeObserver';

const ECHO_WINDOW_MS = 1500;
const DEBOUNCE_MS = 200;

/**
 * Decide whether a filesystem change should be emitted to the renderer, suppressing changes the app
 * itself just wrote (echo suppression — 00-architecture §4.3).
 */
export function shouldEmitChange(
  filePath: string,
  recentWrites: ReadonlyMap<string, number>,
  now: number,
  windowMs: number = ECHO_WINDOW_MS,
): boolean {
  const writtenAt = recentWrites.get(filePath);
  return writtenAt === undefined || now - writtenAt >= windowMs;
}

export interface VaultWatcher {
  close(): Promise<void>;
}

/** Watch a vault directory and call `onChange` (debounced) on external changes. */
export function watchVault(vaultDir: string, onChange: () => void): VaultWatcher {
  const recentWrites = new Map<string, number>();
  const stopObserving = onWrite((filePath) => recentWrites.set(filePath, Date.now()));

  const watcher: FSWatcher = watch(vaultDir, {
    ignoreInitial: true,
    persistent: true,
    depth: 8,
    // Ignore our own atomic-write temp files so they don't generate spurious change events.
    ignored: /\.tmp-\d+-\d+$/,
  });

  let timer: NodeJS.Timeout | undefined;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, DEBOUNCE_MS);
  };

  watcher.on('all', (_event, filePath) => {
    if (shouldEmitChange(filePath, recentWrites, Date.now())) schedule();
  });

  return {
    async close(): Promise<void> {
      if (timer) clearTimeout(timer);
      stopObserving();
      await watcher.close();
    },
  };
}

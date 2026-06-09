type WriteObserver = (filePath: string) => void;

const observers = new Set<WriteObserver>();

/** Subscribe to vault writes the app makes (used by the watcher to suppress echo events). */
export function onWrite(observer: WriteObserver): () => void {
  observers.add(observer);
  return () => {
    observers.delete(observer);
  };
}

/** Called by the atomic writer after a successful write. */
export function notifyWrite(filePath: string): void {
  for (const observer of observers) observer(filePath);
}

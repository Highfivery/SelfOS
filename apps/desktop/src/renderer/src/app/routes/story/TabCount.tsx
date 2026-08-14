import { useStoryStore } from '../../../stores/storyStore';
import styles from './Story.module.css';
import { useEffect } from 'react';

/** A small live count next to a tab label (currently only Photos). Reads the store's images index. */
export function TabCount({ bookId, kind }: { bookId: string; kind: 'photos' }): JSX.Element | null {
  const images = useStoryStore((s) => s.images);
  const loadImages = useStoryStore((s) => s.loadImages);
  useEffect(() => {
    void loadImages(bookId);
  }, [bookId, loadImages]);
  const n = images.filter((i) => i.kind === 'uploaded').length;
  if (kind === 'photos' && n > 0) return <span className={styles.tabBadge}>{n}</span>;
  return null;
}

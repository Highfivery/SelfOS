import { Card, Heading, Inline, Stack, Text } from '../../../design-system/components';
import { useStoryStore } from '../../../stores/storyStore';
import styles from './Books.module.css';
import { useEffect } from 'react';
import type { StoryCompletenessStage } from '@shared/schemas';

/** The completeness stage → a warm label (§3.6, owner decision: a qualitative stage + a subtle bar, never a %). */
export const COMPLETENESS_STAGE: Record<StoryCompletenessStage, string> = {
  beginning: 'Just beginning',
  takingShape: 'Taking shape',
  comingTogether: 'Coming together',
  richlyTold: 'Richly told',
};
/** The "Shared with you" section (§3.5) — books others have published to the active person. Self-hides when
 *  empty; opening a card reads the published head (never the author's draft). */
export function SharedWithYou(): JSX.Element | null {
  const sharedBooks = useStoryStore((s) => s.sharedBooks);
  const loadSharedBooks = useStoryStore((s) => s.loadSharedBooks);
  const openSharedBook = useStoryStore((s) => s.openSharedBook);
  useEffect(() => {
    void loadSharedBooks();
  }, [loadSharedBooks]);
  if (sharedBooks.length === 0) return null;
  return (
    <Card>
      <Stack gap={2}>
        <Heading level={2}>Shared with you</Heading>
        {sharedBooks.map((b) => (
          <button
            key={`${b.authorPersonId}:${b.bookId}`}
            type="button"
            className={styles.chapterLink}
            onClick={() => void openSharedBook(b.authorPersonId, b.bookId)}
          >
            <Stack gap={1}>
              <Inline gap={2}>
                <Text className={styles.rowTitle}>{b.title}</Text>
                {b.updated ? (
                  <span className={styles.newBadge}>{b.neverOpened ? 'New' : 'Updated'}</span>
                ) : null}
              </Inline>
              <Text tone="secondary" size="sm">
                By {b.authorName} · {b.chapterCount} chapter{b.chapterCount === 1 ? '' : 's'}
              </Text>
            </Stack>
            <Text tone="secondary" size="sm">
              Read ›
            </Text>
          </button>
        ))}
      </Stack>
    </Card>
  );
}

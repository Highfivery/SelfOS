import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { MemoryCollection } from './MemoryCollection';
import { ShareMemoryPanel } from './ShareMemoryPanel';
import styles from './Story.module.css';

/**
 * "Memories you've shared" (§15.1) — the book-INDEPENDENT home for the biographer's memory chats.
 *
 * A memory is person-level (§14, decision 1): it survives a book delete and feeds every future book plus the
 * coach. Its derived Insight is permanent, so its "view source" link must resolve in every book state — which
 * the Studio's Interview tab could not do (a person who deleted their only book landed on "Begin your book"
 * with the memory unreachable, #288). This route renders the SAME collection with no book, one book, or
 * several, and the memory chat itself already works book-free (`buildMemorySystem` falls back to the default
 * warm/third config when the person has no books).
 */
export function StoryMemories({ hasBook }: { hasBook: boolean }): JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // `null` = the collection; `{}` = a new chat; `{ memoryId }` = that memory (the insight deep-link).
  const [panel, setPanel] = useState<{ memoryId?: string; seedFocus?: string } | null>(null);

  // Deep-link: `/story/memories?memory=<id>` opens that memory. Consumed once (cleared) so closing the panel
  // returns to the collection instead of reopening it — the Interview tab's behaviour.
  const memoryParam = searchParams.get('memory');
  useEffect(() => {
    if (memoryParam) {
      setPanel({ memoryId: memoryParam });
      setSearchParams({}, { replace: true });
    }
  }, [memoryParam, setSearchParams]);

  if (panel) {
    return (
      <div className={styles.page}>
        {/* No CrisisFooter here — ShareMemoryPanel renders its own, and two would stack (§8.2/§7). */}
        <ShareMemoryPanel
          key={panel.memoryId ?? 'new'}
          {...(panel.memoryId ? { memoryId: panel.memoryId } : {})}
          onBack={() => setPanel(null)}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Stack gap={3}>
        <Card>
          <Stack gap={2}>
            {/* Deliberately NOT "Memories you've shared" — that names the saved-only section below, and two
                headings reading the same thing on one screen is the §7 label-collision failure. */}
            <Heading level={2}>Your memories</Heading>
            <Text tone="secondary" size="sm">
              Tell your biographer about a moment — a place, a person, a turning point — and it will
              ask, listen, and keep it in your own words. Your memories stay with you even if you
              start a new book.
            </Text>
            <div className={styles.memInvite}>
              <Button variant="primary" onClick={() => setPanel({})}>
                Share a memory
              </Button>
              {hasBook ? (
                <Button variant="ghost" onClick={() => navigate('/story')}>
                  Back to your book
                </Button>
              ) : null}
            </div>
          </Stack>
        </Card>

        <MemoryCollection
          onOpen={(memoryId) => setPanel({ memoryId })}
          emptyState={
            <Card>
              <Text tone="tertiary" size="sm">
                You haven’t shared a memory yet. Start one above — it takes a few minutes, and your
                biographer does the writing.
              </Text>
            </Card>
          }
        />
      </Stack>
      <CrisisFooter />
    </div>
  );
}

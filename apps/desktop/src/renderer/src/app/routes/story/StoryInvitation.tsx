import { Banner, Button, Card, Heading, Inline, Text } from '../../../design-system/components';
import { useStoryStore } from '../../../stores/storyStore';
import styles from './Story.module.css';
import { drawnFromChips } from './begin';
import { useEffect } from 'react';

/**
 * The invitation (§13.3) — the no-book empty state: the book as hero, the three-step promise, a "Drawn from"
 * chip row with real (deterministic, no-AI) counts of the material the biographer will draw from, the privacy
 * line, and "Begin your book". The "Shared with you" shelf renders below (the whole surface for a person who
 * only has books shared with them).
 */
export function StoryInvitation({
  onBegin,
  onMemories,
  error,
  beginDisabled = false,
}: {
  onBegin: () => void;
  /** Opens the book-independent memory collection (§15.1) — the only path to an in-progress memory chat for
   *  someone with no book (a draft memory produces no Insight, so it has no provenance link to arrive by). */
  onMemories: () => void;
  error: string | null;
  /** True when AI is unavailable (no key / AI off) — the commission can't draft, so Begin is disabled and
   *  the role-aware AiUnavailableNotice above explains how to enable it (§8.2 honest states). */
  beginDisabled?: boolean;
}): JSX.Element {
  const corpusStats = useStoryStore((s) => s.corpusStats);
  const loadCorpusStats = useStoryStore((s) => s.loadCorpusStats);
  useEffect(() => {
    void loadCorpusStats();
  }, [loadCorpusStats]);

  const chips = corpusStats ? drawnFromChips(corpusStats) : [];

  return (
    <Card>
      <div className={styles.invitation}>
        <div className={styles.invitationCover} aria-hidden="true">
          <span className={styles.invitationCoverKicker}>A Biography</span>
          <span className={styles.invitationCoverTitle}>Your Story</span>
        </div>
        <div className={styles.invitationBody}>
          <Heading level={1}>Your life, written as a book</Heading>
          <Text tone="secondary">
            A biographer that reads everything you’ve shared with SelfOS and writes your story —
            chapter by chapter, in your voice. It keeps writing as your life grows.
          </Text>
          <div className={styles.promiseRow}>
            <div className={styles.promiseStep}>
              <span className={styles.promiseTitle}>It reads</span>
              <Text size="sm" tone="secondary">
                everything you’ve shared — nothing you haven’t.
              </Text>
            </div>
            <div className={styles.promiseStep}>
              <span className={styles.promiseTitle}>It writes</span>
              <Text size="sm" tone="secondary">
                a true, book-length life story from it.
              </Text>
            </div>
            <div className={styles.promiseStep}>
              <span className={styles.promiseTitle}>It keeps writing</span>
              <Text size="sm" tone="secondary">
                folding in new chapters as you go.
              </Text>
            </div>
          </div>
          {chips.length > 0 ? (
            <div className={styles.drawnFrom}>
              <Text size="sm" tone="tertiary">
                Drawn from
              </Text>
              <div className={styles.drawnChipRow}>
                {chips.map((chip) => (
                  <span key={chip} className={styles.drawnChip}>
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <Text size="sm" tone="secondary">
            Written from your private vault — nobody sees it until you choose to share.
          </Text>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <Inline>
            <Button variant="primary" disabled={beginDisabled} onClick={onBegin}>
              Begin your book
            </Button>
            {/* Never disabled by AI state: sharing a memory needs AI, but REACHING one you already told the
                biographer must not depend on it (§8.2 — the surface explains itself once you're there). */}
            <Button variant="ghost" onClick={onMemories}>
              Your memories
            </Button>
          </Inline>
        </div>
      </div>
    </Card>
  );
}

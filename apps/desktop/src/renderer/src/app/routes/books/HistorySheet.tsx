import { Banner, Button, Heading, Inline, Stack, Text } from '../../../design-system/components';
import { useStoryStore } from '../../../stores/storyStore';
import styles from './Books.module.css';
import { useEffect, useState } from 'react';
import type { ChapterVersion, StoryChapterHistoryView } from '@shared/schemas';
import { WordDiff } from './WordDiff';

/** Human labels for why a version was archived (§13.9). */
export const VERSION_REASON_LABEL: Record<ChapterVersion['reason'], string> = {
  rewrite: 'Before a rewrite',
  revision: 'Before a revision',
  restore: 'Before a restore',
  lineEdit: 'Before a polish',
};
/**
 * The chapter History sheet (§13.9 — the draft vault): every archived version (newest first), each openable
 * into a word-diff compare against the CURRENT text, with restore-any behind a two-step confirm. Restoring
 * archives the current text first, so it is itself undoable. Reuses the shared `.sheet*` chrome.
 */
export function HistorySheet({
  bookId,
  chapterId,
  currentMarkdown,
  onClose,
}: {
  bookId: string;
  chapterId: string;
  currentMarkdown: string;
  onClose: () => void;
}): JSX.Element {
  const chapterHistory = useStoryStore((s) => s.chapterHistory);
  const chapterVersion = useStoryStore((s) => s.chapterVersion);
  const restoreChapterVersion = useStoryStore((s) => s.restoreChapterVersion);
  const [history, setHistory] = useState<StoryChapterHistoryView | null>(null);
  const [openRevision, setOpenRevision] = useState<number | null>(null);
  const [openVersion, setOpenVersion] = useState<ChapterVersion | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    void chapterHistory(bookId, chapterId).then((h) => {
      if (live) setHistory(h);
    });
    return () => {
      live = false;
    };
  }, [bookId, chapterId, chapterHistory]);

  const openCompare = async (revision: number): Promise<void> => {
    setConfirmRestore(false);
    if (openRevision === revision) {
      setOpenRevision(null);
      setOpenVersion(null);
      return;
    }
    setOpenRevision(revision);
    setOpenVersion(null);
    const v = await chapterVersion(bookId, chapterId, revision);
    setOpenVersion(v);
    if (!v) setError('That version is no longer here.');
  };

  const restore = async (): Promise<void> => {
    if (openRevision === null) return;
    setBusy(true);
    setError(null);
    const ok = await restoreChapterVersion(bookId, chapterId, openRevision);
    setBusy(false);
    if (ok) onClose();
    else setError('Couldn’t restore that version. Please try again.');
  };

  return (
    <div className={styles.sheetWrap}>
      <div className={styles.sheetBackdrop} onClick={onClose} aria-hidden="true" />
      <aside className={styles.sheetPanel} role="dialog" aria-label="Chapter history">
        <div className={styles.sheetHead}>
          <Heading level={2}>History</Heading>
          <button
            type="button"
            className={styles.sourcesToggle}
            aria-label="Close"
            onClick={onClose}
          >
            ✕ Close
          </button>
        </div>
        <div className={styles.sheetBody}>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {!history ? (
            <Text size="sm" tone="tertiary" aria-live="polite">
              Loading versions…
            </Text>
          ) : history.versions.length === 0 ? (
            <Text size="sm" tone="secondary">
              No earlier versions yet. Every rewrite and revision saves the text it replaces here,
              so nothing is ever lost.
            </Text>
          ) : (
            <Stack gap={2}>
              {history.versions.map((v) => (
                <div key={v.revision} className={styles.reviewRow}>
                  <div className={styles.reviewRowBody}>
                    <Text size="sm">
                      {VERSION_REASON_LABEL[v.reason]} ·{' '}
                      {new Date(v.savedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </Text>
                    <Text size="sm" tone="tertiary">
                      {v.words.toLocaleString()} words
                    </Text>
                  </div>
                  <button
                    type="button"
                    className={styles.sourcesToggle}
                    aria-expanded={openRevision === v.revision}
                    onClick={() => void openCompare(v.revision)}
                  >
                    {openRevision === v.revision ? 'Hide' : 'Compare'}
                  </button>
                </div>
              ))}
              {openRevision !== null ? (
                openVersion ? (
                  <Stack gap={2}>
                    <Text size="sm" tone="tertiary">
                      What changed from that version to now:
                    </Text>
                    <WordDiff previous={openVersion.markdown} current={currentMarkdown} />
                    {confirmRestore ? (
                      <Inline gap={2}>
                        <Text size="sm" tone="secondary">
                          Restore this version? The current text is saved to History first.
                        </Text>
                        <Button variant="primary" disabled={busy} onClick={() => void restore()}>
                          {busy ? 'Restoring…' : 'Restore'}
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmRestore(false)}>
                          Cancel
                        </Button>
                      </Inline>
                    ) : (
                      <Inline>
                        <Button onClick={() => setConfirmRestore(true)}>
                          Restore this version
                        </Button>
                      </Inline>
                    )}
                  </Stack>
                ) : (
                  <Text size="sm" tone="tertiary" aria-live="polite">
                    Loading that version…
                  </Text>
                )
              ) : null}
            </Stack>
          )}
        </div>
      </aside>
    </div>
  );
}

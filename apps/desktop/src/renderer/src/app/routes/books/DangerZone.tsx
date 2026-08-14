import {
  Banner,
  Button,
  Card,
  Field,
  Heading,
  Inline,
  Stack,
  Text,
  TextInput,
} from '../../../design-system/components';
import { useStoryStore } from '../../../stores/storyStore';
import styles from './Books.module.css';
import { useEffect, useState } from 'react';

/** The Settings tab's Danger zone (§13.6.6/§13.6.7): rewrite-from-scratch + delete, each behind an honest
 *  consequences dialog; delete arms only when the book's title is typed. */
export function DangerZone({ bookId, title }: { bookId: string; title: string }): JSX.Element {
  const remove = useStoryStore((s) => s.remove);
  const rewriteFromScratch = useStoryStore((s) => s.rewriteFromScratch);
  const [dialog, setDialog] = useState<'rewrite' | 'delete' | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (): void => {
    setDialog(null);
    setConfirmText('');
  };

  // Esc closes the open dialog (the app's ChangeVaultDialog/TogetherStartDialog convention).
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);

  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2}>Danger zone</Heading>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <div className={styles.dangerRow}>
          <Stack gap={1}>
            <Text size="sm" weight={500}>
              Rewrite from scratch
            </Text>
            <Text size="sm" tone="secondary">
              A fresh outline and fresh chapters from everything you’ve shared since. Keeps your
              photos, exclusions and interview answers; discards your edits, pins and marks.
            </Text>
          </Stack>
          <Button variant="ghost" onClick={() => setDialog('rewrite')}>
            Rewrite from scratch…
          </Button>
        </div>
        <div className={styles.dangerRow}>
          <Stack gap={1}>
            <Text size="sm" weight={500}>
              Delete this book
            </Text>
            <Text size="sm" tone="secondary">
              Removes the book, its images and its published copies. Readers lose access
              immediately. This cannot be undone.
            </Text>
          </Stack>
          <Button variant="ghost" onClick={() => setDialog('delete')}>
            Delete this book…
          </Button>
        </div>
      </Stack>

      {dialog ? (
        <div className={styles.dialogWrap}>
          <div className={styles.dialogBackdrop} onClick={close} aria-hidden="true" />
          <div
            className={styles.dialog}
            role="dialog"
            aria-label={dialog === 'rewrite' ? 'Rewrite from scratch' : 'Delete this book'}
          >
            {dialog === 'rewrite' ? (
              <Stack gap={3}>
                <Heading level={3}>Rewrite “{title}” from scratch?</Heading>
                <Text size="sm" tone="secondary">
                  Your biographer re-reads everything and writes a fresh outline and fresh chapters.
                </Text>
                <ul className={styles.dzList}>
                  <li>
                    <span className={styles.dzKeep}>Keeps</span> your photos, captions and answers
                  </li>
                  <li>
                    <span className={styles.dzKeep}>Keeps</span> your exclusions, title, voice &amp;
                    style
                  </li>
                  <li>
                    <span className={styles.dzKeep}>Keeps</span> the moments you added or corrected
                    on your timeline
                  </li>
                  <li>
                    <span className={styles.dzLose}>Discards</span> every chapter, edit, pin and
                    pending mark
                  </li>
                  <li>
                    <span className={styles.dzLose}>Readers</span> keep the published copy until you
                    share again
                  </li>
                </ul>
                <Inline justify="flex-end">
                  <Button variant="ghost" autoFocus onClick={close}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      close();
                      const res = await rewriteFromScratch(bookId);
                      if (!res.ok && res.message) setError(res.message);
                      setBusy(false);
                    }}
                  >
                    Rewrite from scratch
                  </Button>
                </Inline>
              </Stack>
            ) : (
              <Stack gap={3}>
                <Heading level={3}>Delete “{title}”?</Heading>
                <ul className={styles.dzList}>
                  <li>
                    <span className={styles.dzLose}>Deletes</span> every chapter, image, photo,
                    answer and mark
                  </li>
                  <li>
                    <span className={styles.dzLose}>Readers</span> lose access to the published copy
                    now
                  </li>
                  <li>
                    <span className={styles.dzLose}>Cannot</span> be undone
                  </li>
                </ul>
                <Field label={`Type the book’s title to confirm`}>
                  {(p) => (
                    <TextInput
                      {...p}
                      autoFocus
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder={title}
                    />
                  )}
                </Field>
                <Inline justify="flex-end">
                  <Button variant="ghost" onClick={close}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    disabled={confirmText.trim() !== title.trim()}
                    onClick={() => void remove(bookId)}
                  >
                    Delete forever
                  </Button>
                </Inline>
              </Stack>
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

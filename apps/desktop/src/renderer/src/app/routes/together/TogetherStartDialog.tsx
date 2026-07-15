import { useEffect } from 'react';
import { Heart, X } from 'lucide-react';
import type { TogetherCatalogEntry } from '@shared/schemas';
import {
  Banner,
  Button,
  Card,
  Heading,
  IconButton,
  Inline,
  Stack,
  Text,
  TextInput,
} from '../../../design-system/components';
import styles from './Together.module.css';

/** What the start dialog is about to create — a free session or a specific guided practice. */
export type StartPending = { kind: 'free' } | { kind: 'guide'; entry: TogetherCatalogEntry };

/**
 * The "start a session" dialog (58 §3.3) — a centered `role="dialog"` overlay (the app's hand-rolled pattern,
 * mirroring ChangeVaultDialog / LockScreen; there's no Modal primitive). Replaces the old inline "start bar"
 * that required scrolling up to reach it (issue: picking a practice card lower down opened it off-screen). Both
 * "New session" (with the optional topic box) and every guided / Desire & intimacy practice card open THIS,
 * so the start experience is one consistent, focused overlay. Esc / the scrim / Cancel close it (a pure no-op,
 * unless a send is in flight).
 */
export function TogetherStartDialog({
  pending,
  partnerName,
  topic,
  onTopicChange,
  busy,
  error,
  onSend,
  onClose,
}: {
  pending: StartPending;
  partnerName: string;
  topic: string;
  onTopicChange: (value: string) => void;
  busy: boolean;
  error: string | null;
  onSend: () => void;
  onClose: () => void;
}): JSX.Element {
  const isGuide = pending.kind === 'guide';

  // Esc closes unless a send is in flight — matching the app's other hand-rolled dialogs (no Tab-cycle trap).
  // Initial focus is handled by `autoFocus` on the topic box (free) or Send (guide), the ChangeVaultDialog
  // precedent.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <div
      className={styles.startOverlay}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <Card
        className={styles.startDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="together-start-title"
        onClick={(event) => event.stopPropagation()}
      >
        <Stack gap={4}>
          <div className={styles.startDialogHead}>
            <Heading level={3} id="together-start-title" className={styles.startDialogTitle}>
              <Heart size={18} aria-hidden="true" />
              {isGuide
                ? `Start “${pending.entry.title}” with ${partnerName}`
                : `Start an open session with ${partnerName}`}
            </Heading>
            <IconButton aria-label="Close" onClick={onClose} disabled={busy}>
              <X size={16} aria-hidden="true" />
            </IconButton>
          </div>

          {isGuide ? (
            <Text size="sm" tone="secondary">
              {pending.entry.blurb}
            </Text>
          ) : (
            <label className={styles.field}>
              <Text size="sm" weight={600}>
                What’s on your mind?{' '}
                <Text as="span" tone="secondary">
                  (optional)
                </Text>
              </Text>
              <TextInput
                value={topic}
                placeholder="e.g. Feeling disconnected lately"
                onChange={(e) => onTopicChange(e.target.value)}
                autoFocus
              />
            </label>
          )}

          {error ? <Banner tone="danger">{error}</Banner> : null}

          <Inline gap={2} align="center">
            <Button onClick={onSend} disabled={busy} aria-busy={busy} autoFocus={isGuide}>
              {busy ? 'Sending…' : 'Send invitation'}
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </Inline>
        </Stack>
      </Card>
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { ImageGenPhase } from '@shared/schemas';
import { Stack, Text } from '../../../design-system/components';
import styles from './ImageProgress.module.css';

/**
 * Realtime progress for a single AI **image** (or **vision**) generation — a live phase label, an elapsed
 * timer, and an ETA — shown wherever an image is being made (story cover / chapter illustration, dream image,
 * photo vision). Mandatory: NO bare spinner / "Working…" for AI generation (CLAUDE.md §12).
 *
 * The generation runs in the main process and streams `image:progress` phase events (`composing` → the Claude
 * distillation, `rendering` → the OpenAI render, `analyzing` → a vision pass) keyed by `id`. The surface
 * renders this while its own `busy` flag is set and unmounts it when the awaited call returns, so `done`/
 * `error` are ignored here (the surface owns the terminal). Vision is a single phase, so it needs no backend
 * events — the elapsed timer + ETA carry it.
 */

type Kind = 'image' | 'vision';

const PHASE_LABEL: Record<Exclude<ImageGenPhase, 'done' | 'error'>, string> = {
  composing: 'Composing the scene…',
  rendering: 'Painting the image…',
  analyzing: 'Reading your photo…',
};

// Rough, honest ETAs so the timer reads "~Ns" rather than an open-ended wait.
const ETA_SEC: Record<Kind, number> = { image: 22, vision: 12 };

/** Subscribe to `image:progress` for one generation `id`; null id = inactive (resets). Also drives a live
 *  elapsed timer from when the generation started. */
export function useImageProgress(
  id: string | null,
  kind: Kind,
): { phase: Exclude<ImageGenPhase, 'done' | 'error'>; elapsedSec: number } {
  const initial = kind === 'vision' ? 'analyzing' : 'composing';
  const [phase, setPhase] = useState<Exclude<ImageGenPhase, 'done' | 'error'>>(initial);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!id) {
      setPhase(initial);
      setElapsedSec(0);
      return;
    }
    const started = Date.now();
    setPhase(initial);
    setElapsedSec(0);
    const off = window.selfos?.onImageProgress((p) => {
      // Only this surface's generation; ignore the terminal phases (the surface unmounts us on completion).
      if (p.id !== id || p.phase === 'done' || p.phase === 'error') return;
      setPhase(p.phase);
    });
    const timer = setInterval(() => setElapsedSec(Math.floor((Date.now() - started) / 1000)), 500);
    return () => {
      off?.();
      clearInterval(timer);
    };
    // `initial` is derived from `kind`; both are in the deps.
  }, [id, kind, initial]);

  return { phase, elapsedSec };
}

export function ImageProgress({
  id,
  kind = 'image',
  label,
}: {
  /** The generation id this surface started (e.g. `story:<bookId>:cover`), or null when idle. */
  id: string | null;
  kind?: Kind;
  /** Optional heading override (defaults per kind). */
  label?: string;
}): JSX.Element {
  const { phase, elapsedSec } = useImageProgress(id, kind);
  const eta = ETA_SEC[kind];
  const remaining = eta - elapsedSec;
  const etaText =
    remaining > 3
      ? `about ${remaining}s left`
      : elapsedSec > eta + 6
        ? 'almost there…'
        : 'finishing up…';

  return (
    <Stack gap={2}>
      <div className={styles.row}>
        <span className={styles.spinner} aria-hidden="true" />
        <Text size="sm" aria-live="polite">
          {label ?? (kind === 'vision' ? 'Looking at your photo' : 'Creating your image')}
          {' — '}
          {PHASE_LABEL[phase]}
        </Text>
      </div>
      <div className={styles.track} role="progressbar" aria-label="Image generation progress">
        <div className={styles.indeterminate} />
      </div>
      <div className={styles.meta}>
        <Text size="sm" tone="secondary">
          {elapsedSec}s elapsed
        </Text>
        <Text size="sm" tone="secondary">
          {etaText}
        </Text>
      </div>
    </Stack>
  );
}

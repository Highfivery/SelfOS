import { Banner, Button, Inline, Stack, Text } from '../../../design-system/components';
import { useStoryStore } from '../../../stores/storyStore';
import styles from './Story.module.css';
import { useState } from 'react';

/**
 * The Studio (§13.2/§13.4) — the control room for a living book: one hero owning the book's identity, a
 * "Needs you" strip that gathers every pending decision (and vanishes when you're caught up), and five tabs
 * for everything else. Reuses the existing panels (cover, photos, settings, share, matter, exclusions) — this
 * is a re-architecture of the surface, not the mechanics (§3 is unchanged). The chapter reader (§3.3) is still
 * reached by opening a chapter card; the immersive Book view is a later slice (R2/R3).
 */
/**
 * The title workshop (§16.4) — one metered pass proposes N alternative titles, "suggest again" is a fresh
 * pass, and the essence (the book's through-line) can be regenerated on its own without the
 * rewrite-from-scratch that used to be the only way to re-derive it. Nothing is written until the person
 * picks: "Use this title" / "Keep this essence" commits through `update` (which clears `titleAuto`, so the
 * app never silently re-titles a book the person named).
 */
export function TitleWorkshop({
  bookId,
  onDone,
}: {
  bookId: string;
  onDone: () => void;
}): JSX.Element {
  const suggestTitles = useStoryStore((s) => s.suggestTitles);
  const regenerateEssence = useStoryStore((s) => s.regenerateEssence);
  const update = useStoryStore((s) => s.update);
  const [titles, setTitles] = useState<string[] | null>(null);
  const [essence, setEssence] = useState<string | null>(null);
  const [busy, setBusy] = useState<'titles' | 'essence' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runTitles = async (): Promise<void> => {
    setBusy('titles');
    setError(null);
    const res = await suggestTitles(bookId);
    if (res.ok) setTitles(res.titles);
    else setError(res.message ?? 'Couldn’t suggest titles just now.');
    setBusy(null);
  };
  const runEssence = async (): Promise<void> => {
    setBusy('essence');
    setError(null);
    const res = await regenerateEssence(bookId);
    if (res.ok && res.essence) setEssence(res.essence);
    else setError(res.message ?? 'Couldn’t rewrite the essence just now.');
    setBusy(null);
  };

  return (
    <div className={styles.workshop}>
      <div className={styles.workshopHead}>
        <Text size="sm" weight={500}>
          Title workshop
        </Text>
        <button type="button" className={styles.sourcesToggle} onClick={onDone}>
          Done
        </button>
      </div>
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {titles === null ? (
        <Button variant="ghost" disabled={busy !== null} onClick={runTitles}>
          {busy === 'titles' ? 'Thinking…' : 'Suggest titles'}
        </Button>
      ) : (
        <Stack gap={1}>
          {titles.map((title) => (
            <div key={title} className={styles.workshopRow}>
              <Text size="sm">{title}</Text>
              <Button
                variant="ghost"
                disabled={busy !== null}
                onClick={async () => {
                  await update(bookId, { title });
                  onDone();
                }}
              >
                Use this
              </Button>
            </div>
          ))}
          <Button variant="ghost" disabled={busy !== null} onClick={runTitles}>
            {busy === 'titles' ? 'Thinking…' : 'Suggest again'}
          </Button>
        </Stack>
      )}

      <div className={styles.workshopEssence}>
        {essence === null ? (
          <Button variant="ghost" disabled={busy !== null} onClick={runEssence}>
            {busy === 'essence' ? 'Thinking…' : 'Rewrite the essence'}
          </Button>
        ) : (
          <Stack gap={1}>
            <Text size="sm" tone="secondary">
              {essence}
            </Text>
            <Inline gap={2}>
              <Button
                variant="ghost"
                disabled={busy !== null}
                onClick={async () => {
                  await update(bookId, { essence });
                  setEssence(null);
                }}
              >
                Keep this essence
              </Button>
              <Button variant="ghost" disabled={busy !== null} onClick={() => setEssence(null)}>
                Discard
              </Button>
            </Inline>
          </Stack>
        )}
      </div>
    </div>
  );
}

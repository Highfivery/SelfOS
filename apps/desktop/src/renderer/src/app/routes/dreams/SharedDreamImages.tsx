import { useEffect, useState } from 'react';
import type { DreamSharedImage } from '@shared/channels';
import { useSessionStore } from '../../../stores/sessionStore';
import { Heading, Stack, Text } from '../../../design-system/components';
import styles from './Dreams.module.css';

type LoadedShare = DreamSharedImage & { dataBase64: string };

/**
 * "Shared with you" (13-dream-images §3.6): a lightweight gallery at the top of the Dreams journal of
 * images that **related people** have shared with the viewer. Self-hides when nothing is shared. Each
 * image is fetched via `dreamGetSharedImage`, which re-gates the relationship + share + sensitivity at
 * read time — so an un-shared or un-related image simply stops appearing. Images never feed AI context.
 */
export function SharedDreamImages(): JSX.Element | null {
  const activeId = useSessionStore((s) => s.activePerson?.id);
  const [items, setItems] = useState<LoadedShare[]>([]);

  useEffect(() => {
    let cancelled = false;
    setItems([]);
    void (async () => {
      const list = (await window.selfos?.dreamListSharedImages()) ?? [];
      const loaded = await Promise.all(
        list.map(async (item) => {
          const image = await window.selfos?.dreamGetSharedImage({
            dreamerId: item.dreamerId,
            dreamId: item.dreamId,
          });
          return image ? { ...item, dataBase64: image.dataBase64, mime: image.mime } : null;
        }),
      );
      if (!cancelled) setItems(loaded.filter((x): x is LoadedShare => x !== null));
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  if (items.length === 0) return null;

  return (
    <section className={styles.sharedSection} aria-label="Images shared with you">
      <Stack gap={2}>
        <Heading level={3}>Shared with you</Heading>
        <div className={styles.sharedGrid}>
          {items.map((item) => (
            <figure key={`${item.dreamerId}:${item.dreamId}`} className={styles.sharedItem}>
              <img
                className={styles.sharedThumb}
                src={`data:${item.mime};base64,${item.dataBase64}`}
                alt={`A dream image shared by ${item.dreamerName}`}
              />
              <figcaption>
                <Text size="xs" tone="tertiary">
                  from {item.dreamerName}
                </Text>
              </figcaption>
            </figure>
          ))}
        </div>
      </Stack>
    </section>
  );
}

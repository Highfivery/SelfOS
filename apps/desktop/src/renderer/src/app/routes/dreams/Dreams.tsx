import { useEffect, useState } from 'react';
import { ArrowLeft, Moon, Plus } from 'lucide-react';
import { useDreamStore } from '../../../stores/dreamStore';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { DreamComposer } from './DreamComposer';
import styles from './Dreams.module.css';

type Selection = { mode: 'none' } | { mode: 'new' } | { mode: 'edit'; id: string };

function preview(narrative: string): string {
  const trimmed = narrative.trim().replace(/\s+/g, ' ');
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}

/** The date the dream occurred (or, failing that, when it was logged) — just the YYYY-MM-DD portion. */
function dayLabel(dream: { dreamDate?: string | undefined; createdAt: string }): string {
  return (dream.dreamDate ?? dream.createdAt).slice(0, 10);
}

/** The Dreams journal: a master–detail of captured dreams + the capture composer (12-dreams §3). */
export function Dreams(): JSX.Element {
  const dreams = useDreamStore((s) => s.dreams);
  const loaded = useDreamStore((s) => s.loaded);
  const load = useDreamStore((s) => s.load);
  const [selection, setSelection] = useState<Selection>({ mode: 'none' });

  useEffect(() => {
    void load();
  }, [load]);

  const selected =
    selection.mode === 'edit' ? (dreams.find((d) => d.id === selection.id) ?? null) : null;
  const detailOpen = selection.mode !== 'none';

  return (
    <div className={styles.layout} data-view={detailOpen ? 'detail' : 'list'}>
      <section className={styles.list} aria-label="Dream journal">
        <div className={styles.header}>
          <Heading level={2}>Dreams</Heading>
          <Button variant="primary" onClick={() => setSelection({ mode: 'new' })}>
            <Plus size={16} aria-hidden="true" />
            Log a dream
          </Button>
        </div>

        {loaded && dreams.length === 0 ? (
          <Card>
            <Stack gap={2} align="center">
              <Moon size={24} aria-hidden="true" />
              <Text tone="secondary">
                No dreams yet. Capture one the moment you wake — before it fades.
              </Text>
            </Stack>
          </Card>
        ) : (
          <Stack gap={2}>
            {dreams.map((dream) => {
              const active = selection.mode === 'edit' && selection.id === dream.id;
              return (
                <button
                  key={dream.id}
                  type="button"
                  className={active ? `${styles.row} ${styles.rowActive}` : styles.row}
                  onClick={() => setSelection({ mode: 'edit', id: dream.id })}
                >
                  <span className={styles.rowMain}>
                    <span className={styles.rowName}>
                      {dream.title?.trim() || preview(dream.narrative)}
                    </span>
                    <span className={styles.rowMeta}>
                      {dayLabel(dream)}
                      {dream.lucid ? ' · lucid' : ''}
                      {dream.nightmare ? ' · nightmare' : ''}
                      {dream.status === 'analyzed' ? ' · analyzed' : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </Stack>
        )}
      </section>

      <section className={styles.detail}>
        <button
          type="button"
          className={styles.back}
          onClick={() => setSelection({ mode: 'none' })}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Dreams
        </button>
        {selection.mode === 'new' ? (
          <DreamComposer key="new" dream={null} onDone={() => setSelection({ mode: 'none' })} />
        ) : selected ? (
          <DreamComposer
            key={selected.id}
            dream={selected}
            onDone={() => setSelection({ mode: 'none' })}
          />
        ) : (
          <div className={styles.empty}>
            <Text tone="tertiary">Select a dream, or log a new one.</Text>
          </div>
        )}
      </section>
    </div>
  );
}

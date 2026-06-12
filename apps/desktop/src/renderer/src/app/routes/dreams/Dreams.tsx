import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, Moon, Plus, Sparkles } from 'lucide-react';
import type { Dream } from '@shared/channels';
import { useDreamStore } from '../../../stores/dreamStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { Button, Card, Heading, Inline, Stack, Text } from '../../../design-system/components';
import { DreamComposer } from './DreamComposer';
import { DreamAnalysisPane } from './DreamAnalysisPane';
import { SharedDreamImages } from './SharedDreamImages';
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

/** The analyze entry-point label depends on how far along the dream's analysis is (12-dreams §3). */
function analyzeLabel(status: Dream['status']): string {
  if (status === 'analyzed') return 'View analysis';
  if (status === 'analyzing') return 'Resume analysis';
  return 'Analyze this dream';
}

function analyzeHint(status: Dream['status']): string {
  if (status === 'analyzed') return 'Read it, edit it, or add it to your coaching context.';
  if (status === 'analyzing') return 'Pick up the reflection where you left off.';
  return 'Reflect on it with your coach when you have a moment.';
}

/** The Dreams journal: a master–detail of captured dreams + the capture composer (12-dreams §3). */
export function Dreams(): JSX.Element {
  const dreams = useDreamStore((s) => s.dreams);
  const loaded = useDreamStore((s) => s.loaded);
  const load = useDreamStore((s) => s.load);
  const activePersonId = useSessionStore((s) => s.activePerson?.id);
  const navigate = useNavigate();
  const [selection, setSelection] = useState<Selection>({ mode: 'none' });
  // Within a saved dream, the detail toggles between the editor and the in-pane analysis surface.
  const [analyzing, setAnalyzing] = useState(false);

  // Changing the selected dream (or starting a new one) always returns to the editor view.
  const select = (next: Selection): void => {
    setSelection(next);
    setAnalyzing(false);
  };

  useEffect(() => {
    void load();
  }, [load]);

  // Reset the detail selection when the active person changes — a switch must not leave another person's
  // dream selected (which on mobile would hide the list, incl. "Shared with you"). Per-person isolation.
  useEffect(() => {
    setSelection({ mode: 'none' });
    setAnalyzing(false);
  }, [activePersonId]);

  const selected =
    selection.mode === 'edit' ? (dreams.find((d) => d.id === selection.id) ?? null) : null;
  const detailOpen = selection.mode !== 'none';

  return (
    <div className={styles.layout} data-view={detailOpen ? 'detail' : 'list'}>
      <section className={styles.list} aria-label="Dream journal">
        <div className={styles.header}>
          <Heading level={2}>Dreams</Heading>
          <Inline gap={2}>
            <Button variant="secondary" onClick={() => navigate('/dreams/patterns')}>
              <BarChart3 size={16} aria-hidden="true" />
              Patterns
            </Button>
            <Button variant="primary" onClick={() => select({ mode: 'new' })}>
              <Plus size={16} aria-hidden="true" />
              Log a dream
            </Button>
          </Inline>
        </div>

        {/* Images related people have shared with you (13-dream-images §3.6); self-hides when empty. */}
        <SharedDreamImages />

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
                  onClick={() => select({ mode: 'edit', id: dream.id })}
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
        {/* The list-level back affordance (mobile) is hidden only while the analysis pane is actually
            shown (it has its own "Back to dream") — so a phone always has exactly one back action, even
            if the selected dream vanishes mid-analysis (external delete/sync) and the pane unmounts. */}
        {!(analyzing && selected) ? (
          <button type="button" className={styles.back} onClick={() => select({ mode: 'none' })}>
            <ArrowLeft size={16} aria-hidden="true" />
            Dreams
          </button>
        ) : null}
        {selection.mode === 'new' ? (
          <DreamComposer key="new" dream={null} onDone={() => select({ mode: 'none' })} />
        ) : selected ? (
          analyzing ? (
            <DreamAnalysisPane dream={selected} onBack={() => setAnalyzing(false)} />
          ) : (
            <Stack gap={4}>
              <div className={styles.analyzeEntry}>
                <Button variant="primary" onClick={() => setAnalyzing(true)}>
                  <Sparkles size={16} aria-hidden="true" />
                  {analyzeLabel(selected.status)}
                </Button>
                <Text size="sm" tone="secondary">
                  {analyzeHint(selected.status)}
                </Text>
              </div>
              <DreamComposer
                key={selected.id}
                dream={selected}
                onDone={() => select({ mode: 'none' })}
              />
            </Stack>
          )
        ) : (
          <div className={styles.empty}>
            <Text tone="tertiary">Select a dream, or log a new one.</Text>
          </div>
        )}
      </section>
    </div>
  );
}

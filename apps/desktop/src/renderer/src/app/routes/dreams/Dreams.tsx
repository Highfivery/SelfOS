import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, Moon, Plus } from 'lucide-react';
import { useDreamStore } from '../../../stores/dreamStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { Button, Card, Heading, Inline, Stack, Text } from '../../../design-system/components';
import { DreamComposer } from './DreamComposer';
import { DreamDetailView } from './DreamDetailView';
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

/** The Dreams journal: a master–detail of captured dreams + the capture composer (12-dreams §3). */
export function Dreams(): JSX.Element {
  const dreams = useDreamStore((s) => s.dreams);
  const loaded = useDreamStore((s) => s.loaded);
  const load = useDreamStore((s) => s.load);
  const activePersonId = useSessionStore((s) => s.activePerson?.id);
  const navigate = useNavigate();
  const location = useLocation();
  const [selection, setSelection] = useState<Selection>({ mode: 'none' });
  // Within a saved dream, the detail leads with the read-first view; it opens into the analysis pane
  // (`analyzing`) or the editable composer (`editing`) on demand (12 §15.3).
  const [analyzing, setAnalyzing] = useState(false);
  const [editing, setEditing] = useState(false);

  // Deep-link from Memory's provenance link (20-memory-dashboard §3.3): open the referenced dream.
  useEffect(() => {
    const focus = (location.state as { focusDreamId?: string } | null)?.focusDreamId;
    if (focus) setSelection({ mode: 'edit', id: focus });
  }, [location.state]);

  // Changing the selected dream (or starting a new one) always returns to the read-first detail.
  const select = (next: Selection): void => {
    setSelection(next);
    setAnalyzing(false);
    setEditing(false);
  };

  // "Start reflection" from a fresh capture: select the saved dream and open its guided session directly.
  const startReflectionFor = (id: string): void => {
    setSelection({ mode: 'edit', id });
    setEditing(false);
    setAnalyzing(true);
  };

  useEffect(() => {
    void load();
  }, [load]);

  // Reset the detail selection when the active person CHANGES — a switch must not leave another person's
  // dream selected (which on mobile would hide the list, incl. "Shared with you"). Per-person isolation.
  // Skip the first run so a provenance deep-link (focusDreamId, set in the effect above on mount) survives
  // — this reset effect is declared after it and would otherwise clobber the focused dream on arrival.
  const firstPersonRun = useRef(true);
  useEffect(() => {
    if (firstPersonRun.current) {
      firstPersonRun.current = false;
      return;
    }
    setSelection({ mode: 'none' });
    setAnalyzing(false);
    setEditing(false);
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
            <Stack gap={3} align="center">
              <Moon size={24} aria-hidden="true" />
              <Text tone="secondary">
                No dreams yet. Capture one the moment you wake — before it fades. SelfOS can reflect
                on it with you and notice patterns over time.
              </Text>
              <Button variant="secondary" onClick={() => select({ mode: 'new' })}>
                <Plus size={16} aria-hidden="true" />
                Log your first dream
              </Button>
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
          <DreamComposer
            key="new"
            dream={null}
            onStartReflection={startReflectionFor}
            onDone={() => select({ mode: 'none' })}
          />
        ) : selected ? (
          analyzing ? (
            <DreamAnalysisPane dream={selected} onBack={() => setAnalyzing(false)} />
          ) : editing ? (
            <DreamComposer key={selected.id} dream={selected} onDone={() => setEditing(false)} />
          ) : (
            <DreamDetailView
              dream={selected}
              onReflect={() => setAnalyzing(true)}
              onEdit={() => setEditing(true)}
            />
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

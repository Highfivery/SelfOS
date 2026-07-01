import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, Moon, Plus } from 'lucide-react';
import { useDreamStore } from '../../../stores/dreamStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { Button, Card, Heading, Inline, Stack, Text } from '../../../design-system/components';
import { DreamCard } from './DreamCard';
import { DreamComposer } from './DreamComposer';
import { DreamDetailView } from './DreamDetailView';
import { DreamAnalysisPane } from './DreamAnalysisPane';
import { SharedDreamImages } from './SharedDreamImages';
import styles from './Dreams.module.css';

type Selection = { mode: 'none' } | { mode: 'new' } | { mode: 'edit'; id: string };

/**
 * The Dreams dashboard (12-dreams §16): an image-forward grid of dream cards. Selecting a card opens the
 * dream full-width (an immersive detail with an image hero); there's no empty side pane.
 */
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
  // Decrypted image thumbnails for the dreams that have one (data URLs, keyed by dream id).
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  // Deep-link from Memory's provenance link (20-memory-dashboard §3.3): open the referenced dream.
  useEffect(() => {
    const focus = (location.state as { focusDreamId?: string } | null)?.focusDreamId;
    if (focus) setSelection({ mode: 'edit', id: focus });
  }, [location.state]);

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

  // Lazily fetch the image thumbnails for dreams that have one (no spend — deterministic reads). Re-runs
  // when the dream list changes (incl. a person switch clearing it, so no stale image leaks across people).
  useEffect(() => {
    let cancelled = false;
    const withImages = dreams.filter((dream) => dream.image);
    if (withImages.length === 0) {
      setThumbs({});
      return;
    }
    void Promise.all(
      withImages.map(async (dream): Promise<[string, string] | null> => {
        const img = await window.selfos?.dreamGetImage({ dreamId: dream.id });
        return img ? [dream.id, `data:${img.mime};base64,${img.dataBase64}`] : null;
      }),
    ).then((pairs) => {
      if (cancelled) return;
      setThumbs(Object.fromEntries(pairs.filter((p): p is [string, string] => p !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [dreams]);

  // Reset the detail selection when the active person CHANGES — a switch must not leave another person's
  // dream open. Per-person isolation. Skip the first run so a provenance deep-link (focusDreamId, set on
  // mount) survives — this reset effect is declared after it and would otherwise clobber the focus.
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

  // --- Full-width immersive detail (a dream is open, or a new one is being captured) ---
  if (selection.mode !== 'none') {
    return (
      <div className={styles.detailLayout}>
        {/* One back affordance: hidden only while the analysis pane is shown (it has its own back). */}
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
          <Text tone="tertiary">This dream is no longer available.</Text>
        )}
      </div>
    );
  }

  // --- The dashboard grid ---
  return (
    <div className={styles.dashboard} aria-label="Dream journal">
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

      {!loaded ? null : dreams.length === 0 ? (
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
        <div className={styles.grid}>
          <button
            type="button"
            className={`${styles.card} ${styles.cardCreate}`}
            aria-label="Log a new dream"
            onClick={() => select({ mode: 'new' })}
          >
            <Plus size={26} aria-hidden="true" />
            Log a dream
          </button>
          {dreams.map((dream) => (
            <DreamCard
              key={dream.id}
              dream={dream}
              imageUrl={thumbs[dream.id]}
              onOpen={() => select({ mode: 'edit', id: dream.id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

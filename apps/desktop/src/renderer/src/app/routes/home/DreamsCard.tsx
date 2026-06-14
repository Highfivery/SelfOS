import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Moon } from 'lucide-react';
import type { Dream } from '@shared/channels';
import type { DreamPatternStats } from '@shared/schemas';
import { Card, FrequencyBars, Heading, Stack, Text } from '../../../design-system/components';
import styles from './Home.module.css';

/** The top recurring symbol, else theme — the single "pattern highlight" (12 §3.5). */
function topPattern(stats: DreamPatternStats | null): { label: string; value: number }[] {
  if (!stats) return [];
  const source = stats.symbols.length > 0 ? stats.symbols : stats.themes;
  return source.slice(0, 3).map((s) => ({ label: s.label, value: s.count }));
}

/**
 * "Recent dreams" — the latest 2–3 dreams (title/snippet + thumbnail if an image exists, 13) and a
 * pattern highlight (top recurring symbol/theme, 12 §3.5). Links to Dreams / Patterns. Hidden if no
 * dreams. Thumbnails are fetched lazily for the shown dreams only (no spend; deterministic reads).
 */
export function DreamsCard({
  dreams,
  stats,
}: {
  dreams: Dream[];
  stats: DreamPatternStats | null;
}): JSX.Element | null {
  const navigate = useNavigate();
  const recent = [...dreams].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const withImages = recent.filter((d) => d.image);
    void Promise.all(
      withImages.map(async (d): Promise<[string, string] | null> => {
        const img = await window.selfos?.dreamGetImage({ dreamId: d.id });
        return img ? [d.id, `data:${img.mime};base64,${img.dataBase64}`] : null;
      }),
    ).then((pairs) => {
      if (cancelled) return;
      setThumbs(Object.fromEntries(pairs.filter((p): p is [string, string] => p !== null)));
    });
    return () => {
      cancelled = true;
    };
    // Re-fetch when the set of shown dream ids changes.
  }, [recent.map((d) => d.id).join(',')]);

  if (dreams.length === 0) return null;

  const pattern = topPattern(stats);

  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.cardHead}>
          <Heading level={2}>Recent dreams</Heading>
          <button type="button" className={styles.cardLink} onClick={() => navigate('/dreams')}>
            Open Dreams
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.rows}>
          {recent.map((d) => (
            <div key={d.id} className={styles.dreamRow}>
              {thumbs[d.id] ? (
                <img className={styles.thumb} src={thumbs[d.id]} alt="" />
              ) : (
                <span className={styles.thumbPlaceholder} aria-hidden="true">
                  <Moon size={18} />
                </span>
              )}
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>{d.title?.trim() || 'Untitled dream'}</span>
                <span className={styles.snippet}>{d.narrative}</span>
              </div>
            </div>
          ))}
        </div>

        {pattern.length > 0 ? (
          <div className={styles.patternHighlight}>
            <p className={styles.eyebrow}>Recurring lately</p>
            <FrequencyBars items={pattern} />
            <button
              type="button"
              className={styles.cardLink}
              onClick={() => navigate('/dreams/patterns')}
            >
              See patterns
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <Text size="sm" tone="tertiary">
            Patterns appear as you log and analyze more dreams.
          </Text>
        )}
      </Stack>
    </Card>
  );
}

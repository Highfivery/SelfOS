import { useNavigate } from 'react-router-dom';
import { ArrowRight, MoonStar, Sparkles, Zap } from 'lucide-react';
import type { DreamPatternStats } from '@shared/schemas';
import { moodCue } from './dashboard';
import styles from './Dreams.module.css';

/**
 * A slim, deterministic "insight strip" atop the Dreams dashboard (12 §16.2 decision 5) — the top recurring
 * theme, lucid/nightmare counts, and a gentle mood cue drawn from `dreamPatternService.computePatternStats`
 * (no AI, no spend). Self-hides when there isn't enough to say. "See patterns →" opens the full patterns view.
 */
export function DreamInsightStrip({
  stats,
}: {
  stats: DreamPatternStats | null;
}): JSX.Element | null {
  const navigate = useNavigate();
  if (!stats || stats.dreamCount < 2) return null;

  const theme = stats.themes[0]?.label;
  const mood = moodCue(stats.moodTrend);
  const items: JSX.Element[] = [];

  if (theme) {
    items.push(
      <span key="theme" className={styles.stripItem}>
        <Sparkles size={14} aria-hidden="true" />
        Recurring: <strong>{theme}</strong>
      </span>,
    );
  }
  if (stats.lucidCount > 0) {
    items.push(
      <span key="lucid" className={styles.stripItem}>
        <MoonStar size={14} aria-hidden="true" />
        {stats.lucidCount} lucid
      </span>,
    );
  }
  if (stats.nightmareCount > 0) {
    items.push(
      <span key="nightmare" className={styles.stripItem}>
        <Zap size={14} aria-hidden="true" />
        {stats.nightmareCount} {stats.nightmareCount === 1 ? 'nightmare' : 'nightmares'}
      </span>,
    );
  }
  if (mood) {
    items.push(
      <span key="mood" className={styles.stripItem}>
        {mood}
      </span>,
    );
  }

  // Nothing worth showing beyond the raw count → stay hidden rather than render an empty strip.
  if (items.length === 0) return null;

  return (
    <div className={styles.insightStrip}>
      <div className={styles.stripItems}>{items}</div>
      <button
        type="button"
        className={styles.stripLink}
        onClick={() => navigate('/dreams/patterns')}
      >
        See patterns
        <ArrowRight size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

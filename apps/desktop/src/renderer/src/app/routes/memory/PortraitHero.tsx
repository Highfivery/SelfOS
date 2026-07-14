import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Card, Markdown, Text } from '../../../design-system/components';
import type { KnowsYouRead } from './overview';
import styles from './Memory.module.css';

/** The first paragraph, capped — the clamped lead shown before "Read your full portrait". */
function leadOf(full: string): string {
  const firstPara = full.split(/\n{2,}/)[0]?.trim() ?? '';
  if (firstPara.length <= 320) return firstPara;
  return `${firstPara.slice(0, 320).replace(/\s+\S*$/, '')}…`;
}

/**
 * The portrait hero (62 §3.4) — a warm intro at the top of "about you": an initial tile, the onboarding
 * portrait's narrative (clamped, with "Read your full portrait" expanding in place), a calm "knows you" read
 * (text, never colour alone — §9), and an "Edit your answers" deep-link to onboarding. The portrait's facts
 * are edited via onboarding, not here — the hero is the readable intro; the life-area sections are the
 * correctable AI insights.
 */
export function PortraitHero({
  initial,
  summary,
  knows,
  onEditAnswers,
}: {
  initial: string;
  summary: string;
  knows: KnowsYouRead;
  onEditAnswers: () => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const full = summary.trim();
  const lead = leadOf(full);
  const hasMore = full.length > lead.length;

  return (
    <Card className={styles.hero}>
      <div className={styles.heroHead}>
        <span className={styles.heroAvatar} aria-hidden="true">
          {initial}
        </span>
        <div className={styles.heroHeadText}>
          <Text weight={600}>Your portrait</Text>
          <Text size="xs" tone="tertiary">
            from onboarding · updated as SelfOS learns
          </Text>
        </div>
        <span className={styles.heroKnows}>
          <span className={styles.heroKnowsMeter} aria-hidden="true">
            {[1, 2, 3].map((i) => (
              <span key={i} className={i <= knows.level ? styles.meterOn : styles.meterOff} />
            ))}
          </span>
          {knows.label}
        </span>
      </div>

      {full ? (
        <div className={styles.heroBody}>
          <Markdown>{expanded ? full : lead}</Markdown>
        </div>
      ) : (
        <Text tone="secondary">
          A picture of you is taking shape — the more you reflect, the fuller it gets.
        </Text>
      )}

      <div className={styles.heroActions}>
        {hasMore ? (
          <button
            type="button"
            className={styles.heroLink}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Show less' : 'Read your full portrait'}
          </button>
        ) : null}
        <button type="button" className={styles.heroLinkMuted} onClick={onEditAnswers}>
          <Pencil size={13} aria-hidden="true" /> Edit your answers
        </button>
      </div>
    </Card>
  );
}

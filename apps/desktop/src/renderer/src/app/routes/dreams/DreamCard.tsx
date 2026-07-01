import { Check, MoonStar, Sparkles, Zap } from 'lucide-react';
import type { Dream } from '@shared/channels';
import { useSessionStore } from '../../../stores/sessionStore';
import styles from './Dreams.module.css';

/** Mid-tone "dreamy" gradients for cards without a generated image — seeded by id so each reads distinct.
 * Every card (image or fallback) is a colour field with a dark scrim + white text, so this is theme-safe. */
const FALLBACK_GRADIENTS = [
  'linear-gradient(160deg, #66708f, #3d4763)',
  'linear-gradient(160deg, #77698d, #453b63)',
  'linear-gradient(160deg, #5f7a76, #384f4b)',
  'linear-gradient(160deg, #8a7a68, #574733)',
  'linear-gradient(160deg, #6a6a86, #403c58)',
];
/** A nightmare without an image gets a cool, calm tint — evocative, never alarming (12 §8.2). */
const NIGHTMARE_GRADIENT = 'linear-gradient(160deg, #5b6472, #343a46)';

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function dayLabel(dream: Dream): string {
  return (dream.dreamDate ?? dream.createdAt).slice(0, 10);
}

function preview(narrative: string): string {
  const trimmed = narrative.trim().replace(/\s+/g, ' ');
  return trimmed.length > 100 ? `${trimmed.slice(0, 100)}…` : trimmed;
}

/**
 * One dream in the dashboard grid (12-dreams §16.3): a tall (3:4), image-forward tile. A dream with a
 * generated image shows it under a scrim; without one it shows a themed gradient + a soft moon motif (and,
 * when image generation is available, a "Visualize" hint in the footer). Status badges (nightmare, lucid,
 * analyzed) sit top-right. Everything the reader needs — a 2-line title + the date — lives in a bottom scrim
 * so nothing overlaps at any card height. The whole card is one button; its accessible name is the title +
 * date + statuses.
 */
export function DreamCard({
  dream,
  imageUrl,
  onOpen,
}: {
  dream: Dream;
  imageUrl?: string | undefined;
  onOpen: () => void;
}): JSX.Element {
  const canGenerate = useSessionStore((s) => s.can('dreams.generateImage'));
  const hasTitle = Boolean(dream.title?.trim());
  const title = hasTitle ? (dream.title as string).trim() : preview(dream.narrative);
  const date = dayLabel(dream);

  const badges = [
    dream.nightmare ? { key: 'nightmare', icon: <Zap size={13} aria-hidden="true" /> } : null,
    dream.lucid ? { key: 'lucid', icon: <MoonStar size={13} aria-hidden="true" /> } : null,
    dream.status === 'analyzed'
      ? { key: 'analyzed', icon: <Check size={13} aria-hidden="true" /> }
      : null,
  ].filter((b): b is { key: string; icon: JSX.Element } => b !== null);

  const label = [
    title,
    date,
    dream.lucid ? 'lucid' : null,
    dream.nightmare ? 'nightmare' : null,
    dream.status === 'analyzed' ? 'analyzed' : null,
  ]
    .filter(Boolean)
    .join(', ');

  const background = imageUrl
    ? undefined
    : dream.nightmare
      ? NIGHTMARE_GRADIENT
      : FALLBACK_GRADIENTS[hash(dream.id) % FALLBACK_GRADIENTS.length];

  return (
    <button
      type="button"
      className={styles.card}
      aria-label={label}
      onClick={onOpen}
      style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : { background }}
    >
      {!imageUrl ? <MoonStar className={styles.cardMoon} size={30} aria-hidden="true" /> : null}

      {badges.length > 0 ? (
        <span className={styles.cardBadges}>
          {badges.map((b) => (
            <span key={b.key} className={styles.cardBadge}>
              {b.icon}
            </span>
          ))}
        </span>
      ) : null}

      <span className={styles.cardScrim}>
        <span className={styles.cardTitle}>{title}</span>
        <span className={styles.cardMeta}>
          <span className={styles.cardDate}>{date}</span>
          {!imageUrl && canGenerate ? (
            <span className={styles.cardViz}>
              <Sparkles size={11} aria-hidden="true" />
              Visualize
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

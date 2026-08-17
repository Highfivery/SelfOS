import { Lock } from 'lucide-react';
import { Heading, Text } from '../../../design-system/components';
import styles from './You.module.css';
import adaptive from './Adaptive.module.css';

/**
 * The header both adaptive screens share (74 §3.6.4).
 *
 * They had drifted into two different looks for the same feature — the take's invitation used a
 * `SELFOS · DIRTY TALK` eyebrow, a larger lead line and a bounded reading measure, while the report used a
 * bare `SELFOS` eyebrow, a small full-width lead, and put its framing line above the content instead of under
 * it. Same test, two typographic systems, one screen apart. One component means that can't happen again: a
 * change to the head is a change to both.
 *
 * The measure is deliberately bounded here and NOWHERE else — a heading and a sentence read badly at 1300px,
 * while the report's own body (bars, charts, chip rows) still fills the full width per §12.
 */
export function AdaptiveHead({
  title,
  lead,
  framing,
  /** Show the "yours" lock chip — the report carries it, the take's intro states the same thing in full. */
  yours = false,
}: {
  title: string;
  lead: string;
  framing?: string;
  yours?: boolean;
}): JSX.Element {
  return (
    <header className={adaptive.screenHead}>
      <span className={styles.eyebrow}>
        SelfOS · Dirty talk
        {yours ? (
          <span className={styles.privateTag}>
            <Lock size={11} aria-hidden="true" /> yours
          </span>
        ) : null}
      </span>
      <Heading level={1}>{title}</Heading>
      <Text tone="secondary" className={adaptive.introBlurb}>
        {lead}
      </Text>
      {framing ? (
        <Text size="sm" tone="tertiary" className={styles.framing}>
          {framing}
        </Text>
      ) : null}
    </header>
  );
}

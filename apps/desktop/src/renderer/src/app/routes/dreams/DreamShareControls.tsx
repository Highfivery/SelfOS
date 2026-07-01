import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { DreamShareTarget, InsightFact } from '@shared/schemas';
import { Heading, Markdown, Stack, Text } from '../../../design-system/components';
import styles from './Dreams.module.css';

interface DreamShareControlsProps {
  facts: InsightFact[];
  targets: DreamShareTarget[];
  onSetShare: (factId: string, withPersonId: string, share: boolean) => void;
}

/**
 * A friendly title for a dream-insight fact (12 §3.4). Dream facts come from two known analysis sections
 * (their ids end `:emotional` / `:waking`, set in `approveAnalysis`), so a shareable fact reads as a titled
 * row — "Emotional landscape" / "Possible waking-life connections" — with its full reflection tucked behind
 * an expander. Any other fact falls back to a short, markdown-stripped preview of its text.
 */
function factTitle(fact: InsightFact): string {
  if (fact.id.endsWith(':emotional')) return 'Emotional landscape';
  if (fact.id.endsWith(':waking')) return 'Possible waking-life connections';
  const plain = fact.text.replace(/[*_`#>]/g, '').trim();
  const first = plain.split(/(?<=[.!?])\s/)[0] ?? plain;
  return first.length > 64 ? `${first.slice(0, 64).trimEnd()}…` : first;
}

/**
 * Per-dream sharing controls (12-dreams §3.4), shown on an approved analysis whose dream may inform context
 * (15-shareability §3.2 — available for every sensitivity tier, gated only by the dream-level
 * `informsContext` switch). Each reflection is a **titled, collapsible** row: the title (click to read the
 * full markdown reflection) plus a set of **person chips** — tap any of the dreamer's related people to
 * share that reflection into their coaching context (a filled chip = shared; multiple people at once, since
 * `InsightFact.shareableWith` is a per-person list). Nothing else from the dream is ever shared, and never
 * the dream itself. Self-hides when there's no one to share with.
 */
export function DreamShareControls({
  facts,
  targets,
  onSetShare,
}: DreamShareControlsProps): JSX.Element | null {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (targets.length === 0) return null;

  const toggleExpanded = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={styles.shareSection}>
      <Heading level={3}>Share with people in your life</Heading>
      <Text size="xs" tone="tertiary">
        Tap a name to add a reflection to that person’s coaching context — you can share each with
        more than one person. Nothing else from this dream is shared, and never the dream itself.
      </Text>

      <Stack gap={2}>
        {facts.map((fact) => {
          const sharedWith = fact.shareableWith ?? [];
          const title = factTitle(fact);
          const isOpen = expanded.has(fact.id);
          const bodyId = `dream-fact-${fact.id}`;
          return (
            <div key={fact.id} className={styles.shareFact}>
              <div className={styles.shareFactHead}>
                <button
                  type="button"
                  className={styles.shareFactToggle}
                  onClick={() => toggleExpanded(fact.id)}
                  aria-expanded={isOpen}
                  aria-controls={bodyId}
                >
                  {isOpen ? (
                    <ChevronDown size={16} aria-hidden="true" />
                  ) : (
                    <ChevronRight size={16} aria-hidden="true" />
                  )}
                  <span className={styles.shareFactTitle}>{title}</span>
                </button>
              </div>

              <div className={styles.sharePeople} role="group" aria-label={`Share ${title} with`}>
                {targets.map((target) => {
                  const on = sharedWith.includes(target.id);
                  return (
                    <button
                      key={target.id}
                      type="button"
                      className={
                        on ? `${styles.personChip} ${styles.personChipOn}` : styles.personChip
                      }
                      aria-pressed={on}
                      onClick={() => onSetShare(fact.id, target.id, !on)}
                    >
                      {on ? (
                        <Check size={13} aria-hidden="true" />
                      ) : (
                        <Plus size={13} aria-hidden="true" />
                      )}
                      {target.displayName}
                    </button>
                  );
                })}
              </div>

              {isOpen ? (
                <div id={bodyId} className={styles.shareFactBody}>
                  <Markdown tone="secondary">{fact.text}</Markdown>
                </div>
              ) : null}
            </div>
          );
        })}
      </Stack>
    </div>
  );
}

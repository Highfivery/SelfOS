import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { DreamShareTarget, InsightFact } from '@shared/schemas';
import {
  Field,
  Heading,
  Markdown,
  Select,
  Stack,
  Switch,
  Text,
} from '../../../design-system/components';
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
 * `informsContext` switch). Pick one of the dreamer's related people, then tick which insight reflections
 * reach that person's coaching context. Each reflection is a **titled, collapsible** row: the title + share
 * toggle are always visible; the full (markdown-rendered) reflection expands on demand — so the section reads
 * as a short list, not a wall of text. Self-hides when there's no one to share with.
 */
export function DreamShareControls({
  facts,
  targets,
  onSetShare,
}: DreamShareControlsProps): JSX.Element | null {
  const [selected, setSelected] = useState(targets[0]?.id ?? '');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (targets.length === 0) return null;

  // Reconcile a stale selection (e.g. the chosen person's relationship was removed since mount) so the
  // controls never point at a person no longer in `targets`.
  const active = targets.some((target) => target.id === selected)
    ? selected
    : (targets[0]?.id ?? '');
  const nameOf = (id: string): string =>
    targets.find((target) => target.id === id)?.displayName ?? 'someone';
  const toggleExpanded = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={styles.shareSection}>
      <Heading level={3}>Share with someone in your life</Heading>
      <Text size="xs" tone="tertiary">
        Only the reflections you tick reach that person’s coaching context — nothing else from this
        dream, and never the dream itself.
      </Text>

      <Field label="Share with">
        {(p) => (
          <Select {...p} value={active} onChange={(event) => setSelected(event.target.value)}>
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.displayName}
              </option>
            ))}
          </Select>
        )}
      </Field>

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
                <Switch
                  checked={sharedWith.includes(active)}
                  onChange={(next) => onSetShare(fact.id, active, next)}
                  aria-label={`Share ${title} with ${nameOf(active)}`}
                />
              </div>
              {isOpen ? (
                <div id={bodyId} className={styles.shareFactBody}>
                  <Markdown tone="secondary">{fact.text}</Markdown>
                </div>
              ) : null}
              {sharedWith.length > 0 ? (
                <Text size="xs" tone="tertiary">
                  Shared with {sharedWith.map(nameOf).join(', ')}
                </Text>
              ) : null}
            </div>
          );
        })}
      </Stack>
    </div>
  );
}

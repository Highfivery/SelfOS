import { useState } from 'react';
import type { DreamShareTarget, InsightFact } from '@shared/schemas';
import { Field, Heading, Select, Stack, Switch, Text } from '../../../design-system/components';
import styles from './Dreams.module.css';

interface DreamShareControlsProps {
  facts: InsightFact[];
  targets: DreamShareTarget[];
  onSetShare: (factId: string, withPersonId: string, share: boolean) => void;
}

/**
 * Per-dream sharing controls (12-dreams §3.4), shown on an approved analysis whose dream may inform context
 * (15-shareability §3.2 — available for every sensitivity tier now, gated only by the dream-level
 * `informsContext` switch). Pick one of the dreamer's related people, then tick which insight facts reach
 * that person's coaching context. Each fact shows who it's shared with. Self-hides when there's no one to
 * share with.
 */
export function DreamShareControls({
  facts,
  targets,
  onSetShare,
}: DreamShareControlsProps): JSX.Element | null {
  const [selected, setSelected] = useState(targets[0]?.id ?? '');
  if (targets.length === 0) return null;

  // Reconcile a stale selection (e.g. the chosen person's relationship was removed since mount) so the
  // controls never point at a person no longer in `targets`.
  const active = targets.some((target) => target.id === selected)
    ? selected
    : (targets[0]?.id ?? '');
  const nameOf = (id: string): string =>
    targets.find((target) => target.id === id)?.displayName ?? 'someone';

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

      <Stack gap={3}>
        {facts.map((fact) => {
          const sharedWith = fact.shareableWith ?? [];
          return (
            <div key={fact.id} className={styles.shareFact}>
              <div className={styles.shareToggle}>
                <Switch
                  checked={sharedWith.includes(active)}
                  onChange={(next) => onSetShare(fact.id, active, next)}
                  aria-label={`Share “${fact.text}” with ${nameOf(active)}`}
                />
                <Text size="sm">{fact.text}</Text>
              </div>
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

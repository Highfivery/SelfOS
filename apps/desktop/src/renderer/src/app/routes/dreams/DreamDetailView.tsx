import { Pencil, Sparkles } from 'lucide-react';
import type { Dream } from '@shared/channels';
import { usePeopleStore } from '../../../stores/peopleStore';
import { Button, Heading, Stack, Text } from '../../../design-system/components';
import { DreamImagePanel } from './DreamImagePanel';
import styles from './Dreams.module.css';

/** The date the dream occurred (or, failing that, when it was logged) — just the YYYY-MM-DD portion. */
function dayLabel(dream: Dream): string {
  return (dream.dreamDate ?? dream.createdAt).slice(0, 10);
}

/** The reflection entry label depends on how far along the dream's analysis is (12-dreams §15.3). */
function reflectLabel(status: Dream['status']): string {
  if (status === 'analyzed') return 'View analysis';
  if (status === 'analyzing') return 'Resume reflection';
  return 'Start reflection';
}

function reflectHint(status: Dream['status']): string {
  if (status === 'analyzed') return 'Read it, edit it, or add it to your coaching context.';
  if (status === 'analyzing') return 'Pick up the reflection where you left off.';
  return 'Talk it through with your coach, then create an analysis.';
}

/**
 * The read-first dream detail (12-dreams §15.3): opening a saved dream **leads with the reflection**
 * (Start / Resume / View analysis) over a compact read of the dream — not the editable form. The form is a
 * step away behind **"Edit dream."** So re-entering a dream feels like re-opening a session, not a form.
 */
export function DreamDetailView({
  dream,
  onReflect,
  onEdit,
}: {
  dream: Dream;
  onReflect: () => void;
  onEdit: () => void;
}): JSX.Element {
  const householdPeople = usePeopleStore((s) => s.people);
  const nameById = new Map(householdPeople.map((person) => [person.id, person.displayName]));
  const peopleNames = dream.people
    .map((ref) => (ref.personId ? (nameById.get(ref.personId) ?? 'Someone you know') : ref.name))
    .filter((name): name is string => Boolean(name));

  const markers = [
    dream.lucid ? 'Lucid' : null,
    dream.nightmare ? 'Nightmare' : null,
    ...dream.tags,
  ].filter((label): label is string => Boolean(label));

  return (
    <Stack gap={4}>
      {/* A generated image leads the detail as a hero banner (12 §16.4). A dream without one keeps the
          visualize panel lower (below) so a "set up dream images" prompt never dominates the top. */}
      {dream.image ? <DreamImagePanel dream={dream} hero /> : null}

      <div>
        <Heading level={2}>{dream.title?.trim() || 'Dream'}</Heading>
        <Text size="sm" tone="tertiary">
          {dayLabel(dream)}
        </Text>
      </div>

      <div className={styles.reflectEntry}>
        <Button variant="primary" onClick={onReflect}>
          <Sparkles size={16} aria-hidden="true" />
          {reflectLabel(dream.status)}
        </Button>
        <Text size="sm" tone="secondary">
          {reflectHint(dream.status)}
        </Text>
      </div>

      <p className={styles.detailRead}>{dream.narrative}</p>

      {markers.length > 0 ? (
        <div className={styles.detailChips}>
          {markers.map((label) => (
            <span key={label} className={styles.detailChip}>
              {label}
            </span>
          ))}
        </div>
      ) : null}
      {peopleNames.length > 0 ? (
        <Text size="sm" tone="tertiary">
          People in the dream: {peopleNames.join(', ')}
        </Text>
      ) : null}

      {/* No image yet → the visualize panel lives here (13 §3.1); with an image it's the hero above. */}
      {dream.image ? null : <DreamImagePanel dream={dream} />}

      <div>
        <Button variant="secondary" onClick={onEdit}>
          <Pencil size={16} aria-hidden="true" />
          Edit dream
        </Button>
      </div>
    </Stack>
  );
}

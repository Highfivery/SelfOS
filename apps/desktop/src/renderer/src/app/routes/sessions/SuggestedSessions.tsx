import { useNavigate } from 'react-router-dom';
import { RefreshCw, Sparkles } from 'lucide-react';
import { getExercise } from '@selfos/core/conversations';
import { useGuidanceStore } from '../../../stores/guidanceStore';
import { Button, Heading, Stack, Text } from '../../../design-system/components';
import { GuidedExerciseCard } from './GuidedExerciseCard';
import styles from './Launcher.module.css';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/**
 * The AI "Suggested for you" row (16 §3.4). Explicit-first-tap: nothing is generated (spent) just by
 * opening the launcher — the user taps "Get personalized suggestions" (and Refresh) to spend. Calm states
 * for AI-off / over-budget / thin-profile; the catalog still works regardless.
 */
export function SuggestedSessions({
  configured,
  onPick,
}: {
  configured: boolean;
  onPick: (guideId: string) => void;
}): JSX.Element {
  const navigate = useNavigate();
  const suggestions = useGuidanceStore((s) => s.suggestions);
  const generating = useGuidanceStore((s) => s.generating);
  const error = useGuidanceStore((s) => s.error);
  const loaded = useGuidanceStore((s) => s.loaded);
  const generate = useGuidanceStore((s) => s.generate);

  const items = (suggestions?.items ?? [])
    .map((s) => ({ exercise: getExercise(s.guideId), reason: s.reason }))
    .filter((x): x is { exercise: NonNullable<typeof x.exercise>; reason: string } =>
      Boolean(x.exercise),
    );

  return (
    <section className={styles.section} aria-label="Suggested for you">
      <div className={styles.sectionHead}>
        <Heading level={3}>Suggested for you</Heading>
        {configured && suggestions ? (
          <Button variant="secondary" onClick={() => void generate()} disabled={generating}>
            <RefreshCw size={14} aria-hidden="true" />
            {generating ? 'Refreshing…' : 'Refresh'}
          </Button>
        ) : null}
      </div>

      {!configured ? (
        <Text tone="secondary" size="sm">
          Turn on AI in{' '}
          <button type="button" className={styles.linkButton} onClick={() => navigate('/settings')}>
            Settings
          </button>{' '}
          to get personalized suggestions.
        </Text>
      ) : generating && !suggestions ? (
        <div role="status">
          <Text tone="secondary" size="sm">
            Finding a few that fit you…
          </Text>
        </div>
      ) : items.length > 0 ? (
        <Stack gap={2}>
          <div className={styles.grid}>
            {items.map(({ exercise, reason }) => (
              <GuidedExerciseCard
                key={exercise.id}
                exercise={exercise}
                reason={reason}
                onPick={() => onPick(exercise.id)}
              />
            ))}
          </div>
          {suggestions ? (
            <Text tone="tertiary" size="xs">
              Updated {relativeTime(suggestions.generatedAt)}
            </Text>
          ) : null}
        </Stack>
      ) : (
        <Stack gap={2}>
          {error ? (
            <Text tone="secondary" size="sm">
              {error}
            </Text>
          ) : (
            <Text tone="secondary" size="sm">
              Get a few exercises picked for you, based on your profile and recent sessions.
            </Text>
          )}
          {loaded ? (
            <div>
              <Button variant="secondary" onClick={() => void generate()} disabled={generating}>
                <Sparkles size={14} aria-hidden="true" />
                {generating ? 'Finding…' : 'Get personalized suggestions'}
              </Button>
            </div>
          ) : null}
        </Stack>
      )}
    </section>
  );
}

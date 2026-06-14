import { GUIDED_GROUPS, listExercises } from '@selfos/core/conversations';
import { Button, Card, Stack, Text } from '../../../design-system/components';
import { GuidedExerciseCard } from './GuidedExerciseCard';
import styles from './Launcher.module.css';

/**
 * The grouped, built-in catalog (16 §3.2). Non-clinical group titles; the framework lives in each card's
 * tag. Groups are collapsible (native <details>). The Intimacy & connection group is gated behind a
 * one-time 18+ acknowledgement (§8.3).
 */
export function GuidedCatalog({
  onPick,
  adultAcknowledged,
  onAcknowledgeAdult,
}: {
  onPick: (guideId: string) => void;
  adultAcknowledged: boolean;
  onAcknowledgeAdult: () => void;
}): JSX.Element {
  const all = listExercises();
  return (
    <Stack gap={3}>
      {GUIDED_GROUPS.map((group) => {
        const items = all.filter((e) => e.group === group.id);
        const isIntimacy = group.id === 'intimacy';
        const gated = isIntimacy && !adultAcknowledged;
        return (
          // A native <details> group; the title is a styled span (not a heading) to avoid nesting a
          // heading inside the summary's disclosure button (16 §9). The <section> labels the region.
          <section key={group.id} aria-label={group.title}>
            <details className={styles.group} open={!isIntimacy}>
              <summary className={styles.groupSummary}>
                <span className={styles.groupTitle}>{group.title}</span>
                {isIntimacy ? <span className={styles.adultTag}>18+</span> : null}
              </summary>
              {gated ? (
                <Card>
                  <Stack gap={2}>
                    <Text>
                      These are reflective, relational exercises for adults — self-help, not
                      therapy. Please confirm you’re 18 or older to view them.
                    </Text>
                    <div>
                      <Button variant="secondary" onClick={onAcknowledgeAdult}>
                        I’m 18 or older
                      </Button>
                    </div>
                  </Stack>
                </Card>
              ) : (
                <div className={styles.grid}>
                  {items.map((exercise) => (
                    <GuidedExerciseCard
                      key={exercise.id}
                      exercise={exercise}
                      onPick={() => onPick(exercise.id)}
                    />
                  ))}
                </div>
              )}
            </details>
          </section>
        );
      })}
    </Stack>
  );
}

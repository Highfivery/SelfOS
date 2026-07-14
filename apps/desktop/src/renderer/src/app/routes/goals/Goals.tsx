import { useEffect, useMemo } from 'react';
import { Card, Heading, Stack, Text } from '../../../design-system/components';
import { useGoalStore } from '../../../stores/goalStore';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { GoalCard } from './GoalCard';
import { TogetherCommitments } from './TogetherCommitments';
import styles from './Goals.module.css';

/**
 * "Goals" (`/goals`, 57-memory-overview-redesign §3.7) — the active person's tracked goals & commitments, on
 * their own top-level page (extracted from Memory so "what SelfOS knows about you" stays focused). Reuses the
 * 39-living-memory `Goal` data + store + `GoalCard` verbatim; only the page + nav entry are new. Active goals
 * (open / in-progress / stale) lead; completed & closed fold into a collapsed history. The store is loaded +
 * per-person reset in AppShell; a mount load keeps it fresh on direct navigation. Crisis footer always present.
 */
export function Goals(): JSX.Element {
  const goals = useGoalStore((s) => s.goals);
  const loaded = useGoalStore((s) => s.loaded);
  const load = useGoalStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  // Active goals (open/in-progress — `stale` derives from these) above; closed (done/let go) fold into a
  // collapsed history. The store returns newest-first.
  const activeGoals = useMemo(
    () =>
      goals.filter((g) => g.status === 'open' || g.status === 'inProgress' || g.status === 'stale'),
    [goals],
  );
  const closedGoals = useMemo(
    () => goals.filter((g) => g.status === 'done' || g.status === 'abandoned'),
    [goals],
  );

  return (
    <div className={styles.layout}>
      <Stack gap={2}>
        <Heading level={2}>Goals &amp; commitments</Heading>
        <Text tone="secondary">
          Things you’re working toward — SelfOS helps you follow through.
        </Text>
      </Stack>

      <TogetherCommitments />

      {loaded && goals.length === 0 ? (
        <Card>
          <Text tone="secondary">
            Goals you mention in sessions show up here so SelfOS can help you follow through.
          </Text>
        </Card>
      ) : (
        <Stack gap={3}>
          {activeGoals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} />
          ))}
          {activeGoals.length === 0 && closedGoals.length > 0 ? (
            <Text tone="secondary">No active goals right now — your closed ones are below.</Text>
          ) : null}
          {closedGoals.length > 0 ? (
            <details className={styles.closed}>
              <summary className={styles.closedSummary}>
                Completed &amp; closed ({closedGoals.length})
              </summary>
              <div className={styles.closedBody}>
                <Stack gap={3}>
                  {closedGoals.map((goal) => (
                    <GoalCard key={goal.id} goal={goal} />
                  ))}
                </Stack>
              </div>
            </details>
          ) : null}
        </Stack>
      )}

      <CrisisFooter />
    </div>
  );
}

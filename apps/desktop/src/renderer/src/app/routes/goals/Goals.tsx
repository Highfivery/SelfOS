import { useEffect, useMemo } from 'react';
import { Card, Heading, Stack, Text } from '../../../design-system/components';
import { useGoalStore } from '../../../stores/goalStore';
import { useTogetherStore } from '../../../stores/togetherStore';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { GoalCard } from './GoalCard';
import { TogetherCommitments } from './TogetherCommitments';
import { CompletedCommitments } from './CompletedCommitments';
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
  // Completed Together commitments join the "Completed & closed" history (spec 61) so a followed-through
  // commitment isn't lost when it drops out of the standing list. Loaded here for the count + show condition;
  // `CompletedCommitments` renders the rows.
  const doneCommitments = useTogetherStore((s) => s.myDoneAgreements);
  const loadDoneAgreements = useTogetherStore((s) => s.loadDoneAgreements);

  useEffect(() => {
    void load();
    void loadDoneAgreements();
  }, [load, loadDoneAgreements]);

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
  // The collapsed history holds closed personal goals AND completed Together commitments.
  const closedCount = closedGoals.length + doneCommitments.length;

  return (
    <div className={styles.layout}>
      <Stack gap={2}>
        <Heading level={2}>Goals &amp; commitments</Heading>
        <Text tone="secondary">
          Things you’re working toward — SelfOS helps you follow through.
        </Text>
      </Stack>

      <TogetherCommitments />

      {loaded && goals.length === 0 && closedCount === 0 ? (
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
          {activeGoals.length === 0 && closedCount > 0 ? (
            <Text tone="secondary">No active goals right now — your closed ones are below.</Text>
          ) : null}
          {closedCount > 0 ? (
            <details className={styles.closed}>
              <summary className={styles.closedSummary}>
                Completed &amp; closed ({closedCount})
              </summary>
              <div className={styles.closedBody}>
                <Stack gap={3}>
                  {closedGoals.map((goal) => (
                    <GoalCard key={goal.id} goal={goal} />
                  ))}
                  <CompletedCommitments />
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

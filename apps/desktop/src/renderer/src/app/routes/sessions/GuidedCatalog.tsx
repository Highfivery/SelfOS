import { useState } from 'react';
import { GUIDED_GROUPS, listExercises } from '@selfos/core/conversations';
import { Button, Card, Stack, Text, TextInput } from '../../../design-system/components';
import { GuidedExerciseCard } from './GuidedExerciseCard';
import styles from './Launcher.module.css';

/**
 * The grouped, built-in catalog (16 §3.2). Non-clinical group titles; the framework lives in each card's
 * tag. Groups are collapsible (native <details>). A search filters across every group by name, framework, or
 * topic — while searching, only groups with matches open. The Intimacy & connection group is gated behind a
 * one-time 18+ acknowledgement (§8.3), and search never reveals it before the ack.
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
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = (e: { title: string; framework: string; blurb: string }): boolean =>
    !q || `${e.title} ${e.framework} ${e.blurb}`.toLowerCase().includes(q);

  const groups = GUIDED_GROUPS.map((group) => {
    const isIntimacy = group.id === 'intimacy';
    const gated = isIntimacy && !adultAcknowledged;
    const items = all.filter((e) => e.group === group.id && matches(e));
    return { group, isIntimacy, gated, items };
    // While searching, show a group only if it has matches — and never surface a gated intimacy match.
  }).filter(({ gated, items }) => (q ? items.length > 0 && !gated : true));

  return (
    <Stack gap={3}>
      <TextInput
        type="search"
        value={query}
        aria-label="Search guided sessions"
        placeholder="Search sessions by name, framework, or topic…"
        onChange={(event) => setQuery(event.target.value)}
      />
      {groups.length === 0 ? (
        <Text tone="secondary">No sessions match “{query}”. Try a different word.</Text>
      ) : (
        groups.map(({ group, isIntimacy, gated, items }) => (
          // A native <details> group; the title is a styled span (not a heading) to avoid nesting a
          // heading inside the summary's disclosure button (16 §9). The <section> labels the region.
          <section key={group.id} aria-label={group.title}>
            <details className={styles.group} open={q ? true : !isIntimacy}>
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
        ))
      )}
    </Stack>
  );
}

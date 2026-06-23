import type { IntakeSectionMeta, IntakeSession } from '@shared/channels';
import { RefreshCw, Sparkles } from 'lucide-react';
import { Button, Card, Heading, Markdown, Stack, Text } from '../../../design-system/components';
import { useIntakeStore } from '../../../stores/intakeStore';
import styles from './Onboarding.module.css';

/**
 * The member-facing "here's what I've come to understand about you" payoff (18-personal-onboarding §3.5),
 * with each section's reflection and the living-profile controls (revisit a section / re-generate). The raw
 * profile fields it fed are owner-only and never shown here.
 */
export function ClosingPortrait({
  session,
  sections,
  onRevisit,
}: {
  session: IntakeSession;
  sections: IntakeSectionMeta[];
  onRevisit: () => void;
}): JSX.Element {
  const finishIntake = useIntakeStore((s) => s.finishIntake);
  const finalizing = useIntakeStore((s) => s.finalizing);
  const titleOf = (id: string): string => sections.find((m) => m.id === id)?.title ?? id;
  const reflections = session.sections.filter((s) => s.reflection);

  return (
    <Stack gap={5}>
      <Card>
        <Stack gap={2}>
          <Heading level={2}>
            <Sparkles size={18} aria-hidden="true" /> What I’ve come to understand about you
          </Heading>
          {session.portrait ? (
            <Markdown className={styles.portraitBody}>{session.portrait}</Markdown>
          ) : (
            <Text tone="secondary">Your portrait will appear here once it’s written.</Text>
          )}
        </Stack>
      </Card>

      {reflections.length > 0 ? (
        <Stack gap={2}>
          <Heading level={3}>Along the way</Heading>
          <div className={styles.reflections}>
            {reflections.map((s) => (
              <div key={s.id} className={styles.reflectionItem}>
                <Text size="sm" weight={600}>
                  {titleOf(s.id)}
                </Text>
                <Markdown tone="secondary">{s.reflection ?? ''}</Markdown>
              </div>
            ))}
          </div>
        </Stack>
      ) : null}

      <div className={styles.controls}>
        <Button variant="secondary" onClick={onRevisit}>
          Revisit or add more
        </Button>
        <Button variant="ghost" disabled={finalizing} onClick={() => void finishIntake()}>
          <RefreshCw size={16} aria-hidden="true" />
          {finalizing ? 'Refreshing…' : 'Refresh my portrait'}
        </Button>
      </div>
    </Stack>
  );
}

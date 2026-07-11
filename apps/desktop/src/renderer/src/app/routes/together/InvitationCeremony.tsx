import { useState } from 'react';
import type { TogetherSessionView } from '@shared/schemas';
import { Button, Heading, Inline, Stack, Text } from '../../../design-system/components';
import { useSessionStore } from '../../../stores/sessionStore';
import { useTogetherStore } from '../../../stores/togetherStore';
import { roomRules } from './roomRules';
import styles from './Together.module.css';

/**
 * The invitation & consent ceremony (58 §3.4): the "rules of the room", derived from mechanics (never
 * absolute — §8.7). Accepting writes the caller's `rulesAckAt` (the consent record for full-context
 * personalization). Continue → the session; the caller wires `onContinue`.
 */
export function InvitationCeremony({
  session,
  onContinue,
  onNotNow,
}: {
  session: TogetherSessionView;
  onContinue: () => void;
  onNotNow: () => void;
}): JSX.Element {
  const me = useSessionStore((s) => s.activePerson?.id ?? null);
  const decline = useTogetherStore((s) => s.decline);
  const [busy, setBusy] = useState(false);

  const initiator = session.participants.find((p) => p.personId === session.initiatorPersonId);
  const other = session.participants.find((p) => p.personId !== me);
  const partnerName = other?.displayName ?? 'your partner';
  const rules = roomRules(partnerName);

  const onDecline = async (): Promise<void> => {
    setBusy(true);
    try {
      await decline(session.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.ceremony} aria-label="Invitation">
      <Stack gap={3}>
        <Stack gap={1}>
          <Heading level={2}>
            {initiator?.displayName ?? 'Someone'} invited you to a Together session
          </Heading>
          {session.topic ? (
            <Text tone="secondary">“{session.topic}”</Text>
          ) : (
            <Text tone="secondary">A shared, coached conversation — just the two of you.</Text>
          )}
        </Stack>

        <Stack gap={1}>
          <Text size="sm" weight={600}>
            How this works
          </Text>
          <ul className={styles.rulesList}>
            {rules.map((rule) => (
              <li key={rule.title}>
                <Text weight={600}>{rule.title}</Text> <Text tone="secondary">{rule.body}</Text>
              </li>
            ))}
          </ul>
        </Stack>

        <Inline gap={2} wrap>
          <Button onClick={onContinue}>Continue</Button>
          <Button variant="secondary" onClick={onNotNow}>
            Not right now
          </Button>
          <Button variant="secondary" onClick={() => void onDecline()} disabled={busy}>
            Decline quietly
          </Button>
        </Inline>
      </Stack>
    </section>
  );
}

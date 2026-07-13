import { useMemo } from 'react';
import { Archive, Clock, MailOpen, Reply, Send } from 'lucide-react';
import type { TogetherCatalogEntry, TogetherSessionSummary } from '@shared/schemas';
import { Heading, Stack, Text } from '../../../design-system/components';
import { TogetherSessionCard } from './TogetherSessionCard';
import {
  groupTitle,
  groupTogetherSessions,
  type TogetherGroupKey,
  type TogetherSessionGroup,
} from './togetherSessionGroups';
import styles from './Together.module.css';

const GROUP_ICON: Record<TogetherGroupKey, typeof Reply> = {
  yourTurn: Reply,
  openInvitation: MailOpen,
  waiting: Clock,
  invitedByYou: Send,
  wrappedUp: Archive,
};

/**
 * The "Your sessions" board (58 §3.2 redesign) — sessions grouped by whose move it is, ordered so what needs
 * the viewer's attention leads (your turn → open invitation → waiting on partner → invitations you sent →
 * wrapped up). Each in-progress card spells out whose turn it is (the `turnHint`); "Wrapped up" is collapsed.
 */
export function TogetherSessionsBoard({
  sessions,
  myId,
  partnerName,
  guideById,
  onOpen,
  onWithdraw,
}: {
  sessions: TogetherSessionSummary[];
  myId: string | null;
  partnerName: string;
  guideById: Map<string, TogetherCatalogEntry>;
  onOpen: (id: string) => void;
  onWithdraw: (id: string) => Promise<boolean>;
}): JSX.Element {
  const groups = useMemo(() => groupTogetherSessions(sessions, myId), [sessions, myId]);

  const cardsFor = (group: TogetherSessionGroup): JSX.Element => (
    <div className={styles.sessionGrid}>
      {group.sessions.map((session) => (
        <TogetherSessionCard
          key={session.id}
          session={session}
          myId={myId}
          guide={session.guideId ? guideById.get(session.guideId) : undefined}
          onOpen={() => onOpen(session.id)}
          onWithdraw={() => onWithdraw(session.id)}
        />
      ))}
    </div>
  );

  return (
    <Stack gap={2}>
      <div className={styles.sectionHead}>
        <Heading level={2}>Your sessions</Heading>
        <Text size="sm" tone="secondary">
          {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
        </Text>
      </div>
      <div className={styles.sessionGroups}>
        {groups.map((group) => {
          const Icon = GROUP_ICON[group.key];
          const title = groupTitle(group.key, partnerName);
          // "Wrapped up" is a collapsed native details so past sessions don't crowd the actionable ones.
          if (group.key === 'wrappedUp') {
            return (
              <details key={group.key} className={styles.wrappedGroup}>
                <summary className={styles.wrappedSummary}>
                  <span className={styles.wrappedChevron} aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  <Text size="sm" weight={600} tone="secondary">
                    {title}
                  </Text>
                  <span className={styles.groupCount}>
                    <Text as="span" size="sm">
                      {group.sessions.length}
                    </Text>
                  </span>
                </summary>
                {cardsFor(group)}
              </details>
            );
          }
          const accent = group.key === 'yourTurn';
          return (
            <section key={group.key} className={styles.group} aria-label={title}>
              <div className={styles.groupHead} data-accent={accent}>
                <Icon size={16} aria-hidden="true" />
                <Text size="sm" weight={600} tone={accent ? 'accent' : 'secondary'}>
                  {title}
                </Text>
                <span className={styles.groupCount}>
                  <Text as="span" size="sm">
                    {group.sessions.length}
                  </Text>
                </span>
              </div>
              {cardsFor(group)}
            </section>
          );
        })}
      </div>
    </Stack>
  );
}

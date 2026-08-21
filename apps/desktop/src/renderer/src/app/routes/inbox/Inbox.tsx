import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  ClipboardList,
  Handshake,
  Inbox as InboxIcon,
  Users,
  X,
} from 'lucide-react';
import type { InboxEntry } from '@shared/channels';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { useInboxStore } from '../../../stores/inboxStore';
import { useNotificationStore } from '../../../stores/notificationStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { InboxAnswer } from './InboxAnswer';
import { receivedStatus } from './inboxStatus';
import styles from './Inbox.module.css';

/** How each kind reads in the queue when it has no status of its own. */
const KIND_LABEL: Record<InboxEntry['kind'], string> = {
  'check-in': 'Check-in',
  'together-invitation': 'Invitation',
  'contribution-invitation': 'Asked you',
  'shared-book': 'To read',
};

function KindIcon({ kind }: { kind: InboxEntry['kind'] }): JSX.Element {
  const size = 14;
  if (kind === 'together-invitation') return <Users size={size} aria-hidden="true" />;
  if (kind === 'contribution-invitation') return <Handshake size={size} aria-hidden="true" />;
  if (kind === 'shared-book') return <BookOpen size={size} aria-hidden="true" />;
  return <ClipboardList size={size} aria-hidden="true" />;
}

/** The assignment behind a `check-in` entry, or null for every other kind. */
function checkInAssignmentId(entry: InboxEntry): string | null {
  return entry.kind === 'check-in' ? entry.id.slice('check-in:'.length) : null;
}

/**
 * The recipient's Inbox (08 §3.3, §35): one cross-domain queue of what is waiting for the signed-in person —
 * check-ins to answer, a Together invitation, someone asking you to add to their book, a book they shared.
 */
export function Inbox(): JSX.Element {
  const navigate = useNavigate();
  const items = useInboxStore((s) => s.items);
  const entries = useInboxStore((s) => s.entries);
  const loaded = useInboxStore((s) => s.loaded);
  const load = useInboxStore((s) => s.load);
  const dismissEntry = useInboxStore((s) => s.dismissEntry);
  const canCreate = useSessionStore((s) => s.can('questionnaires.create'));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const markRead = useNotificationStore((s) => s.markRead);

  useEffect(() => {
    void load();
  }, [load]);

  // Looking at the queue IS seeing it (08 §36), so quiet the one "waiting for you" row — the same rule
  // Results uses for `responses-arrived`. It matters more here: the row's signature is the SET of waiting
  // ids, so every action changes it, and without a read flag each change would mint a fresh unread id and
  // toast again — working through three items would toast three times at someone who is plainly already
  // looking. A read flag at a superset still covers every subset under `onNewMember`, so working the queue
  // down stays quiet while a genuinely new arrival still surfaces. `markRead` no-ops when nothing is showing.
  useEffect(() => {
    markRead('inbox-waiting');
  }, [markRead, entries]);

  const detailOpen = selectedId !== null;

  return (
    <div className={styles.layout} data-view={detailOpen ? 'detail' : 'list'}>
      <section className={styles.list} aria-label="Inbox">
        <div className={styles.header}>
          <Heading level={2}>Inbox</Heading>
        </div>

        {loaded && entries.length === 0 ? (
          <Card>
            <Stack gap={3} align="center">
              <InboxIcon size={24} aria-hidden="true" />
              <Text tone="secondary">
                Nothing waiting right now. Check-ins, invitations and books people share with you
                show up here.
              </Text>
              {canCreate ? (
                <Button variant="secondary" onClick={() => navigate('/questionnaires')}>
                  <ClipboardList size={16} aria-hidden="true" />
                  Create a questionnaire
                </Button>
              ) : null}
            </Stack>
          </Card>
        ) : (
          <Stack gap={2}>
            {entries.map((entry) => {
              const assignmentId = checkInAssignmentId(entry);
              const active = assignmentId !== null && selectedId === assignmentId;
              // A check-in is enriched from the assignment the answering pane already loaded, so the queue
              // entry itself stays domain-neutral — it carries no questionnaire-shaped fields.
              const item = assignmentId
                ? items.find((i) => i.assignmentId === assignmentId)
                : undefined;
              const status = item ? receivedStatus(item) : null;
              return (
                <div key={entry.id} className={styles.rowWrap}>
                  <button
                    type="button"
                    className={active ? `${styles.row} ${styles.rowActive}` : styles.row}
                    onClick={() => {
                      // Check-ins answer in place. Everything else NAVIGATES — the queue never accepts,
                      // declines or marks anything read on the person's behalf (08 §35.1); the surface that
                      // owns the decision keeps its own framing and consent step.
                      if (assignmentId) setSelectedId(assignmentId);
                      else if (entry.openPath) navigate(entry.openPath);
                    }}
                  >
                    <span className={styles.rowTop}>
                      <span className={styles.rowName}>
                        <KindIcon kind={entry.kind} />
                        {entry.title}
                      </span>
                      {status ? (
                        <span
                          className={
                            status.isNew
                              ? `${styles.statusChip} ${styles.statusNew}`
                              : styles.statusChip
                          }
                        >
                          {status.label}
                        </span>
                      ) : (
                        <span className={styles.statusChip}>{KIND_LABEL[entry.kind]}</span>
                      )}
                    </span>
                    <span className={styles.rowMeta}>
                      {item?.fromBiographer
                        ? 'Your biographer · '
                        : item?.autoCheckin
                          ? 'Auto check-in · '
                          : ''}
                      {entry.fromName ? `From ${entry.fromName}` : 'From someone'}
                      {item
                        ? ` · ${item.questionCount} ${item.questionCount === 1 ? 'question' : 'questions'}`
                        : entry.detail
                          ? ` · ${entry.detail}`
                          : ''}
                    </span>
                  </button>
                  {entry.dismissible ? (
                    <button
                      type="button"
                      className={styles.dismiss}
                      aria-label={`Remove from your inbox: ${entry.title}`}
                      onClick={() => void dismissEntry(entry.id)}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </Stack>
        )}
      </section>

      <section className={styles.detail}>
        <button type="button" className={styles.back} onClick={() => setSelectedId(null)}>
          <ArrowLeft size={16} aria-hidden="true" />
          Inbox
        </button>
        {selectedId ? (
          <InboxAnswer
            key={selectedId}
            assignmentId={selectedId}
            onDone={() => setSelectedId(null)}
          />
        ) : (
          <div className={styles.empty}>
            <Text tone="tertiary">Select a questionnaire to answer.</Text>
          </div>
        )}
      </section>
    </div>
  );
}

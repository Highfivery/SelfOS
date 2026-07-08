import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Inbox as InboxIcon } from 'lucide-react';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { useInboxStore } from '../../../stores/inboxStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { InboxAnswer } from './InboxAnswer';
import { receivedStatus } from './inboxStatus';
import styles from './Inbox.module.css';

/** The recipient's Inbox (08-questionnaires §3.3): questionnaires sent to the active person. */
export function Inbox(): JSX.Element {
  const navigate = useNavigate();
  const items = useInboxStore((s) => s.items);
  const loaded = useInboxStore((s) => s.loaded);
  const load = useInboxStore((s) => s.load);
  const canCreate = useSessionStore((s) => s.can('questionnaires.create'));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const detailOpen = selectedId !== null;

  return (
    <div className={styles.layout} data-view={detailOpen ? 'detail' : 'list'}>
      <section className={styles.list} aria-label="Inbox">
        <div className={styles.header}>
          <Heading level={2}>Inbox</Heading>
        </div>

        {loaded && items.length === 0 ? (
          <Card>
            <Stack gap={3} align="center">
              <InboxIcon size={24} aria-hidden="true" />
              <Text tone="secondary">
                Nothing to answer right now. Questionnaires people send you will show up here.
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
            {items.map((item) => {
              const active = selectedId === item.assignmentId;
              const status = receivedStatus(item);
              return (
                <button
                  key={item.assignmentId}
                  type="button"
                  className={active ? `${styles.row} ${styles.rowActive}` : styles.row}
                  onClick={() => setSelectedId(item.assignmentId)}
                >
                  <span className={styles.rowTop}>
                    <span className={styles.rowName}>{item.title}</span>
                    <span
                      className={
                        status.isNew
                          ? `${styles.statusChip} ${styles.statusNew}`
                          : styles.statusChip
                      }
                    >
                      {status.label}
                    </span>
                  </span>
                  <span className={styles.rowMeta}>
                    From {item.senderName ?? 'Someone'} · {item.questionCount}{' '}
                    {item.questionCount === 1 ? 'question' : 'questions'}
                  </span>
                </button>
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

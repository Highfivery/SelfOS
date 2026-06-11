import { useEffect, useState } from 'react';
import { ArrowLeft, Inbox as InboxIcon } from 'lucide-react';
import type { InboxItem } from '@shared/channels';
import { Card, Heading, Stack, Text } from '../../../design-system/components';
import { useInboxStore } from '../../../stores/inboxStore';
import { InboxAnswer } from './InboxAnswer';
import styles from './Inbox.module.css';

/** A short status chip for an Inbox row. */
function statusOf(item: InboxItem): { label: string; isNew: boolean } {
  if (item.status === 'submitted' || item.status === 'analyzed') {
    return { label: 'Submitted', isNew: false };
  }
  if (item.status === 'declined') return { label: 'Declined', isNew: false };
  if (!item.answerable) return { label: 'Closed', isNew: false };
  if (item.hasDraft) return { label: 'In progress', isNew: false };
  return { label: 'New', isNew: true };
}

/** The recipient's Inbox (08-questionnaires §3.3): questionnaires sent to the active person. */
export function Inbox(): JSX.Element {
  const items = useInboxStore((s) => s.items);
  const loaded = useInboxStore((s) => s.loaded);
  const load = useInboxStore((s) => s.load);
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
            <Stack gap={2} align="center">
              <InboxIcon size={24} aria-hidden="true" />
              <Text tone="secondary">
                Nothing to answer right now. Questionnaires people send you will show up here.
              </Text>
            </Stack>
          </Card>
        ) : (
          <Stack gap={2}>
            {items.map((item) => {
              const active = selectedId === item.assignmentId;
              const status = statusOf(item);
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

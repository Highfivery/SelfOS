import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ExternalLink, Handshake, RotateCcw } from 'lucide-react';
import { Button, Heading, Inline, Stack, Text } from '../../../design-system/components';
import { useTogetherStore } from '../../../stores/togetherStore';
import styles from './Goals.module.css';

/**
 * "Together commitments" that were marked **done** (spec 61) — surfaced inside the Goals "Completed & closed"
 * history so a followed-through commitment is recorded, not lost when it drops out of the standing list. Reads
 * the shared pair ledger (`myDoneAgreements`); a per-row **Reopen** flips it back to standing (write-back to
 * the shared record), returning it to the active "Together commitments" section. Renders nothing when there are
 * no completed commitments — the parent `<details>` owns the overall show/hide + count.
 */
export function CompletedCommitments(): JSX.Element | null {
  const navigate = useNavigate();
  const done = useTogetherStore((s) => s.myDoneAgreements);
  const setAgreementStatus = useTogetherStore((s) => s.setAgreementStatus);

  useEffect(() => {
    void useTogetherStore.getState().loadDoneAgreements();
  }, []);

  if (done.length === 0) return null;

  return (
    <Stack gap={2}>
      <Heading level={3} className={styles.commitTitle}>
        <Handshake size={15} aria-hidden="true" /> Together commitments
      </Heading>
      <ul className={styles.commitList}>
        {done.map(({ agreement, partnerPersonId, partnerName }) => (
          <li key={agreement.id} className={styles.commitRow}>
            <div className={styles.commitBody}>
              <Text className={styles.commitDone}>{agreement.text}</Text>
              <Inline gap={1} align="center" wrap>
                <span className={styles.commitDoneTag}>
                  <Check size={11} aria-hidden="true" /> Completed
                </span>
                <span className={styles.commitPartner}>
                  <Handshake size={11} aria-hidden="true" /> {partnerName}
                </span>
                {agreement.timeframe ? (
                  <Text size="xs" tone="secondary">
                    {agreement.timeframe}
                  </Text>
                ) : null}
                <button
                  type="button"
                  className={styles.commitLink}
                  onClick={() => navigate(`/together/session/${agreement.provenance.sessionId}`)}
                >
                  <ExternalLink size={12} aria-hidden="true" /> Open in Together
                </button>
              </Inline>
            </div>
            <Button
              variant="secondary"
              onClick={() => void setAgreementStatus(partnerPersonId, agreement.id, 'standing')}
            >
              <RotateCcw size={13} aria-hidden="true" /> Reopen
            </Button>
          </li>
        ))}
      </ul>
    </Stack>
  );
}

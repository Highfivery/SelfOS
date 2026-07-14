import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ExternalLink, Handshake, RotateCcw } from 'lucide-react';
import { Button, Card, Heading, Inline, Stack, Text } from '../../../design-system/components';
import { useTogetherStore } from '../../../stores/togetherStore';
import styles from './Goals.module.css';

/**
 * "Together commitments" (spec 61 §3.2) — the STANDING agreements a couple made in Together, surfaced
 * alongside personal goals. These are the ONE shared pair record (not duplicated `Goal`s): either partner
 * can update them, and marking one done here writes back to the shared ledger. Text/timeframe edits stay in
 * the session's reflection panel (the two-editor context) — this surface is read + mark-done/retire only.
 * Self-hides when there are no standing agreements. Loads on mount so a direct nav to /goals is fresh.
 */
export function TogetherCommitments(): JSX.Element | null {
  const navigate = useNavigate();
  const agreements = useTogetherStore((s) => s.myAgreements);
  const loadMyAgreements = useTogetherStore((s) => s.loadMyAgreements);
  const setAgreementStatus = useTogetherStore((s) => s.setAgreementStatus);

  useEffect(() => {
    void loadMyAgreements();
  }, [loadMyAgreements]);

  if (agreements.length === 0) return null;

  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.commitHead}>
          <Heading level={3} className={styles.commitTitle}>
            <Handshake size={16} aria-hidden="true" /> Together commitments
          </Heading>
        </div>
        <Text size="sm" tone="secondary">
          Agreements you’ve made in Together. Either of you can update these.
        </Text>
        <ul className={styles.commitList}>
          {agreements.map(({ agreement, partnerPersonId, partnerName }) => (
            <li key={agreement.id} className={styles.commitRow}>
              <div className={styles.commitBody}>
                <Text>{agreement.text}</Text>
                <Inline gap={1} align="center" wrap>
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
              <Inline gap={1} align="center">
                <Button
                  variant="secondary"
                  onClick={() => void setAgreementStatus(partnerPersonId, agreement.id, 'done')}
                >
                  <Check size={13} aria-hidden="true" /> Mark done
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void setAgreementStatus(partnerPersonId, agreement.id, 'retired')}
                  aria-label={`Retire agreement with ${partnerName}`}
                >
                  <RotateCcw size={13} aria-hidden="true" />
                </Button>
              </Inline>
            </li>
          ))}
        </ul>
      </Stack>
    </Card>
  );
}

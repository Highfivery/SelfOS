import { useNavigate } from 'react-router-dom';
import { Share2 } from 'lucide-react';
import type { OutboundSharing } from '@shared/schemas';
import { Card, Heading, Stack, Text } from '../../../design-system/components';
import styles from './Home.module.css';

/**
 * "Sharing" highlight (60 §3.1.5) — how much the active person is sharing and with whom, from their OWN
 * outbound-sharing view (44 §5.3, `memoryOutboundSharing`). Honest + per-person: it shows only what THEY
 * share (never "who can see you", never an owner-access implication — the durable rule). Self-hides when
 * they share nothing. Links to Memory to manage it.
 */
export function SharingCard({ outbound }: { outbound: OutboundSharing }): JSX.Element | null {
  const navigate = useNavigate();
  const items = outbound.items;
  if (items.length === 0) return null;

  // Tally how many shared items reach each recipient — "Angel (4) · Mom (2)".
  const tally = new Map<string, number>();
  for (const item of items) {
    for (const r of item.recipients) tally.set(r.displayName, (tally.get(r.displayName) ?? 0) + 1);
  }
  const recipients = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.cardHead}>
          <Heading level={2} className={styles.sectionTitle}>
            <Share2 size={16} aria-hidden="true" /> Sharing
          </Heading>
          <button type="button" className={styles.cardLink} onClick={() => navigate('/memory')}>
            Manage
          </button>
        </div>
        <Text tone="secondary">
          You’re sharing{' '}
          <strong>
            {items.length} {items.length === 1 ? 'thing' : 'things'}
          </strong>
          {recipients.length > 0 ? ' with the people you’ve chosen.' : '.'}
        </Text>
        {recipients.length > 0 ? (
          <div className={styles.shareChips}>
            {recipients.map(([name, count]) => (
              <span key={name} className={styles.shareChip}>
                {name} <span className={styles.shareChipCount}>{count}</span>
              </span>
            ))}
          </div>
        ) : null}
      </Stack>
    </Card>
  );
}

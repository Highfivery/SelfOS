import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { RawAccessAuditEntry } from '@shared/channels';
import {
  AdminOnlyBadge,
  Card,
  Heading,
  Inline,
  Stack,
  Text,
} from '../../../design-system/components';
import styles from './AuditLog.module.css';

const formatWhen = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

/**
 * The break-glass raw-access audit log (08-questionnaires §8.4) — every time a Private send's raw answers
 * were revealed, by whom, and how. Super-admin only (the nav entry + route only render in super-admin
 * mode); the log lives encrypted in the vault, so it reads the same from every device.
 */
export function AuditLog(): JSX.Element {
  const [entries, setEntries] = useState<RawAccessAuditEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      setEntries((await window.selfos?.auditList()) ?? []);
      setLoaded(true);
    })();
  }, []);

  return (
    <Stack gap={5}>
      <Stack gap={1}>
        <Inline gap={2}>
          <Heading level={2}>Raw-access audit</Heading>
          <AdminOnlyBadge />
        </Inline>
        <Text tone="secondary">
          Every break-glass reveal of a private questionnaire’s raw answers is recorded here.
        </Text>
      </Stack>

      {loaded && entries.length === 0 ? (
        <Card>
          <Stack gap={2} align="center">
            <ShieldAlert size={24} aria-hidden="true" />
            <Text tone="secondary">No raw answers have ever been revealed.</Text>
          </Stack>
        </Card>
      ) : (
        <Stack gap={2}>
          {entries.map((entry, i) => (
            <Card key={i}>
              <Stack gap={1}>
                <div className={styles.entryHead}>
                  <Text weight={500}>Revealed raw answers</Text>
                  <span className={styles.badge}>
                    {entry.viaSuperAdmin ? 'Super-admin' : 'Sender (readRaw)'}
                  </span>
                </div>
                <Text size="sm" tone="secondary">
                  {formatWhen(entry.at)} · by {entry.by}
                  {entry.recipientName ? ` · ${entry.recipientName}’s response` : ''}
                </Text>
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

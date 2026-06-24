import { ArrowRight, BarChart3, Share2, Sparkles } from 'lucide-react';
import { RELATIONSHIP_TYPE_LABELS } from '@selfos/core/sharing';
import { Card, Stack, Text } from '../../../design-system/components';
import { SOURCE_LABEL, type ConfidenceStat, type OverviewStat, type SharingStat } from './stats';
import styles from './Memory.module.css';

const fmtDate = (iso: string | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * The Memory dashboard's at-a-glance summary header (44-memory-dashboard §3.2): three compact stat cards —
 * Overview (what SelfOS knows, by source), Confidence (how well it feels it knows you), and Sharing (what
 * flows to whom, with a manage link). All values are derived locally (stats.ts) — no AI, no extra IPC. The
 * confidence bar is decorative (`aria-hidden`); the counts are always text (§9, never colour-only).
 */
export function StatsSummary({
  overview,
  confidence,
  sharing,
  onManageSharing,
}: {
  overview: OverviewStat;
  confidence: ConfidenceStat;
  sharing: SharingStat;
  onManageSharing: () => void;
}): JSX.Element {
  return (
    <div className={styles.statsRow} aria-label="What SelfOS knows about you, at a glance">
      <Card className={styles.statCard}>
        <Stack gap={2}>
          <Text size="xs" tone="tertiary" className={styles.statEyebrow}>
            <Sparkles size={13} aria-hidden="true" /> Overview
          </Text>
          <Text>
            SelfOS knows <strong>{overview.total}</strong>{' '}
            {overview.total === 1 ? 'thing' : 'things'} about you.
          </Text>
          {overview.bySource.length > 0 ? (
            <Text size="sm" tone="secondary">
              {overview.bySource.map((s) => `${SOURCE_LABEL[s.source]} ${s.count}`).join(' · ')}
            </Text>
          ) : null}
          {overview.lastUpdated ? (
            <Text size="xs" tone="tertiary">
              Updated {fmtDate(overview.lastUpdated)}
            </Text>
          ) : null}
        </Stack>
      </Card>

      <Card className={styles.statCard}>
        <Stack gap={2}>
          <Text size="xs" tone="tertiary" className={styles.statEyebrow}>
            <BarChart3 size={13} aria-hidden="true" /> Confidence
          </Text>
          <Text size="sm" tone="secondary">
            How well SelfOS feels it knows you — a reflection, not a score.
          </Text>
          <Text size="sm">
            High <strong>{confidence.high}</strong> · Medium <strong>{confidence.medium}</strong> ·
            Low <strong>{confidence.low}</strong>
          </Text>
          {confidence.total > 0 ? (
            <div className={styles.confidenceBar} aria-hidden="true">
              {confidence.high > 0 ? (
                <span className={styles.confHigh} style={{ flexGrow: confidence.high }} />
              ) : null}
              {confidence.medium > 0 ? (
                <span className={styles.confMed} style={{ flexGrow: confidence.medium }} />
              ) : null}
              {confidence.low > 0 ? (
                <span className={styles.confLow} style={{ flexGrow: confidence.low }} />
              ) : null}
            </div>
          ) : null}
        </Stack>
      </Card>

      <Card className={styles.statCard}>
        <Stack gap={2}>
          <Text size="xs" tone="tertiary" className={styles.statEyebrow}>
            <Share2 size={13} aria-hidden="true" /> Sharing
          </Text>
          {sharing.sharedCount === 0 ? (
            <>
              <Text size="sm">You’re not sharing anything yet.</Text>
              <Text size="sm" tone="tertiary">
                Sharing lets people you relate to have something inform their AI — they never see it
                directly.
              </Text>
            </>
          ) : (
            <>
              <Text>
                You’re sharing <strong>{sharing.sharedCount}</strong>{' '}
                {sharing.sharedCount === 1 ? 'thing' : 'things'}.
              </Text>
              {sharing.byType.length > 0 || sharing.broadcastCount > 0 ? (
                <Text size="sm" tone="secondary">
                  {[
                    ...sharing.byType.map((t) => `${RELATIONSHIP_TYPE_LABELS[t.type]} ${t.count}`),
                    ...(sharing.broadcastCount > 0 ? [`Everyone ${sharing.broadcastCount}`] : []),
                  ].join(' · ')}
                </Text>
              ) : null}
            </>
          )}
          <button type="button" className={styles.manageLink} onClick={onManageSharing}>
            Manage sharing <ArrowRight size={13} aria-hidden="true" />
          </button>
        </Stack>
      </Card>
    </div>
  );
}

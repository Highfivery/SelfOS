import { useCallback, useEffect, useState } from 'react';
import { Activity, Lock } from 'lucide-react';
import { PULSE_METRICS, PULSE_METRIC_LABELS, type TogetherPulseView } from '@shared/schemas';
import {
  Banner,
  Button,
  Heading,
  Inline,
  LineChart,
  SegmentedControl,
  Stack,
  Switch,
  Text,
} from '../../../design-system/components';
import styles from './Together.module.css';

/**
 * The Pulse check-in strip (58 §3.10a — absorbs spec 11), pulled to the top of the dashboard so logging is
 * an inviting, low-friction habit. The three metric taps are always visible (a one-motion check-in), with the
 * viewer's OWN trend + a gentle "last check-in" nudge, and — only when BOTH have logged AND both consented to
 * share `desire` — the desire alignment. Everything is gated host-side; a partner's raw metrics are never shown.
 */
type Level = 'low' | 'steady' | 'high';
const LEVEL_TO_UNIT: Record<Level, number> = { low: 0, steady: 0.5, high: 1 };
const LEVEL_OPTIONS = [
  { value: 'low' as const, label: 'Low' },
  { value: 'steady' as const, label: 'Steady' },
  { value: 'high' as const, label: 'High' },
];

const METRICS = PULSE_METRICS.map((key) => ({ key, label: PULSE_METRIC_LABELS[key] }));

const DIRECTION_WORD: Record<TogetherPulseView['series'][number]['direction'], string> = {
  rising: 'rising',
  steady: 'steady',
  dipping: 'dipping',
  flat: '—',
};

/** A gentle "last check-in" nudge from the most-recent check-in timestamp (never fabricated). */
function nudgeLine(lastCheckInAt: string | undefined): string {
  if (!lastCheckInAt) return 'Takes 20 seconds — and it stays private to you.';
  const then = Date.parse(lastCheckInAt);
  if (!Number.isFinite(then)) return 'Takes 20 seconds — and it stays private to you.';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'You checked in today. Nice.';
  if (days === 1) return 'Last check-in yesterday — takes 20 seconds.';
  return `Last check-in ${days} days ago — takes 20 seconds.`;
}

export function TogetherPulse({
  partnerId,
  partnerName,
}: {
  partnerId: string;
  partnerName: string;
}): JSX.Element | null {
  const [view, setView] = useState<TogetherPulseView | null>(null);
  const [levels, setLevels] = useState<Record<string, Level>>({
    connection: 'steady',
    desire: 'steady',
    satisfaction: 'steady',
  });
  const [shareDesire, setShareDesire] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const v = (await window.selfos?.togetherPulse({ partnerPersonId: partnerId })) ?? null;
    setView(v);
  }, [partnerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    const metrics: Record<string, number> = {};
    for (const m of METRICS) metrics[m.key] = LEVEL_TO_UNIT[levels[m.key] ?? 'steady'];
    const v = await window.selfos?.togetherPulseLog({
      partnerPersonId: partnerId,
      metrics,
      ...(shareDesire ? { shareMetrics: ['desire'] } : {}),
    });
    if (v) {
      setView(v);
      setSaved(true);
    }
    setBusy(false);
  };

  if (!view) return null;

  const alignment = view.alignment;

  return (
    <div className={styles.checkIn}>
      <div className={styles.checkInHead}>
        <Stack gap={1}>
          <Inline gap={2} align="center">
            <Activity size={16} aria-hidden="true" />
            <Heading level={3}>How are things with {partnerName}?</Heading>
          </Inline>
          <Text size="sm" tone="secondary">
            {saved ? 'Saved. Come back anytime.' : nudgeLine(view.lastCheckInAt)}
          </Text>
        </Stack>
        {view.hasCheckIns && view.series.length > 0 ? (
          <Stack gap={1} className={styles.pulseSpark}>
            <LineChart
              series={view.series}
              ariaLabel={`Your Together pulse over time with ${partnerName}`}
              yMin={0}
              yMax={1}
            />
            {/* §9 text equivalent — the trend direction as words, never colour/shape alone. */}
            <Text size="xs" tone="secondary">
              {view.series.map((s) => `${s.label} ${DIRECTION_WORD[s.direction]}`).join(' · ')}
            </Text>
          </Stack>
        ) : null}
      </div>

      {alignment.ready && alignment.yours != null && alignment.theirs != null ? (
        <Banner tone={alignment.read === 'aligned' ? 'info' : 'warning'}>
          {alignment.read === 'aligned'
            ? `Your desire levels are closely aligned right now.`
            : `There's some distance in where your desire levels sit right now — worth a gentle conversation.`}
        </Banner>
      ) : null}

      <div className={styles.metricGrid}>
        {METRICS.map((m) => (
          <div key={m.key} className={styles.metric}>
            <Text size="sm" weight={600}>
              {m.label}
            </Text>
            <SegmentedControl
              options={LEVEL_OPTIONS}
              value={levels[m.key] ?? 'steady'}
              onChange={(v) => {
                setLevels((prev) => ({ ...prev, [m.key]: v }));
                setSaved(false);
              }}
              aria-label={`${m.label} level`}
            />
          </div>
        ))}
      </div>

      <div className={styles.checkInFoot}>
        <div className={styles.shareToggle}>
          <Switch
            checked={shareDesire}
            onChange={(v) => {
              setShareDesire(v);
              setSaved(false);
            }}
            aria-label={`Share my desire level with ${partnerName} to see how you line up`}
          />
          <Text size="sm" tone="secondary" className={styles.lockNote}>
            <Lock size={13} aria-hidden="true" /> Share my desire level to see how you line up
          </Text>
        </div>
        <Button onClick={() => void submit()} disabled={busy} aria-busy={busy}>
          {saved ? 'Saved' : 'Save check-in'}
        </Button>
      </div>
    </div>
  );
}

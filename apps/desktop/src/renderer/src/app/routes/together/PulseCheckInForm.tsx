import { useState } from 'react';
import { Activity, Lock } from 'lucide-react';
import { PULSE_METRICS, PULSE_METRIC_LABELS, type TogetherPulseView } from '@shared/schemas';
import {
  Button,
  Heading,
  Inline,
  SegmentedControl,
  Stack,
  Switch,
  Text,
} from '../../../design-system/components';
import styles from './Together.module.css';

/**
 * The Pulse check-in FORM (58 §3.10a) — "How are things with <partner>?", the three metrics as Low/Steady/
 * High taps, the default-off lock-gated "share my desire level" toggle, and Save. Extracted so the Together
 * page (with its trend chart + alignment banner) AND the Home dashboard callout (spec 61 §3.4) render ONE
 * implementation — the consent model + desire gate are identical everywhere. Logs via `togetherPulseLog` and
 * hands the refreshed view back to the parent (`onLogged`), which owns any surrounding trend/alignment UI.
 */
type Level = 'low' | 'steady' | 'high';
const LEVEL_TO_UNIT: Record<Level, number> = { low: 0, steady: 0.5, high: 1 };
const LEVEL_OPTIONS = [
  { value: 'low' as const, label: 'Low' },
  { value: 'steady' as const, label: 'Steady' },
  { value: 'high' as const, label: 'High' },
];
const METRICS = PULSE_METRICS.map((key) => ({ key, label: PULSE_METRIC_LABELS[key] }));

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

export function PulseCheckInForm({
  partnerId,
  partnerName,
  lastCheckInAt,
  hideHead,
  onLogged,
}: {
  partnerId: string;
  partnerName: string;
  lastCheckInAt?: string;
  /** Omit the "How are things with X?" heading (the Home card provides its own label — spec 61 §3.4). */
  hideHead?: boolean;
  onLogged?: (view: TogetherPulseView) => void;
}): JSX.Element {
  const [levels, setLevels] = useState<Record<string, Level>>({
    connection: 'steady',
    desire: 'steady',
    satisfaction: 'steady',
  });
  const [shareDesire, setShareDesire] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    const metrics: Record<string, number> = {};
    for (const m of METRICS) metrics[m.key] = LEVEL_TO_UNIT[levels[m.key] ?? 'steady'];
    const view = await window.selfos?.togetherPulseLog({
      partnerPersonId: partnerId,
      metrics,
      ...(shareDesire ? { shareMetrics: ['desire'] } : {}),
    });
    if (view) {
      setSaved(true);
      onLogged?.(view);
    }
    setBusy(false);
  };

  return (
    <div className={styles.checkInForm}>
      {hideHead ? (
        saved ? (
          <Text size="sm" tone="secondary">
            Saved. Come back anytime.
          </Text>
        ) : null
      ) : (
        <Stack gap={1}>
          <Inline gap={2} align="center">
            <Activity size={16} aria-hidden="true" />
            <Heading level={3}>How are things with {partnerName}?</Heading>
          </Inline>
          <Text size="sm" tone="secondary">
            {saved ? 'Saved. Come back anytime.' : nudgeLine(lastCheckInAt)}
          </Text>
        </Stack>
      )}

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

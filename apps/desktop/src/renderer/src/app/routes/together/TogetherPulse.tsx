import { useCallback, useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { PULSE_METRICS, PULSE_METRIC_LABELS, type TogetherPulseView } from '@shared/schemas';
import {
  Banner,
  Button,
  Card,
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
 * The pair Pulse (58 §3.10a — absorbs spec 11): a frictionless 1–3 check-in on how the viewer feels the
 * relationship is going (connection / desire / satisfaction), the viewer's OWN metric trends + the dyad
 * session metrics, and — only when BOTH have logged AND both consented to share `desire` — a gentle desire
 * alignment. Everything is gated host-side; a partner's raw metrics are never shown (only the desire read).
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
  const [logging, setLogging] = useState(false);

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
    if (v) setView(v);
    setBusy(false);
    setLogging(false);
  };

  if (!view) return null;

  const alignment = view.alignment;

  return (
    <Card>
      <Stack gap={2}>
        <Inline gap={2} align="center">
          <Activity size={16} aria-hidden="true" />
          <Heading level={3}>Pulse</Heading>
        </Inline>
        <Text size="sm" tone="secondary">
          A quick, private read on how things feel with {partnerName}. Just for you — unless you
          choose to share your desire level to see how you line up.
        </Text>

        {view.hasCheckIns && view.series.length > 0 ? (
          <Stack gap={1}>
            <div className={styles.pulseChart}>
              <LineChart
                series={view.series}
                ariaLabel={`Your Together pulse over time with ${partnerName}`}
                yMin={0}
                yMax={1}
              />
            </div>
            {/* §9 text equivalent — the trend direction as words, never colour/shape alone. */}
            <Text size="xs" tone="secondary">
              {view.series.map((s) => `${s.label} ${DIRECTION_WORD[s.direction]}`).join(' · ')}
            </Text>
          </Stack>
        ) : (
          <Text size="sm" tone="secondary">
            No check-ins yet. Log one below to start seeing how things trend.
          </Text>
        )}

        {alignment.ready && alignment.yours != null && alignment.theirs != null ? (
          <Banner tone={alignment.read === 'aligned' ? 'info' : 'warning'}>
            {alignment.read === 'aligned'
              ? `Your desire levels are closely aligned right now.`
              : `There's some distance in where your desire levels sit right now — worth a gentle conversation.`}
          </Banner>
        ) : null}

        {logging ? (
          <Stack gap={2}>
            {METRICS.map((m) => (
              <Stack key={m.key} gap={1}>
                <Text size="sm" weight={600}>
                  {m.label}
                </Text>
                <SegmentedControl
                  options={LEVEL_OPTIONS}
                  value={levels[m.key] ?? 'steady'}
                  onChange={(v) => setLevels((prev) => ({ ...prev, [m.key]: v }))}
                  aria-label={`${m.label} level`}
                />
              </Stack>
            ))}
            <Inline gap={2} align="center">
              <Switch
                checked={shareDesire}
                onChange={setShareDesire}
                aria-label={`Share my desire level with ${partnerName} to see how you line up`}
              />
              <Text size="sm" tone="secondary">
                Share my desire level with {partnerName} (to see how you line up)
              </Text>
            </Inline>
            <Inline gap={2} align="center">
              <Button onClick={() => void submit()} disabled={busy} aria-busy={busy}>
                Save check-in
              </Button>
              <Button variant="secondary" onClick={() => setLogging(false)} disabled={busy}>
                Cancel
              </Button>
            </Inline>
          </Stack>
        ) : (
          <Inline gap={2} align="center">
            <Button onClick={() => setLogging(true)}>Log a check-in</Button>
          </Inline>
        )}
      </Stack>
    </Card>
  );
}

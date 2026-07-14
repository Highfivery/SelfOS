import { useCallback, useEffect, useState } from 'react';
import { type TogetherPulseView } from '@shared/schemas';
import { Banner, LineChart, Stack, Text } from '../../../design-system/components';
import { PulseCheckInForm } from './PulseCheckInForm';
import styles from './Together.module.css';

/**
 * The Pulse check-in strip (58 §3.10a — absorbs spec 11), pulled to the top of the Together page so logging is
 * an inviting, low-friction habit. Composes the shared `PulseCheckInForm` (the three metric taps + the
 * default-off desire-share toggle) with the viewer's OWN trend chart and — only when BOTH have logged AND both
 * consented to share `desire` — the desire alignment. Everything is gated host-side; a partner's raw metrics
 * are never shown. The identical form appears on the Home dashboard callout (spec 61 §3.4).
 */
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

  const refresh = useCallback(async (): Promise<void> => {
    const v = (await window.selfos?.togetherPulse({ partnerPersonId: partnerId })) ?? null;
    setView(v);
  }, [partnerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!view) return null;

  const alignment = view.alignment;

  return (
    <div className={styles.checkIn}>
      <PulseCheckInForm
        partnerId={partnerId}
        partnerName={partnerName}
        {...(view.lastCheckInAt ? { lastCheckInAt: view.lastCheckInAt } : {})}
        onLogged={setView}
      />

      {alignment.ready && alignment.yours != null && alignment.theirs != null ? (
        <Banner tone={alignment.read === 'aligned' ? 'info' : 'warning'}>
          {alignment.read === 'aligned'
            ? `Your desire levels are closely aligned right now.`
            : `There's some distance in where your desire levels sit right now — worth a gentle conversation.`}
        </Banner>
      ) : null}

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
  );
}

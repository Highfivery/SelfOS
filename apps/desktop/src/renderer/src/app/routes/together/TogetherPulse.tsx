import { ArrowRightLeft, MessagesSquare, User } from 'lucide-react';
import { type PulseSeries, type TogetherPulseView } from '@shared/schemas';
import { LineChart, Stack, Text } from '../../../design-system/components';
import { PulseCheckInForm } from './PulseCheckInForm';
import styles from './Together.module.css';

/**
 * The Pulse check-in strip (58 §3.10a — absorbs spec 11), pulled to the top of the Together page so logging is
 * an inviting, low-friction habit. Composes the shared `PulseCheckInForm` (the three metric taps + the
 * default-off desire-share toggle) with the viewer's OWN trends and — only when BOTH have logged AND both
 * consented to share `desire` — the desire alignment. Everything is gated host-side; a partner's raw metrics
 * are never shown. The identical form appears on the Home dashboard callout (spec 61 §3.4).
 *
 * Redesign (spec 58 §3.10a, "Two clean charts"): the two data sources are kept in SEPARATE, clearly-labelled
 * groups — "Your check-ins" (self Connection/Desire/Satisfaction) and "From your sessions" (dyad Connection +
 * Calm from wrap-ups) — so they never share one confusing axis or collide on "Connection". Each group draws a
 * trend line only once there's history (≥2 points); with a single reading it shows a current-value read
 * instead of a lone floating dot. Desire alignment is a you-vs-partner comparison, not a vague banner.
 */
const DIRECTION_WORD: Record<PulseSeries['direction'], string> = {
  rising: 'rising',
  steady: 'steady',
  dipping: 'dipping',
  flat: 'steady',
};

/** A 0..1 value → a plain Low / Steady / High word (the current-value read + §9 text equivalent). */
function valueWord(y: number): string {
  if (y > 0.66) return 'High';
  if (y < 0.34) return 'Low';
  return 'Steady';
}

const latest = (s: PulseSeries): number => s.points.at(-1)?.y ?? 0;
const hasTrend = (series: PulseSeries[]): boolean => series.some((s) => s.points.length >= 2);

/**
 * One trend group (a labelled card). Renders a real line chart once there's history, or a compact
 * current-value read when there's only a single reading (never a lone floating dot). Hidden when empty.
 */
function TrendGroup({
  title,
  icon,
  series,
  ariaLabel,
  sparseNote,
}: {
  title: string;
  icon: JSX.Element;
  series: PulseSeries[];
  ariaLabel: string;
  sparseNote: string;
}): JSX.Element | null {
  if (series.length === 0) return null;
  return (
    <div className={styles.pulseGroup}>
      <Text size="xs" tone="secondary" weight={600} className={styles.pulseGroupHead}>
        {icon}
        {title}
      </Text>
      {hasTrend(series) ? (
        <Stack gap={1}>
          <LineChart
            series={series}
            ariaLabel={ariaLabel}
            yMin={0}
            yMax={1}
            yHighLabel="High"
            yLowLabel="Low"
          />
          {/* §9 text equivalent — the trend direction as words, never colour/shape alone. */}
          <Text size="xs" tone="secondary">
            {series.map((s) => `${s.label} ${DIRECTION_WORD[s.direction]}`).join(' · ')}
          </Text>
        </Stack>
      ) : (
        <Stack gap={2}>
          <ul className={styles.pulseReadout} aria-label={`${title} right now`}>
            {series.map((s) => (
              <li key={s.label} className={styles.pulseReadoutRow}>
                <Text size="sm">{s.label}</Text>
                <Text size="sm" weight={600}>
                  {valueWord(latest(s))}
                </Text>
              </li>
            ))}
          </ul>
          <Text size="xs" tone="secondary">
            {sparseNote}
          </Text>
        </Stack>
      )}
    </div>
  );
}

/**
 * The Pulse check-in + trends. CONTROLLED by the parent (58 §3.2a): the parent owns the `view` so it can
 * badge the Pulse TAB "due" without a second fetch that could drift after a check-in. `onView` (the store
 * `setView`) lets `PulseCheckInForm` swap the view in place on log, which also clears the tab badge.
 */
export function TogetherPulse({
  partnerId,
  partnerName,
  view,
  onView,
}: {
  partnerId: string;
  partnerName: string;
  view: TogetherPulseView | null;
  onView: (view: TogetherPulseView) => void;
}): JSX.Element | null {
  if (!view) return null;

  const alignment = view.alignment;
  const aligned = alignment.read === 'aligned';

  return (
    <div className={styles.checkIn}>
      <PulseCheckInForm
        partnerId={partnerId}
        partnerName={partnerName}
        {...(view.lastCheckInAt ? { lastCheckInAt: view.lastCheckInAt } : {})}
        onLogged={onView}
      />

      {/* Desire alignment — a you-vs-partner comparison on a Low↔High desire track (dual-consent gated). */}
      {alignment.ready && alignment.yours != null && alignment.theirs != null ? (
        <div
          className={[styles.pulseAlign, aligned ? styles.pulseAlignOk : styles.pulseAlignGap].join(
            ' ',
          )}
        >
          <Text size="sm" weight={600} className={styles.pulseAlignHead}>
            <ArrowRightLeft size={14} aria-hidden="true" />
            You &amp; {partnerName} · desire
          </Text>
          <div
            className={styles.alignTrack}
            role="img"
            aria-label={`Your desire level and ${partnerName}'s are ${
              aligned ? 'closely aligned' : 'at some distance'
            } right now.`}
          >
            <span
              className={styles.alignDotYou}
              style={{ left: `${Math.round(alignment.yours * 100)}%` }}
            />
            <span
              className={styles.alignDotThem}
              style={{ left: `${Math.round(alignment.theirs * 100)}%` }}
            />
          </div>
          <div className={styles.alignFoot}>
            <span className={styles.alignLegend}>
              <span className={styles.alignSwatchYou} aria-hidden="true" /> You
              <span className={styles.alignSwatchThem} aria-hidden="true" /> {partnerName}
            </span>
            <Text size="xs" tone="secondary">
              {aligned
                ? 'Your desire levels are closely aligned right now.'
                : 'Some distance right now — worth a gentle conversation.'}
            </Text>
          </div>
        </div>
      ) : null}

      {view.hasCheckIns ? (
        <TrendGroup
          title="Your check-ins"
          icon={<User size={13} aria-hidden="true" />}
          series={view.checkInSeries}
          ariaLabel={`Your check-in trends with ${partnerName} — connection, desire, and satisfaction over time`}
          sparseNote="Check in again to see how these trend over time."
        />
      ) : null}

      <TrendGroup
        title="From your sessions together"
        icon={<MessagesSquare size={13} aria-hidden="true" />}
        series={view.sessionSeries}
        ariaLabel={`Connection and calm from your Together sessions with ${partnerName} over time`}
        sparseNote="Drawn from your last session wrap-up. A trend line appears after a few sessions."
      />
    </div>
  );
}

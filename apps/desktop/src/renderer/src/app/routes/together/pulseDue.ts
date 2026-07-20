/** Days after which a Together Pulse check-in is "due" (spec 61 §3.4) — never checked in, or last > 7 days. */
export const PULSE_DUE_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whether a Pulse check-in is due for the viewer — the single source Home and the Together tab badge share. */
export function pulseIsDue(
  view: { hasCheckIns: boolean; lastCheckInAt?: string },
  now: number,
): boolean {
  if (!view.hasCheckIns || !view.lastCheckInAt) return true;
  const t = Date.parse(view.lastCheckInAt);
  if (!Number.isFinite(t)) return true;
  return now - t > PULSE_DUE_DAYS * MS_PER_DAY;
}

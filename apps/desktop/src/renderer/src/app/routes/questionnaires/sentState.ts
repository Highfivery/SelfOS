/** Short, locale-aware date for a "Sent · <date>" chip; falls back to the raw ISO if it can't be parsed. */
export function formatSentDate(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleDateString();
}

/**
 * Locale-aware date AND time for a card meta ("Jun 30, 2026 · 10:02 AM") — the user wants both when a
 * questionnaire was sent/answered (08 §3.1). Falls back to the raw ISO if it can't be parsed.
 */
export function formatDateTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  const d = new Date(parsed);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

const DAY = 86_400_000;

/**
 * A coarse "how long ago" for the stale-answers nudge ("3 days ago" / "6 weeks ago" / "5 months ago").
 * Empty string for a future/invalid time. Kept coarse — the exact time already shows in the meta.
 */
export function relativeAge(iso: string, now: number = Date.now()): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '';
  const days = Math.floor((now - parsed) / DAY);
  if (days < 0) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (days < 60) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  const months = Math.floor(days / 30);
  if (days < 365) return `${months} months ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

/**
 * How long after the last send before re-asking the same questionnaire is suggested (08 §17.14). A sent
 * questionnaire is read-only (its questions are frozen); "Send again" is disabled until this cooldown
 * elapses, with a notice. Default cadence — a weekly check-in rhythm; adjust here if it should differ.
 */
export const RESEND_COOLDOWN_DAYS = 7;

const DAY_MS = 86_400_000;

export interface ResendStatus {
  /** True once the cooldown since the last send has elapsed — re-asking is suggested. */
  ready: boolean;
  /** Whole days until re-asking is suggested (0 once ready). */
  daysUntil: number;
  /** A short notice for the list row / builder ("Ready to ask again" / "Ask again in N days"). */
  message: string;
}

/** Whether enough time has passed since `lastSentAt` to suggest re-asking, + a human notice. */
export function resendStatus(lastSentAt: string, now: number = Date.now()): ResendStatus {
  const sentAt = Date.parse(lastSentAt);
  if (Number.isNaN(sentAt)) {
    return { ready: true, daysUntil: 0, message: 'Ready to ask again' };
  }
  const readyAt = sentAt + RESEND_COOLDOWN_DAYS * DAY_MS;
  if (now >= readyAt) {
    return { ready: true, daysUntil: 0, message: 'Ready to ask again' };
  }
  const daysUntil = Math.max(1, Math.ceil((readyAt - now) / DAY_MS));
  return {
    ready: false,
    daysUntil,
    message: `Ask again in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`,
  };
}

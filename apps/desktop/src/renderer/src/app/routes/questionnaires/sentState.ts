/** Short, locale-aware date for a "Sent · <date>" chip; falls back to the raw ISO if it can't be parsed. */
export function formatSentDate(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleDateString();
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

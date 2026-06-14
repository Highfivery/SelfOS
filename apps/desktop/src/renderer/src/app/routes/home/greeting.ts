/** A time-of-day greeting word (local hour 0–23). Stays warm and non-clinical. */
export function timeOfDayGreeting(hour: number): string {
  if (hour < 5) return 'Hello';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The greeting's one short, non-noisy status line, drawn from the same data the cards use. Picks the
 * single most actionable signal; degrades to '' (just the greeting) when there's nothing notable (§3.1).
 */
export function buildStatusLine(input: {
  openSessions: number;
  inboxCount: number;
  moodRead: string;
}): string {
  const { openSessions, inboxCount, moodRead } = input;
  if (openSessions > 0)
    return `${openSessions} session${openSessions === 1 ? '' : 's'} in progress`;
  if (inboxCount > 0)
    return `${inboxCount} ${inboxCount === 1 ? 'thing' : 'things'} waiting in your inbox`;
  if (moodRead) return moodRead;
  return '';
}

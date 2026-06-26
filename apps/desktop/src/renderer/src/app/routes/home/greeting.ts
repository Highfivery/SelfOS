/** A time-of-day greeting word (local hour 0–23). Stays warm and non-clinical. */
export function timeOfDayGreeting(hour: number): string {
  if (hour < 5) return 'Hello';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// The old single-line status (`buildStatusLine`) was replaced by the gentle momentum reflection
// (53 §3.3, `computeMomentum` + `MomentumLine`) — what positively happened, never a "things waiting" prod.

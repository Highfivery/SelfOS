import type { StreakInfo, StreakInput } from './schemas';

/** Local calendar-day key `YYYY-MM-DD` for a Date (day boundaries in the person's own timezone). */
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Compute the person's gentle "rhythm" streak (60 §3.1.1 / §8) — the number of consecutive local days,
 * ending **today or yesterday**, on which they did ≥1 meaningful thing. **Positive-only by construction:**
 *
 * - It only ever counts a run that IS current (anchored at today, or yesterday as a grace day so a fresh
 *   morning doesn't zero an otherwise-live streak). If the most recent active day is older than yesterday,
 *   the run is over and it returns `{ days: 0 }` — the caller simply shows nothing. It **never** returns a
 *   gap, a "broken"/"lost" flag, or a missed-day count.
 * - During a crisis signal it is **suppressed** (`{ days: 0, suppressed: true }`) — a struggling person is
 *   never shown a streak (§8, the safety guardrail, enforced here so it's unit-testable).
 *
 * Pure. Future-dated activity (> today) is ignored.
 */
export function computeStreak(input: StreakInput): StreakInfo {
  if (input.crisis) return { days: 0, suppressed: true };

  const active = new Set<string>();
  for (const iso of input.activity) {
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) active.add(dayKey(new Date(t)));
  }

  const today = dayKey(input.now);
  const yd = new Date(input.now);
  yd.setDate(yd.getDate() - 1);
  const yesterday = dayKey(yd);

  // Anchor the run at today if active, else yesterday (the grace day), else there is no current run.
  const anchor = new Date(input.now);
  if (active.has(today)) {
    /* anchor stays today */
  } else if (active.has(yesterday)) {
    anchor.setDate(anchor.getDate() - 1);
  } else {
    return { days: 0, suppressed: false };
  }

  // Walk backward by CALENDAR day at local noon — `setDate` handles month/DST boundaries so a near-midnight
  // reading (or a spring-forward/fall-back day) can't miscount a live run (a fixed 24h step would).
  const cursor = new Date(anchor);
  cursor.setHours(12, 0, 0, 0);
  let days = 0;
  let since = dayKey(cursor);
  while (active.has(dayKey(cursor))) {
    days += 1;
    since = dayKey(cursor);
    cursor.setDate(cursor.getDate() - 1);
  }

  return { days, since, suppressed: false };
}

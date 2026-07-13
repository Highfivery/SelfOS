/**
 * Pure formatting helpers for chat-message timestamps + day dividers, shared across every surface where
 * the user chats with AI (Sessions, Together, Dream analysis, Onboarding intake). Message timestamps live
 * on each stored message (`ChatMessage.ts` / `TogetherMessageView.ts`) — these turn that ISO string into
 * the muted "3:42 PM" meta below a bubble and the "Today" / "Yesterday" / date dividers between days.
 */

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * A message's meta line: a short date + the time ("Jul 13 · 3:42 PM"), so the date is always visible
 * under each bubble even when a long single-day thread has scrolled its day divider out of view. The year
 * is added only for a message from a prior year ("Jul 13, 2025 · 3:42 PM"). Empty string if unparseable.
 */
export function formatMessageTime(iso: string, now: number = Date.now()): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '';
  const d = new Date(parsed);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const date = d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

/**
 * The day-divider label for a message time: "Today" / "Yesterday" / a same-year weekday+date
 * ("Monday, Jun 30") / a full date with year for older messages ("Jun 30, 2025"). Empty string if the ISO
 * can't be parsed.
 */
export function formatDayLabel(iso: string, now: number = Date.now()): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '';
  const d = new Date(parsed);
  const today = new Date(now);
  if (isSameCalendarDay(d, today)) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameCalendarDay(d, yesterday)) return 'Yesterday';
  if (d.getFullYear() === today.getFullYear())
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * The divider label to render BEFORE a message, or null for none. A divider shows at the very top of a
 * thread (`prevIso` undefined) and again whenever the calendar day changes from the previous message — so
 * a bare time is never ambiguous once a session is resumed across days. Null if `curIso` is unparseable.
 */
export function dayDividerLabel(
  prevIso: string | undefined,
  curIso: string,
  now: number = Date.now(),
): string | null {
  const cur = Date.parse(curIso);
  if (Number.isNaN(cur)) return null;
  if (prevIso === undefined) return formatDayLabel(curIso, now);
  const prev = Date.parse(prevIso);
  if (Number.isNaN(prev)) return formatDayLabel(curIso, now);
  return isSameCalendarDay(new Date(prev), new Date(cur)) ? null : formatDayLabel(curIso, now);
}

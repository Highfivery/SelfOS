/** Short, locale-aware date for a "Sent · <date>" chip; falls back to the raw ISO if it can't be parsed. */
export function formatSentDate(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleDateString();
}

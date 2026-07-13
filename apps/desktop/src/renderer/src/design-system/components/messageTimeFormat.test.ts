import { describe, expect, it } from 'vitest';
import { dayDividerLabel, formatDayLabel, formatMessageTime } from './messageTimeFormat';

// A fixed "now" so Today/Yesterday/weekday assertions are deterministic. Local time to match the helpers.
const NOW = new Date(2026, 6, 13, 15, 46, 0).getTime(); // Mon Jul 13, 2026, 3:46 PM

describe('formatMessageTime', () => {
  it('formats a same-year message as short date + time, with no year', () => {
    const out = formatMessageTime(new Date(2026, 6, 13, 15, 42).toISOString(), NOW);
    expect(out).toMatch(/Jul/);
    expect(out).toContain('·');
    expect(out).toMatch(/\d/);
    expect(out).not.toMatch(/2026/);
  });

  it('includes the year for a prior-year message', () => {
    const out = formatMessageTime(new Date(2025, 11, 30, 9, 5).toISOString(), NOW);
    expect(out).toMatch(/Dec/);
    expect(out).toMatch(/2025/);
    expect(out).toContain('·');
  });

  it('returns empty string for an unparseable ISO (renders nothing)', () => {
    expect(formatMessageTime('not-a-date')).toBe('');
    expect(formatMessageTime('')).toBe('');
  });
});

describe('formatDayLabel', () => {
  it('labels a same-day time "Today"', () => {
    expect(formatDayLabel(new Date(2026, 6, 13, 9, 0).toISOString(), NOW)).toBe('Today');
  });

  it('labels the previous day "Yesterday"', () => {
    expect(formatDayLabel(new Date(2026, 6, 12, 23, 0).toISOString(), NOW)).toBe('Yesterday');
  });

  it('labels an earlier same-year day with a weekday + date (no year)', () => {
    const out = formatDayLabel(new Date(2026, 5, 30, 10, 0).toISOString(), NOW);
    expect(out).toMatch(/Jun/);
    expect(out).not.toMatch(/2026/);
  });

  it('labels a prior-year day with the year', () => {
    const out = formatDayLabel(new Date(2025, 11, 30, 10, 0).toISOString(), NOW);
    expect(out).toMatch(/2025/);
  });

  it('returns empty string for an unparseable ISO', () => {
    expect(formatDayLabel('nope', NOW)).toBe('');
  });
});

describe('dayDividerLabel', () => {
  it('always shows a divider before the first message (no previous)', () => {
    expect(dayDividerLabel(undefined, new Date(2026, 6, 13, 9, 0).toISOString(), NOW)).toBe(
      'Today',
    );
  });

  it('shows no divider between two messages on the same day', () => {
    const a = new Date(2026, 6, 13, 9, 0).toISOString();
    const b = new Date(2026, 6, 13, 15, 0).toISOString();
    expect(dayDividerLabel(a, b, NOW)).toBeNull();
  });

  it('shows a divider when the day changes from the previous message', () => {
    const yesterday = new Date(2026, 6, 12, 22, 0).toISOString();
    const today = new Date(2026, 6, 13, 9, 0).toISOString();
    expect(dayDividerLabel(yesterday, today, NOW)).toBe('Today');
  });

  it('falls back to a leading divider when the previous ISO is unparseable', () => {
    expect(dayDividerLabel('bad', new Date(2026, 6, 13, 9, 0).toISOString(), NOW)).toBe('Today');
  });

  it('returns null when the current ISO is unparseable', () => {
    expect(dayDividerLabel(new Date(2026, 6, 13, 9, 0).toISOString(), 'bad', NOW)).toBeNull();
  });
});

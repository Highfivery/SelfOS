import { describe, expect, it } from 'vitest';
import { relativeTime } from './relativeTime';

const now = Date.parse('2026-06-23T12:00:00.000Z');

describe('relativeTime', () => {
  it('reads "just now" within ~45s', () => {
    expect(relativeTime('2026-06-23T11:59:30.000Z', now)).toBe('just now');
  });

  it('formats minutes, hours, days, and weeks', () => {
    expect(relativeTime('2026-06-23T11:55:00.000Z', now)).toBe('5m');
    expect(relativeTime('2026-06-23T09:00:00.000Z', now)).toBe('3h');
    expect(relativeTime('2026-06-21T12:00:00.000Z', now)).toBe('2d');
    expect(relativeTime('2026-06-09T12:00:00.000Z', now)).toBe('2w');
  });

  it('returns an empty string for an unparseable timestamp', () => {
    expect(relativeTime('not-a-date', now)).toBe('');
  });
});

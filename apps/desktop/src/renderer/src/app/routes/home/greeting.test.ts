import { describe, expect, it } from 'vitest';
import { buildStatusLine, timeOfDayGreeting } from './greeting';

describe('timeOfDayGreeting', () => {
  it('maps the hour to a warm greeting', () => {
    expect(timeOfDayGreeting(2)).toBe('Hello');
    expect(timeOfDayGreeting(9)).toBe('Good morning');
    expect(timeOfDayGreeting(14)).toBe('Good afternoon');
    expect(timeOfDayGreeting(21)).toBe('Good evening');
  });
});

describe('buildStatusLine', () => {
  it('prefers open sessions, pluralized', () => {
    expect(buildStatusLine({ openSessions: 2, inboxCount: 1, moodRead: 'x' })).toBe(
      '2 sessions in progress',
    );
    expect(buildStatusLine({ openSessions: 1, inboxCount: 0, moodRead: '' })).toBe(
      '1 session in progress',
    );
  });

  it('falls back to inbox, then the mood read, then nothing', () => {
    expect(buildStatusLine({ openSessions: 0, inboxCount: 3, moodRead: 'x' })).toMatch(
      /3 things waiting/,
    );
    expect(buildStatusLine({ openSessions: 0, inboxCount: 0, moodRead: 'steady' })).toBe('steady');
    expect(buildStatusLine({ openSessions: 0, inboxCount: 0, moodRead: '' })).toBe('');
  });
});

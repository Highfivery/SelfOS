import { describe, expect, it } from 'vitest';
import { timeOfDayGreeting } from './greeting';

describe('timeOfDayGreeting', () => {
  it('maps the hour to a warm greeting', () => {
    expect(timeOfDayGreeting(2)).toBe('Hello');
    expect(timeOfDayGreeting(9)).toBe('Good morning');
    expect(timeOfDayGreeting(14)).toBe('Good afternoon');
    expect(timeOfDayGreeting(21)).toBe('Good evening');
  });
});

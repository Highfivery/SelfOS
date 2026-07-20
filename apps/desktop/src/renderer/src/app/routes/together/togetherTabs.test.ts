import { describe, expect, it } from 'vitest';
import { isTogetherTab, resolveTogetherTab, visibleTogetherTabs } from './togetherTabs';

describe('visibleTogetherTabs', () => {
  it('appends Desire only once the pair has unlocked it', () => {
    expect(visibleTogetherTabs(false)).toEqual(['sessions', 'practices', 'pulse']);
    expect(visibleTogetherTabs(true)).toEqual(['sessions', 'practices', 'pulse', 'desire']);
  });
});

describe('isTogetherTab', () => {
  it('accepts only the known tab names', () => {
    expect(isTogetherTab('sessions')).toBe(true);
    expect(isTogetherTab('desire')).toBe(true);
    expect(isTogetherTab('session')).toBe(false); // the /together/session/:id sibling route
    expect(isTogetherTab('')).toBe(false);
  });
});

describe('resolveTogetherTab', () => {
  it('resolves a valid segment, ignoring anything after the first path part', () => {
    expect(resolveTogetherTab('practices', false)).toBe('practices');
    expect(resolveTogetherTab('pulse/extra', false)).toBe('pulse');
  });

  it('falls back to sessions for an unknown segment (incl. the session route or empty)', () => {
    expect(resolveTogetherTab('', false)).toBe('sessions');
    expect(resolveTogetherTab(undefined, false)).toBe('sessions');
    expect(resolveTogetherTab('session/abc', false)).toBe('sessions');
    expect(resolveTogetherTab('nonsense', false)).toBe('sessions');
  });

  it('falls back when a deep-link targets Desire while it is still locked', () => {
    // A stale /together/desire link must not show an empty tab before the pair unlocks it.
    expect(resolveTogetherTab('desire', false)).toBe('sessions');
    expect(resolveTogetherTab('desire', true)).toBe('desire');
  });
});

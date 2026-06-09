import { describe, expect, it } from 'vitest';
import { isAppearance, resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('follows the OS when appearance is system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('respects an explicit appearance regardless of the OS', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('isAppearance', () => {
  it('accepts the three valid values', () => {
    expect(isAppearance('system')).toBe(true);
    expect(isAppearance('light')).toBe(true);
    expect(isAppearance('dark')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isAppearance('blue')).toBe(false);
    expect(isAppearance(null)).toBe(false);
    expect(isAppearance(undefined)).toBe(false);
  });
});

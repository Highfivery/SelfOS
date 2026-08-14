import { describe, expect, it } from 'vitest';
import { isSafePairKey, isSafeSegment, pathSegment, UnsafePathSegmentError } from './pathSafety';

describe('vault path-segment safety', () => {
  it('accepts the ids we mint and the slugs we author', () => {
    expect(isSafeSegment('018f0a2e-7b1c-4a9d-9f21-3c5e7d8a1b2c'.replace(/-/g, ''))).toBe(true);
    expect(isSafeSegment('018f0a2e-7b1c-4a9d')).toBe(true);
    expect(isSafeSegment('owner-1')).toBe(true);
    expect(isSafeSegment('chapter_2')).toBe(true);
  });

  it('refuses anything that could move the path', () => {
    for (const bad of [
      '..',
      '../x',
      'a/b',
      'a\\b',
      '',
      '.',
      'a b',
      'a.enc',
      '~',
      'a~b',
      '/etc/passwd',
      'a\0b',
    ]) {
      expect(isSafeSegment(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('pathSegment returns a safe id and throws on an unsafe one', () => {
    expect(pathSegment('book-1')).toBe('book-1');
    expect(() => pathSegment('../../etc')).toThrow(UnsafePathSegmentError);
    // The message must not echo the value back — it can end up in a log.
    expect(() => pathSegment('../../secret-token')).not.toThrow(/secret-token/);
  });

  it('a pairKey is exactly two safe ids joined by ~', () => {
    expect(isSafePairKey('a~b')).toBe(true);
    expect(isSafePairKey('owner-1~kid-1')).toBe(true);
    expect(isSafePairKey('a')).toBe(false);
    expect(isSafePairKey('a~b~c')).toBe(false);
    expect(isSafePairKey('..~b')).toBe(false);
    expect(isSafePairKey('a~..')).toBe(false);
  });
});

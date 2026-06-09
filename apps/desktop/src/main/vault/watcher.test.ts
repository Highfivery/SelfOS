// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { shouldEmitChange } from './watcher';
import { notifyWrite, onWrite } from './writeObserver';

describe('shouldEmitChange', () => {
  it('suppresses a change we just wrote (within the echo window)', () => {
    const recent = new Map([['/vault/a.md', 1000]]);
    expect(shouldEmitChange('/vault/a.md', recent, 1200, 1500)).toBe(false);
  });

  it('emits once the echo window has passed', () => {
    const recent = new Map([['/vault/a.md', 1000]]);
    expect(shouldEmitChange('/vault/a.md', recent, 3000, 1500)).toBe(true);
  });

  it('emits for files we never wrote', () => {
    expect(shouldEmitChange('/vault/external.md', new Map(), 5000)).toBe(true);
  });
});

describe('writeObserver', () => {
  it('notifies subscribers and stops after unsubscribe', () => {
    const seen: string[] = [];
    const off = onWrite((p) => seen.push(p));
    notifyWrite('/vault/x.md');
    off();
    notifyWrite('/vault/y.md');
    expect(seen).toEqual(['/vault/x.md']);
  });
});

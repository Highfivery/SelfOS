import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The per-person reset list in `AppShell` is a hand-maintained list, and forgetting one entry is a data bug
 * that no feature test can see: the store keeps the previous person's data on screen, and anything that
 * WRITES from that store writes it into whoever is active now.
 *
 * It has already happened twice — `resultsStore` (2026-07-10) and `adaptiveTestStore` (74 §3.4), where a
 * debounced autosave turned the omission into an unattended write of one person's explicit vocabulary into
 * another household member's vault.
 *
 * So this pins the list itself: every store that can `reset()` is either wired into the person-change effect
 * or named below as deliberately not per-person. Adding a store now forces that decision to be made once,
 * out loud, instead of being missed.
 */

/** Stores whose data is NOT scoped to the active person — household-wide, device-local, or app-global. */
const NOT_PER_PERSON = new Set([
  'appStore', // boot/vault state for the whole app
  'sessionStore', // the switcher itself — it OWNS the active person
  'notificationStore', // per-person, but reset by the notification effect on its own cadence
]);

describe('the per-person store reset (AppShell)', () => {
  it('resets every store that can be reset, or names it as not per-person', () => {
    const dir = join(__dirname, '..', 'stores');
    const shell = readFileSync(join(__dirname, 'AppShell.tsx'), 'utf8');

    const resettable = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => /\breset:\s*\(/.test(readFileSync(join(dir, f), 'utf8')))
      .map((f) => f.replace(/\.ts$/, ''));

    // Sanity: the scan itself must be finding stores, or this test silently passes forever.
    expect(resettable.length).toBeGreaterThan(15);

    const missing = resettable
      .filter((name) => !NOT_PER_PERSON.has(name))
      .filter((name) => !shell.includes(`${name}`));

    expect(missing).toEqual([]);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { getCoachingPrefs, getProactivity, setCoachingPrefs } from './coachingPrefsService';

const key = generateMasterKey();
let fs: ReturnType<typeof memFileSystem>;
beforeEach(() => {
  fs = memFileSystem();
});

describe('coachingPrefsService (40 §4.1a)', () => {
  it('defaults to "gentle" when no prefs file exists', async () => {
    expect(await getProactivity(fs, key, 'p1')).toBe('gentle');
    expect(await getCoachingPrefs(fs, key, 'p1')).toEqual({ schemaVersion: 1 });
  });

  it('round-trips a chosen level (encrypted, per-person)', async () => {
    await setCoachingPrefs(fs, key, 'p1', { proactivity: 'off' });
    expect(await getProactivity(fs, key, 'p1')).toBe('off');
    await setCoachingPrefs(fs, key, 'p1', { proactivity: 'active' });
    expect(await getProactivity(fs, key, 'p1')).toBe('active');
  });

  it('is isolated per person', async () => {
    await setCoachingPrefs(fs, key, 'p1', { proactivity: 'off' });
    expect(await getProactivity(fs, key, 'p1')).toBe('off');
    expect(await getProactivity(fs, key, 'p2')).toBe('gentle'); // p2 untouched
  });

  it('persists at the per-person coaching path (not the vault settings)', async () => {
    await setCoachingPrefs(fs, key, 'p9', { proactivity: 'active' });
    const stored = await fs.read('people/p9/coaching/prefs.enc');
    expect(stored).not.toBeNull();
    // Encrypted at rest — the plaintext level never appears in the file bytes.
    expect(new TextDecoder().decode(stored!)).not.toContain('active');
  });
});

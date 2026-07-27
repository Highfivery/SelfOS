import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import {
  DEFAULT_IMAGE_PREFS,
  readFeatureImagePrefs,
  readImagePrefs,
  setFeatureImagePrefs,
} from './imagePrefsService';

const key = generateMasterKey();

describe('imagePrefsService', () => {
  it('defaults to generation off with per-feature default styles when unset', async () => {
    const fs = memFileSystem();
    const prefs = await readImagePrefs(fs, key, 'p1');
    expect(prefs).toEqual(DEFAULT_IMAGE_PREFS);
    expect(prefs.dreams.enabled).toBe(false);
    expect(prefs.dreams.style).toBe('dreamlike');
    expect(prefs.story.style).toBe('oil painting');
  });

  it('patches one feature without touching the other', async () => {
    const fs = memFileSystem();
    await setFeatureImagePrefs(fs, key, 'p1', 'dreams', {
      enabled: true,
      style: 'watercolor',
      styleNotes: 'muted',
    });
    const dreams = await readFeatureImagePrefs(fs, key, 'p1', 'dreams');
    const story = await readFeatureImagePrefs(fs, key, 'p1', 'story');
    expect(dreams).toEqual({ enabled: true, style: 'watercolor', styleNotes: 'muted' });
    // Story is untouched (still its default).
    expect(story).toEqual(DEFAULT_IMAGE_PREFS.story);
  });

  it('is strictly PER PERSON — one person changing theirs never affects another (the reported bug)', async () => {
    const fs = memFileSystem();
    await setFeatureImagePrefs(fs, key, 'a', 'dreams', { enabled: true, style: 'ukiyo-e' });
    await setFeatureImagePrefs(fs, key, 'b', 'dreams', { enabled: true, style: 'oil painting' });
    expect((await readFeatureImagePrefs(fs, key, 'a', 'dreams')).style).toBe('ukiyo-e');
    // Person B's change did not overwrite A's.
    expect((await readFeatureImagePrefs(fs, key, 'b', 'dreams')).style).toBe('oil painting');
  });

  it('ignores a blank style patch (keeps the existing style) and clamps long notes', async () => {
    const fs = memFileSystem();
    await setFeatureImagePrefs(fs, key, 'p', 'dreams', { style: 'watercolor' });
    await setFeatureImagePrefs(fs, key, 'p', 'dreams', { style: '   ' }); // blank → ignored
    await setFeatureImagePrefs(fs, key, 'p', 'dreams', { styleNotes: 'x'.repeat(400) });
    const dreams = await readFeatureImagePrefs(fs, key, 'p', 'dreams');
    expect(dreams.style).toBe('watercolor');
    expect(dreams.styleNotes).toHaveLength(300);
  });
});

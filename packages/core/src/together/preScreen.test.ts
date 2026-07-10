import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import {
  PRESCREEN_ITEMS,
  PRESCREEN_ITEM_CATALOG_VERSION,
  evaluatePreScreen,
  getPreScreen,
  isPreScreenComplete,
  preScreenClears,
  preScreenNeedsReoffer,
  savePreScreenOutcome,
} from './preScreen';

const key = generateMasterKey();
const NOW = new Date('2026-07-10T12:00:00.000Z');

/** A fully clear set of answers (no flag triggers). */
const CLEAR: Record<string, string> = {
  'safe-honest': 'yes',
  afraid: 'never',
  'own-choice': 'yes',
  'prefer-solo': 'ready',
};

describe('evaluatePreScreen (conservative rule)', () => {
  it('a clear set is not flagged, no crisis, no solo suggestion', () => {
    expect(evaluatePreScreen(CLEAR)).toEqual({
      flagged: false,
      showCrisis: false,
      suggestSolo: false,
    });
  });

  it('flags on not-safe-being-honest', () => {
    expect(evaluatePreScreen({ ...CLEAR, 'safe-honest': 'no' }).flagged).toBe(true);
  });

  it('flags on any fear ("sometimes" or "often"); "often" also surfaces crisis resources', () => {
    expect(evaluatePreScreen({ ...CLEAR, afraid: 'sometimes' })).toMatchObject({
      flagged: true,
      showCrisis: false,
    });
    expect(evaluatePreScreen({ ...CLEAR, afraid: 'often' })).toMatchObject({
      flagged: true,
      showCrisis: true,
    });
  });

  it('flags on pressure / not-my-own-choice', () => {
    expect(evaluatePreScreen({ ...CLEAR, 'own-choice': 'pressure' }).flagged).toBe(true);
    expect(evaluatePreScreen({ ...CLEAR, 'own-choice': 'no' }).flagged).toBe(true);
  });

  it('"prefer solo first" suggests solo but is NOT itself a hard flag (autonomy, not a safety signal)', () => {
    expect(evaluatePreScreen({ ...CLEAR, 'prefer-solo': 'yes' })).toEqual({
      flagged: false,
      showCrisis: false,
      suggestSolo: true,
    });
    expect(evaluatePreScreen({ ...CLEAR, 'prefer-solo': 'maybe' }).suggestSolo).toBe(true);
  });

  it('a flag always implies the solo suggestion', () => {
    expect(evaluatePreScreen({ ...CLEAR, afraid: 'sometimes' }).suggestSolo).toBe(true);
  });
});

describe('isPreScreenComplete', () => {
  it('requires all four items answered', () => {
    expect(isPreScreenComplete(CLEAR)).toBe(true);
    expect(isPreScreenComplete({ 'safe-honest': 'yes' })).toBe(false);
  });
  it('every item has 3 choices + a stable id', () => {
    expect(PRESCREEN_ITEMS).toHaveLength(4);
    for (const item of PRESCREEN_ITEMS) expect(item.choices).toHaveLength(3);
  });
});

describe('outcome-only storage + the gate', () => {
  it('persists ONLY the outcome (never the raw answers)', async () => {
    const fs = memFileSystem();
    await savePreScreenOutcome(fs, key, 'p1', false, NOW);
    const stored = await getPreScreen(fs, key, 'p1');
    expect(stored).toEqual({
      schemaVersion: 1,
      personId: 'p1',
      flagged: false,
      itemCatalogVersion: PRESCREEN_ITEM_CATALOG_VERSION,
      completedAt: NOW.toISOString(),
    });
    // The stored object has no `answers` field of any shape — outcome only.
    expect(JSON.stringify(stored)).not.toContain('answers');
  });

  it('the gate: missing OR flagged ⇒ held; a clear result clears', async () => {
    const fs = memFileSystem();
    expect(preScreenClears(await getPreScreen(fs, key, 'p1'))).toBe(false); // missing
    await savePreScreenOutcome(fs, key, 'p1', true, NOW);
    expect(preScreenClears(await getPreScreen(fs, key, 'p1'))).toBe(false); // flagged
    await savePreScreenOutcome(fs, key, 'p1', false, NOW);
    expect(preScreenClears(await getPreScreen(fs, key, 'p1'))).toBe(true); // clear
  });

  it('a corrupt pre-screen file ⇒ treated as missing (re-screen)', async () => {
    const fs = memFileSystem();
    await fs.writeAtomic(
      'people/p1/together/prescreen.enc',
      new TextEncoder().encode('not-encrypted'),
    );
    expect(await getPreScreen(fs, key, 'p1')).toBeNull();
  });

  it('re-offers (never re-gates) a CLEAR result after 180 quiet days', async () => {
    const fs = memFileSystem();
    const old = new Date('2026-01-01T00:00:00.000Z');
    const result = await savePreScreenOutcome(fs, key, 'p1', false, old);
    expect(preScreenNeedsReoffer(result, NOW)).toBe(true); // 190 days later
    expect(preScreenClears(result)).toBe(true); // …but it still CLEARS the gate (age never re-gates)
    expect(preScreenNeedsReoffer(await savePreScreenOutcome(fs, key, 'p1', false, NOW), NOW)).toBe(
      false,
    );
  });
});

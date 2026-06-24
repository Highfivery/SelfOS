import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { Insight } from '../schemas';
import { getInsight, saveInsight } from './insightStore';
import { retroTagLegacyPortraits } from './legacyRetroTag';

const key = generateMasterKey();

function insight(over: Partial<Insight> & { id: string }): Insight {
  return {
    schemaVersion: 1,
    source: 'intake',
    subjectPersonId: 'p1',
    summary: `summary-${over.id}`,
    facts: [],
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { intakeSection: 'basics', at: '2026-06-10T00:00:00.000Z' },
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    ...over,
  };
}

describe('retroTagLegacyPortraits (39 §4.5 — no-AI life-area tagging)', () => {
  it('tags an untagged portrait’s facts from keywords; unmatched facts stay untagged', async () => {
    const fs = memFileSystem();
    await saveInsight(
      fs,
      key,
      insight({
        id: 'portrait',
        facts: [
          { id: 'f1', text: 'Saving toward a mortgage deposit', shareable: false },
          { id: 'f2', text: 'Close with their mother and sister', shareable: false },
          { id: 'f3', text: 'A generally curious person', shareable: false }, // no strong keyword
        ],
      }),
    );
    const tagged = await retroTagLegacyPortraits(fs, key, 'p1');
    expect(tagged).toBe(1);
    const out = await getInsight(fs, key, 'p1', 'portrait');
    // The keyword fallback is rough by design (§11 Q5) — assert each matched fact gets a taxonomy area and an
    // unmatched fact stays CORE, not exact values.
    expect(out?.facts.find((f) => f.id === 'f1')?.lifeArea).toBe('Money');
    expect(out?.facts.find((f) => f.id === 'f2')?.lifeArea).toBe('Family');
    expect('lifeArea' in (out?.facts.find((f) => f.id === 'f3') ?? {})).toBe(false); // unmatched → CORE
    expect(out?.updatedAt).toBe('2026-06-10T00:00:00.000Z'); // invisible maintenance — not bumped
  });

  it('keeps a distress fact CORE — prefers Emotions over an earlier-ordered keyword (§28/§8 safety)', async () => {
    const fs = memFileSystem();
    await saveInsight(
      fs,
      key,
      insight({
        id: 'portrait',
        // "anxiety" → Emotions & patterns AND "work" → Work & purpose (earlier in LIFE_AREAS); the distress
        // tag must win so the fact stays always-on, not narrowed away in a non-work session.
        facts: [{ id: 'f1', text: 'Constant anxiety about work deadlines', shareable: false }],
      }),
    );
    await retroTagLegacyPortraits(fs, key, 'p1');
    const out = await getInsight(fs, key, 'p1', 'portrait');
    expect(out?.facts.find((f) => f.id === 'f1')?.lifeArea).toBe('Emotions & patterns');
  });

  it('skips an already-tagged portrait and non-intake insights (idempotent)', async () => {
    const fs = memFileSystem();
    await saveInsight(
      fs,
      key,
      insight({
        id: 'fresh',
        facts: [{ id: 'f1', text: 'Worried about money', shareable: false, lifeArea: 'Money' }],
      }),
    );
    await saveInsight(
      fs,
      key,
      insight({
        id: 'sess',
        source: 'session',
        facts: [{ id: 'f1', text: 'Worried about money', shareable: false }],
      }),
    );
    expect(await retroTagLegacyPortraits(fs, key, 'p1')).toBe(0);
    // A session insight is untouched (only the portrait is pinned + selected, so only it needs tags).
    expect('lifeArea' in ((await getInsight(fs, key, 'p1', 'sess'))?.facts[0] ?? {})).toBe(false);
  });
});

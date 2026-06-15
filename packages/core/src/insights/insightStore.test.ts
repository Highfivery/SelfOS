import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { Insight } from '../schemas';
import {
  deleteInsight,
  getInsight,
  listInsightsForPerson,
  saveInsight,
  summarizeForContext,
} from './insightStore';

const key = generateMasterKey();

function insight(over: Partial<Insight> & { id: string; subjectPersonId: string }): Insight {
  return {
    schemaVersion: 1,
    source: 'questionnaire',
    summary: `summary-${over.id}`,
    facts: [],
    confidence: 'medium',
    approved: true,
    provenance: { at: '2026-06-10T00:00:00.000Z' },
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    ...over,
  };
}

describe('insightStore', () => {
  it('saves, reads, lists (newest first), and deletes', async () => {
    const fs = memFileSystem();
    await saveInsight(
      fs,
      key,
      insight({ id: 'i1', subjectPersonId: 'p1', updatedAt: '2026-06-10T10:00:00.000Z' }),
    );
    await saveInsight(
      fs,
      key,
      insight({ id: 'i2', subjectPersonId: 'p1', updatedAt: '2026-06-10T12:00:00.000Z' }),
    );
    expect((await listInsightsForPerson(fs, key, 'p1')).map((i) => i.id)).toEqual(['i2', 'i1']);
    expect((await getInsight(fs, key, 'p1', 'i1'))?.summary).toBe('summary-i1');
    await deleteInsight(fs, 'p1', 'i1');
    expect(await getInsight(fs, key, 'p1', 'i1')).toBeNull();
  });

  it('stores insights encrypted at rest', async () => {
    const fs = memFileSystem();
    await saveInsight(
      fs,
      key,
      insight({ id: 'i1', subjectPersonId: 'p1', summary: 'they love climbing' }),
    );
    const bytes = await fs.read('people/p1/insights/i1.enc');
    const raw = bytes && new TextDecoder().decode(bytes);
    expect(raw).toContain('aes-256-gcm');
    expect(raw).not.toContain('they love climbing');
  });

  describe('summarizeForContext', () => {
    it('includes own approved insights (summary + all own facts) and excludes unapproved ones', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p1',
          summary: 'values honesty',
          facts: [{ id: 'f1', text: 'private to them', shareable: false }],
        }),
      );
      await saveInsight(
        fs,
        key,
        insight({ id: 'i2', subjectPersonId: 'p1', approved: false, summary: 'not yet approved' }),
      );

      const out = await summarizeForContext(fs, key, 'p1', []);
      expect(out).toContain('values honesty');
      expect(out).toContain('private to them'); // own private facts feed their OWN coaching
      expect(out).not.toContain('not yet approved'); // unapproved insights never enter context
    });

    it("includes related people's SHAREABLE facts but never their private ones", async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p2',
          facts: [
            { id: 'f1', text: 'p2 started a new job', shareable: true },
            { id: 'f2', text: 'p2 confidential', shareable: false },
          ],
        }),
      );

      const out = await summarizeForContext(fs, key, 'p1', [{ id: 'p2', displayName: 'Sam' }]);
      expect(out).toContain('Shareable about Sam');
      expect(out).toContain('p2 started a new job');
      expect(out).not.toContain('p2 confidential');
    });

    it('PINS the onboarding portrait (source intake) in context past the recency cap', async () => {
      const fs = memFileSystem();
      // An old intake portrait, then 14 newer session insights (> the 12 own-insight cap).
      await saveInsight(
        fs,
        key,
        insight({
          id: 'portrait',
          subjectPersonId: 'p1',
          source: 'intake',
          summary: 'the foundational portrait',
          updatedAt: '2026-06-01T00:00:00.000Z',
        }),
      );
      for (let i = 0; i < 14; i += 1) {
        await saveInsight(
          fs,
          key,
          insight({
            id: `s${i}`,
            subjectPersonId: 'p1',
            source: 'session',
            summary: `session ${i}`,
            updatedAt: `2026-06-${String(10 + i).padStart(2, '0')}T00:00:00.000Z`,
          }),
        );
      }
      const out = await summarizeForContext(fs, key, 'p1', []);
      // Despite being the oldest, the portrait is still in context (pinned).
      expect(out).toContain('the foundational portrait');
    });

    it('returns an empty string when there are no insights', async () => {
      const fs = memFileSystem();
      expect(await summarizeForContext(fs, key, 'p1', [])).toBe('');
    });
  });
});

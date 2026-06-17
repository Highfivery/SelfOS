import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { Insight } from '../schemas';
import {
  deleteInsight,
  flagInsightFact,
  getInsight,
  listInsightsForPerson,
  listRelatedShareableInsights,
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
    categories: [],
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

  describe('listRelatedShareableInsights (the Memory dashboard view, spec 20 §5.1)', () => {
    const related = [{ id: 'p2', displayName: 'Sam' }];

    it("surfaces a related person's shareable facts only, with the summary stripped", async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p2',
          summary: 'SAMS PRIVATE SUMMARY',
          facts: [
            { id: 'f1', text: 'p2 started a new job', shareable: true },
            { id: 'f2', text: 'p2 confidential', shareable: false },
          ],
        }),
      );
      const out = await listRelatedShareableInsights(fs, key, 'p1', related);
      expect(out).toHaveLength(1);
      expect(out[0]!.subjectPersonId).toBe('p2');
      expect(out[0]!.summary).toBe(''); // a related person's summary is private to them — never crosses over
      expect(out[0]!.facts.map((f) => f.text)).toEqual(['p2 started a new job']);
      expect(out[0]!.facts.some((f) => f.text === 'p2 confidential')).toBe(false);
    });

    it("scrubs a related person's private envelope (metrics, crisisFlag, precise provenance, shareableWith)", async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p2',
          summary: 'SAMS PRIVATE SUMMARY',
          metrics: { moodValence: -0.8, moodEnergy: -0.5 },
          crisisFlag: true,
          provenance: { intakeSection: 'what-weighs-on-you', conversationId: 'conv-99', at: 'now' },
          facts: [
            { id: 'f1', text: 'p2 likes hiking', shareable: true, shareableWith: ['pX', 'p1'] },
          ],
        }),
      );
      const [related] = await listRelatedShareableInsights(fs, key, 'p1', [
        { id: 'p2', displayName: 'Sam' },
      ]);
      expect(related).toBeDefined();
      expect(related!.metrics).toBeUndefined(); // private wellbeing signals never cross over
      expect(related!.crisisFlag).toBeUndefined(); // their crisis state is their own
      expect(related!.provenance).toEqual({ at: 'now' }); // precise origin (section/conversation) stripped
      expect(related!.summary).toBe('');
      // The shared fact crosses with text only — `shareableWith` (who ELSE has it) does not.
      expect(related!.facts).toEqual([{ id: 'f1', text: 'p2 likes hiking', shareable: true }]);
    });

    it('honors per-person targeting (shareableWith) and never exposes a restricted fact', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p2',
          facts: [
            { id: 'f1', text: 'targeted at p1', shareable: false, shareableWith: ['p1'] },
            { id: 'f2', text: 'targeted at someone else', shareable: false, shareableWith: ['pX'] },
            { id: 'f3', text: 'restricted yet shareable', shareable: true, restricted: true },
          ],
        }),
      );
      const out = await listRelatedShareableInsights(fs, key, 'p1', related);
      expect(out[0]!.facts.map((f) => f.text)).toEqual(['targeted at p1']);
    });

    it('excludes a related draft (unapproved) insight and drops insights with no shareable fact', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'draft',
          subjectPersonId: 'p2',
          approved: false,
          facts: [{ id: 'f1', text: 'unapproved but shareable', shareable: true }],
        }),
      );
      await saveInsight(
        fs,
        key,
        insight({
          id: 'allPrivate',
          subjectPersonId: 'p2',
          facts: [{ id: 'f1', text: 'all private', shareable: false }],
        }),
      );
      expect(await listRelatedShareableInsights(fs, key, 'p1', related)).toEqual([]);
    });
  });

  describe('flagInsightFact + flagged-fact context exclusion (spec 20 §3.6)', () => {
    const now = new Date('2026-06-16T00:00:00.000Z');

    it('flags one fact (stamps flaggedAt) and clears it (drops both fields)', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p1',
          facts: [
            { id: 'f1', text: 'fact one', shareable: false },
            { id: 'f2', text: 'fact two', shareable: false },
          ],
        }),
      );
      const flagged = await flagInsightFact(fs, key, 'p1', 'i1', 'f1', true, now);
      expect(flagged?.facts.find((f) => f.id === 'f1')?.flaggedInaccurate).toBe(true);
      expect(flagged?.facts.find((f) => f.id === 'f1')?.flaggedAt).toBe('2026-06-16T00:00:00.000Z');
      expect(flagged?.facts.find((f) => f.id === 'f2')?.flaggedInaccurate).toBeUndefined();

      const cleared = await flagInsightFact(fs, key, 'p1', 'i1', 'f1', false, now);
      const f1 = cleared?.facts.find((f) => f.id === 'f1');
      expect(f1 && 'flaggedInaccurate' in f1).toBe(false);
      expect(f1 && 'flaggedAt' in f1).toBe(false);
    });

    it('flags the whole insight when factId is null', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p1',
          facts: [
            { id: 'f1', text: 'a', shareable: false },
            { id: 'f2', text: 'b', shareable: false },
          ],
        }),
      );
      const flagged = await flagInsightFact(fs, key, 'p1', 'i1', null, true, now);
      expect(flagged?.facts.every((f) => f.flaggedInaccurate)).toBe(true);
    });

    it('excludes a flagged fact from OWN context immediately (summarizeForContext)', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p1',
          facts: [
            { id: 'f1', text: 'still true', shareable: false },
            { id: 'f2', text: 'WRONG', shareable: false, flaggedInaccurate: true },
          ],
        }),
      );
      const out = await summarizeForContext(fs, key, 'p1', []);
      expect(out).toContain('still true');
      expect(out).not.toContain('WRONG');
    });

    it('drops a WHOLLY-flagged insight (summary too) from own context', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p1',
          summary: 'THIS WHOLE THING IS WRONG',
          facts: [
            { id: 'f1', text: 'wrong a', shareable: false, flaggedInaccurate: true },
            { id: 'f2', text: 'wrong b', shareable: false, flaggedInaccurate: true },
          ],
        }),
      );
      await saveInsight(
        fs,
        key,
        insight({ id: 'i2', subjectPersonId: 'p1', summary: 'still good' }),
      );
      const out = await summarizeForContext(fs, key, 'p1', []);
      expect(out).not.toContain('THIS WHOLE THING IS WRONG'); // the summary is gone too
      expect(out).toContain('still good'); // an unflagged summary-only insight is unaffected
    });

    it('excludes a flagged fact from a RELATED person’s shared context', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p2',
          facts: [
            { id: 'f1', text: 'shareable + true', shareable: true },
            { id: 'f2', text: 'shareable but WRONG', shareable: true, flaggedInaccurate: true },
          ],
        }),
      );
      const out = await summarizeForContext(fs, key, 'p1', [{ id: 'p2', displayName: 'Sam' }]);
      expect(out).toContain('shareable + true');
      expect(out).not.toContain('WRONG');
      // ...and from the Memory dashboard's related view too.
      const related = await listRelatedShareableInsights(fs, key, 'p1', [
        { id: 'p2', displayName: 'Sam' },
      ]);
      expect(related[0]?.facts.map((f) => f.text)).toEqual(['shareable + true']);
    });
  });
});

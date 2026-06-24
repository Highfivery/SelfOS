import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { Insight } from '../schemas';
import { getInsight, saveInsight } from './insightStore';
import {
  applyMerge,
  listMergeProposals,
  queueMergeProposals,
  resolveMergeProposal,
} from './mergeProposals';

const key = generateMasterKey();
const now = new Date('2026-06-20T00:00:00.000Z');

function insight(over: Partial<Insight> & { id: string }): Insight {
  return {
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'p1',
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

describe('mergeProposals (39 §3.4)', () => {
  it('queueMergeProposals dedups a pair in either direction', async () => {
    const fs = memFileSystem();
    const summaries = new Map([
      ['a', 'A'],
      ['b', 'B'],
    ]);
    expect(
      await queueMergeProposals(fs, key, 'p1', [{ from: 'a', into: 'b' }], summaries, now),
    ).toBe(1);
    // Same pair, reversed → not re-queued.
    expect(
      await queueMergeProposals(fs, key, 'p1', [{ from: 'b', into: 'a' }], summaries, now),
    ).toBe(0);
    expect(await listMergeProposals(fs, key, 'p1')).toHaveLength(1);
  });

  it('resolveMergeProposal "merge" folds + deletes the source; "keepBoth" just dismisses', async () => {
    const fs = memFileSystem();
    await saveInsight(
      fs,
      key,
      insight({
        id: 'a',
        provenance: { conversationId: 'cA', at: '2026-06-10T00:00:00.000Z' },
        facts: [
          { id: 'fa1', text: 'Loves hiking', shareable: false },
          { id: 'fa2', text: 'WRONG', shareable: false, flaggedInaccurate: true },
        ],
      }),
    );
    await saveInsight(
      fs,
      key,
      insight({ id: 'b', facts: [{ id: 'fb1', text: 'Values nature', shareable: false }] }),
    );
    await queueMergeProposals(fs, key, 'p1', [{ from: 'a', into: 'b' }], new Map(), now);
    const [proposal] = await listMergeProposals(fs, key, 'p1');

    await resolveMergeProposal(fs, key, 'p1', proposal!.id, 'merge', now);
    expect(await getInsight(fs, key, 'p1', 'a')).toBeNull(); // source deleted
    const b = await getInsight(fs, key, 'p1', 'b');
    expect(b?.facts.map((f) => f.text)).toContain('Loves hiking'); // folded
    expect(b?.facts.some((f) => f.text === 'WRONG')).toBe(false); // a flagged fact is NEVER carried forward
    expect(b?.contributingSources?.some((p) => p.conversationId === 'cA')).toBe(true); // provenance recorded
    expect(await listMergeProposals(fs, key, 'p1')).toHaveLength(0); // proposal consumed
  });

  it('"keepBoth" dismisses the proposal without touching either insight', async () => {
    const fs = memFileSystem();
    await saveInsight(fs, key, insight({ id: 'a' }));
    await saveInsight(fs, key, insight({ id: 'b' }));
    await queueMergeProposals(fs, key, 'p1', [{ from: 'a', into: 'b' }], new Map(), now);
    const [proposal] = await listMergeProposals(fs, key, 'p1');
    await resolveMergeProposal(fs, key, 'p1', proposal!.id, 'keepBoth', now);
    expect(await getInsight(fs, key, 'p1', 'a')).not.toBeNull();
    expect(await getInsight(fs, key, 'p1', 'b')).not.toBeNull();
    expect(await listMergeProposals(fs, key, 'p1')).toHaveLength(0);
  });

  it('applyMerge is a no-op when an insight is already gone', async () => {
    const fs = memFileSystem();
    await saveInsight(fs, key, insight({ id: 'b' }));
    expect(await applyMerge(fs, key, 'p1', 'missing', 'b', now)).toBe(false);
  });
});

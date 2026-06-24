import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { effectiveGoalStatus, isGoalStale, type Goal, type InsightProvenance } from '../schemas';
import {
  deleteGoal,
  extractGoals,
  getGoal,
  listGoals,
  setGoalStatus,
  summarizeOpenCommitments,
  updateGoal,
} from './goalService';

const key = generateMasterKey();
const prov = (over: Partial<InsightProvenance> = {}): InsightProvenance => ({
  at: '2026-06-20T00:00:00.000Z',
  ...over,
});
const goal = (over: Partial<Goal> & { id: string; text: string }): Goal => ({
  schemaVersion: 1,
  subjectPersonId: 'p1',
  status: 'open',
  provenance: prov(),
  createdAt: '2026-06-20T00:00:00.000Z',
  updatedAt: '2026-06-20T00:00:00.000Z',
  ...over,
});

describe('goalService.extractGoals (39 §4.1/§4.3)', () => {
  const now = new Date('2026-06-20T00:00:00.000Z');

  it('structures producer goals into tracked Goals (status open, provenance, back-ref, life-area)', async () => {
    const fs = memFileSystem();
    const out = await extractGoals({
      fs,
      key,
      personId: 'p1',
      goals: ['finish the report by Friday', 'start running again'],
      provenance: prov({ conversationId: 'c1' }),
      insightId: 'ins1',
      lifeArea: 'Goals & growth',
      now,
    });
    expect(out).toHaveLength(2);
    const stored = await listGoals(fs, key, 'p1');
    expect(stored.map((g) => g.text).sort()).toEqual([
      'finish the report by Friday',
      'start running again',
    ]);
    expect(stored.every((g) => g.status === 'open')).toBe(true);
    expect(stored.every((g) => g.insightId === 'ins1')).toBe(true);
    expect(stored.every((g) => g.lifeArea === 'Goals & growth')).toBe(true);
    expect(stored.every((g) => g.provenance.conversationId === 'c1')).toBe(true);
  });

  it('folds a re-mentioned goal (appends provenance, bumps lastTouchedAt) — never a duplicate', async () => {
    const fs = memFileSystem();
    await extractGoals({
      fs,
      key,
      personId: 'p1',
      goals: ['Run a half marathon'],
      provenance: prov({ conversationId: 'c1', at: '2026-06-20T00:00:00.000Z' }),
      now,
    });
    // A later session mentions the same commitment (different casing/spacing) → folds in.
    const later = new Date('2026-06-25T00:00:00.000Z');
    await extractGoals({
      fs,
      key,
      personId: 'p1',
      goals: ['run a  half   marathon'],
      provenance: prov({ conversationId: 'c2', at: '2026-06-25T00:00:00.000Z' }),
      now: later,
    });
    const stored = await listGoals(fs, key, 'p1');
    expect(stored).toHaveLength(1); // not duplicated
    expect(stored[0]?.contributingSources?.map((s) => s.conversationId)).toEqual(['c2']);
    expect(stored[0]?.lastTouchedAt).toBe('2026-06-25T00:00:00.000Z');
  });

  it('is idempotent on re-analysis — the same origin is not folded twice', async () => {
    const fs = memFileSystem();
    const p = prov({ conversationId: 'c1', at: '2026-06-20T00:00:00.000Z' });
    await extractGoals({ fs, key, personId: 'p1', goals: ['Save more'], provenance: p, now });
    // Re-running the SAME session's analysis must not grow contributingSources.
    await extractGoals({ fs, key, personId: 'p1', goals: ['Save more'], provenance: p, now });
    const stored = await listGoals(fs, key, 'p1');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.contributingSources ?? []).toEqual([]);
  });

  it('does not double-create two identical goals in ONE batch', async () => {
    const fs = memFileSystem();
    await extractGoals({
      fs,
      key,
      personId: 'p1',
      goals: ['meditate daily', 'Meditate Daily'],
      provenance: prov(),
      now,
    });
    expect(await listGoals(fs, key, 'p1')).toHaveLength(1);
  });

  it('does not fold into a CLOSED goal — a re-mention after done creates a fresh one', async () => {
    const fs = memFileSystem();
    await extractGoals({
      fs,
      key,
      personId: 'p1',
      goals: ['quit smoking'],
      provenance: prov(),
      now,
    });
    const [g] = await listGoals(fs, key, 'p1');
    await setGoalStatus(fs, key, 'p1', g!.id, 'done', now);
    await extractGoals({
      fs,
      key,
      personId: 'p1',
      goals: ['quit smoking'],
      provenance: prov(),
      now,
    });
    const stored = await listGoals(fs, key, 'p1');
    expect(stored).toHaveLength(2); // the done one stays; a new open one is created
  });
});

describe('goalService mutations', () => {
  const now = new Date('2026-06-20T00:00:00.000Z');

  it('setGoalStatus updates + bumps lastTouchedAt (un-stales)', async () => {
    const fs = memFileSystem();
    await extractGoals({ fs, key, personId: 'p1', goals: ['x'], provenance: prov(), now });
    const [g] = await listGoals(fs, key, 'p1');
    const updated = await setGoalStatus(
      fs,
      key,
      'p1',
      g!.id,
      'inProgress',
      new Date('2026-07-01T00:00:00.000Z'),
    );
    expect(updated?.status).toBe('inProgress');
    expect(updated?.lastTouchedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('updateGoal edits text/due and CLEARS due/horizon on empty string', async () => {
    const fs = memFileSystem();
    await fsSave(fs, goal({ id: 'g1', text: 'old', due: '2026-08-01', horizon: 'someday' }));
    const edited = await updateGoal(fs, key, 'p1', 'g1', { text: 'new text', due: '' }, now);
    expect(edited?.text).toBe('new text');
    expect('due' in (edited ?? {})).toBe(false); // cleared
    expect(edited?.horizon).toBe('someday'); // untouched (not in patch)
    const cleared = await updateGoal(fs, key, 'p1', 'g1', { horizon: '' }, now);
    expect('horizon' in (cleared ?? {})).toBe(false);
  });

  it('deleteGoal removes the goal', async () => {
    const fs = memFileSystem();
    await fsSave(fs, goal({ id: 'g1', text: 'x' }));
    await deleteGoal(fs, 'p1', 'g1');
    expect(await getGoal(fs, key, 'p1', 'g1')).toBeNull();
  });

  async function fsSave(fs: ReturnType<typeof memFileSystem>, g: Goal): Promise<void> {
    const { saveGoal } = await import('./goalService');
    await saveGoal(fs, key, g);
  }
});

describe('stale derivation (39 §11 Q4 — derived, not persisted)', () => {
  const now = new Date('2026-06-30T00:00:00.000Z');

  it('past `due` → stale', () => {
    expect(isGoalStale(goal({ id: 'g', text: 'x', due: '2026-06-01' }), now)).toBe(true);
    expect(effectiveGoalStatus(goal({ id: 'g', text: 'x', due: '2026-06-01' }), now)).toBe('stale');
  });

  it('future `due` → not stale', () => {
    expect(isGoalStale(goal({ id: 'g', text: 'x', due: '2026-12-01' }), now)).toBe(false);
  });

  it('no due + untouched ≥21 days → stale; recently touched → not', () => {
    const old = goal({ id: 'g', text: 'x', lastTouchedAt: '2026-06-01T00:00:00.000Z' }); // 29 days
    const fresh = goal({ id: 'g', text: 'x', lastTouchedAt: '2026-06-28T00:00:00.000Z' }); // 2 days
    expect(isGoalStale(old, now)).toBe(true);
    expect(isGoalStale(fresh, now)).toBe(false);
  });

  it('a CLOSED goal is never derived stale', () => {
    expect(isGoalStale(goal({ id: 'g', text: 'x', status: 'done', due: '2026-01-01' }), now)).toBe(
      false,
    );
    expect(effectiveGoalStatus(goal({ id: 'g', text: 'x', status: 'abandoned' }), now)).toBe(
      'abandoned',
    );
  });
});

describe('summarizeOpenCommitments (39 §5.2 — bounded coach grounding)', () => {
  const now = new Date('2026-06-30T00:00:00.000Z');

  it('lists ACTIVE goals (skips done/abandoned); empty → ""', async () => {
    const fs = memFileSystem();
    expect(await summarizeOpenCommitments(fs, key, 'p1', now)).toBe('');
    const { saveGoal } = await import('./goalService');
    await saveGoal(fs, key, goal({ id: 'g1', text: 'finish thesis', due: '2026-12-01' }));
    await saveGoal(fs, key, goal({ id: 'g2', text: 'closed one', status: 'done' }));
    const out = await summarizeOpenCommitments(fs, key, 'p1', now);
    expect(out).toContain('finish thesis (due 2026-12-01)');
    expect(out).not.toContain('closed one'); // done goals are not grounding
  });
});

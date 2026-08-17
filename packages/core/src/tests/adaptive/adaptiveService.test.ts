import { describe, expect, it } from 'vitest';

import { memFileSystem } from '../../host/memFileSystem';
import { readLedger } from '../../questionnaires/askLedger';
import { listAllInsights, summarizeForContext } from '../../insights/insightStore';
import { readLexicon, writeLexicon } from './lexicon';
import { DIRTY_TALK } from './instruments/dirtyTalk';
import {
  abandonAdaptiveTake,
  completeAdaptiveTake,
  deleteAdaptiveResult,
  latestCompleteResult,
  listAdaptiveResults,
  getAdaptiveResult,
  openDraft,
  recordBankPass,
  recordNamePass,
  recordSplitPass,
  startAdaptiveTake,
} from './adaptiveService';

const NOW = new Date('2026-08-16T12:00:00.000Z');
const LATER = new Date('2026-11-20T12:00:00.000Z');
const KEY = new Uint8Array(32).fill(9);
const P = 'angel';

const GOOD_GIRL = 'names-praise:good-girl';
const MINE = 'claiming:mine';
const WHORE = 'names-rough-heavy:whore';
const CUNT = 'anatomy-her:cunt';

async function fullTake(fs = memFileSystem(), now = NOW) {
  const draft = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, now);
  await recordBankPass(
    fs,
    KEY,
    DIRTY_TALK,
    {
      personId: P,
      resultId: draft.id,
      marks: { [GOOD_GIRL]: 'love', [MINE]: 'love', [WHORE]: 'never', [CUNT]: 'okay' },
    },
    now,
  );
  await recordSplitPass(
    fs,
    KEY,
    {
      personId: P,
      resultId: draft.id,
      splits: { [GOOD_GIRL]: { hear: 4, say: 0 }, [MINE]: { hear: 4, say: 3 } },
    },
    now,
  );
  const result = await completeAdaptiveTake(
    fs,
    KEY,
    DIRTY_TALK,
    {
      personId: P,
      resultId: draft.id,
      profile: {
        registers: { claiming: 0.9, degradation: 0.1 },
        contexts: { during: { heat: 0.9 }, buildUp: { heat: 0.4, note: 'teasing only' } },
        themes: ['being claimed, not degraded'],
        wantsToSay: [],
        voice: 'low, close, certain. not loud.',
      },
      narrative: 'You want to be claimed, not degraded.',
      costUsd: 0.21,
    },
    now,
  );
  return { fs, draft, result };
}

describe('the adaptive take (74 §5)', () => {
  it('runs the whole deterministic path with no AI: bank → split → a scored, complete result', async () => {
    const { result } = await fullTake();
    expect(result?.status).toBe('complete');
    expect(result?.kind).toBe('adaptive');
    // Scored on the FIXED spine, so a retake compares.
    const byKey = new Map((result?.scores ?? []).map((s) => [s.key, s.normalized]));
    expect(byKey.get('dirtytalk.claiming')).toBeGreaterThan(0.7);
    expect(byKey.get('dirtytalk.degradation')).toBe(0);
    // Loves hearing it, can't say it → the say-confidence gap is real and low.
    expect(byKey.get('dirtytalk.say-confidence')).toBeLessThan(0.5);
  });

  it('persists what was ASKED, not just what came back', async () => {
    const { result } = await fullTake();
    expect(result?.turns?.map((turn) => turn.phase)).toEqual(['bank', 'split']);
    expect(result?.turns?.[0]?.item.text).toMatch(/entries across \d+ families/);
  });

  it('is resumable — a second start returns the SAME draft rather than a second take', async () => {
    const fs = memFileSystem();
    const first = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, NOW);
    const second = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, NOW);
    expect(second.id).toBe(first.id);
    expect((await openDraft(fs, KEY, P, DIRTY_TALK.id))?.id).toBe(first.id);
  });

  it('abandons a draft cleanly — nothing scored, nothing left behind', async () => {
    const fs = memFileSystem();
    const draft = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, NOW);
    await abandonAdaptiveTake(fs, P, draft.id);
    expect(await listAdaptiveResults(fs, KEY, P, DIRTY_TALK.id)).toEqual([]);
  });

  it('writes an Insight that feeds the taker’s own INTIMACY context and nothing else', async () => {
    const { fs } = await fullTake();
    const insights = await listAllInsights(fs, KEY);
    expect(insights).toHaveLength(1);
    const insight = insights[0]!;
    expect(insight.source).toBe('test');
    expect(insight.facts.every((fact) => fact.lifeArea === 'Intimacy')).toBe(true);

    const intimate = await summarizeForContext(fs, KEY, P, [], { lifeAreas: ['Intimacy'] });
    expect(intimate).toContain('good girl');
    // The same profile must NOT surface in a money conversation — the 50 §5.4 relevance gate.
    const money = await summarizeForContext(fs, KEY, P, [], { lifeAreas: ['Money'] });
    expect(money).not.toContain('good girl');
  });

  it('never writes a BOUNDARY into the Insight — suppression is structural, not a prompt line', async () => {
    const { fs } = await fullTake();
    const insight = (await listAllInsights(fs, KEY))[0]!;
    const text = JSON.stringify(insight);
    expect(text).not.toContain('whore');
    // …but the lexicon still carries it, which is what every consumer suppresses on.
    expect((await readLexicon(fs, KEY, P, NOW)).boundaries.map((b) => b.text)).toEqual(['whore']);
  });

  it('carries the hear/say GAP into the Insight as a goal the practice session can run on', async () => {
    const { fs } = await fullTake();
    const insight = (await listAllInsights(fs, KEY))[0]!;
    const goal = insight.facts.find((fact) => fact.id.endsWith(':wants-to-say'));
    expect(goal?.text).toContain('good girl'); // loves hearing it, rated 0 to say
    // The middle mark is a mild yes now, not a goal (74 §3.6.2) — the gap is the whole signal.
    expect(goal?.text).not.toContain('cunt');
  });

  it('marks the ground worked-through so the questionnaire planner stops mining it (74 §5.6)', async () => {
    const { fs, result } = await fullTake();
    const ledger = await readLedger(fs, KEY, P);
    expect(ledger.entries.length).toBeGreaterThanOrEqual(3);
    expect(ledger.entries.every((e) => e.topicIds.includes('Intimacy:dirty-talk'))).toBe(true);
    expect(ledger.entries.every((e) => e.outcome === 'rich')).toBe(true);
    // Idempotent: completing the same take again must not double-count the ground.
    await completeAdaptiveTake(fs, KEY, DIRTY_TALK, { personId: P, resultId: result!.id }, NOW);
    expect((await readLedger(fs, KEY, P)).entries).toHaveLength(ledger.entries.length);
  });

  it('a retake keeps the prior result, adds a trend point, and UPDATES the one Insight', async () => {
    const { fs, result } = await fullTake();
    const second = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, LATER);
    expect(second.reTakeOf).toBe(result!.id);
    expect(second.insightId).toBe(result!.insightId);
    await completeAdaptiveTake(fs, KEY, DIRTY_TALK, { personId: P, resultId: second.id }, LATER);
    expect(await listAdaptiveResults(fs, KEY, P, DIRTY_TALK.id)).toHaveLength(2);
    expect(await listAllInsights(fs, KEY)).toHaveLength(1);
    expect((await latestCompleteResult(fs, KEY, P, DIRTY_TALK.id))?.id).toBe(second.id);
  });

  it('a retake NEVER re-offers a hard no', async () => {
    const { fs } = await fullTake();
    const second = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, LATER);
    // Even if the UI somehow marked it loved on the retake, the boundary holds.
    const lexicon = await recordBankPass(
      fs,
      KEY,
      DIRTY_TALK,
      { personId: P, resultId: second.id, marks: { [WHORE]: 'love' } },
      LATER,
    );
    expect(lexicon.entries.find((e) => e.key === WHORE)?.state).toBe('never');
  });

  // --- 74 §3.4 — autosaving the passes ---

  it('an AUTOSAVE persists the marks but does not stamp a turn (or a pass costs ~1,100 of them)', async () => {
    const fs = memFileSystem();
    const draft = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, NOW);
    const lexicon = await recordBankPass(
      fs,
      KEY,
      DIRTY_TALK,
      { personId: P, resultId: draft.id, marks: { [GOOD_GIRL]: 'love' }, autosave: true },
      NOW,
    );
    // Written — that is the whole point: closing the app here loses nothing.
    expect(lexicon.entries.find((e) => e.key === GOOD_GIRL)?.hear).toBeGreaterThan(0);
    expect((await openDraft(fs, KEY, P, DIRTY_TALK.id))?.turns ?? []).toHaveLength(0);

    // Closing the pass is what records that it happened.
    await recordBankPass(
      fs,
      KEY,
      DIRTY_TALK,
      { personId: P, resultId: draft.id, marks: { [GOOD_GIRL]: 'love' } },
      NOW,
    );
    expect((await openDraft(fs, KEY, P, DIRTY_TALK.id))?.turns ?? []).toHaveLength(1);
  });

  it('un-marking a mis-tapped ✗ takes the boundary back — autosave must not make it permanent', async () => {
    const fs = memFileSystem();
    const draft = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, NOW);
    const marked = await recordBankPass(
      fs,
      KEY,
      DIRTY_TALK,
      { personId: P, resultId: draft.id, marks: { [CUNT]: 'never' }, autosave: true },
      NOW,
    );
    expect(marked.boundaries.some((b) => b.text.includes('cunt'))).toBe(true);

    const undone = await recordBankPass(
      fs,
      KEY,
      DIRTY_TALK,
      { personId: P, resultId: draft.id, marks: {}, cleared: [CUNT], autosave: true },
      NOW,
    );
    expect(undone.boundaries.some((b) => b.text.includes('cunt'))).toBe(false);
    expect(undone.entries.find((e) => e.key === CUNT)?.state).toBeUndefined();
  });

  it('CANNOT clear a boundary from an EARLIER take, however the un-mark is crafted (74 §3.2)', async () => {
    // The renderer is not the trust boundary: a `cleared` key it should never send must still bounce.
    const { fs } = await fullTake(); // sets `whore` → never, in take #1
    const second = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, LATER);
    const lexicon = await recordBankPass(
      fs,
      KEY,
      DIRTY_TALK,
      { personId: P, resultId: second.id, marks: {}, cleared: [WHORE], autosave: true },
      LATER,
    );
    expect(lexicon.entries.find((e) => e.key === WHORE)?.state).toBe('never');
    expect(lexicon.boundaries.map((b) => b.text)).toContain('whore');
  });

  it('refuses an un-mark aimed at a COMPLETED take, even with a matching source', async () => {
    // Result ids reach the renderer in `adaptiveState().history`, so "pass the old id" is a reachable string.
    const { fs, result } = await fullTake();
    await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, LATER);
    const lexicon = await recordBankPass(
      fs,
      KEY,
      DIRTY_TALK,
      { personId: P, resultId: result!.id, marks: {}, cleared: [WHORE], autosave: true },
      LATER,
    );
    expect(lexicon.entries.find((e) => e.key === WHORE)?.state).toBe('never');
    expect(lexicon.boundaries.map((b) => b.text)).toContain('whore');
  });

  it('closing the bank pass does NOT reset a split rating back to the love seed', async () => {
    // Re-sending the whole pass is what closing does; quitting between the two passes is now encouraged, so
    // a clobber here would silently flatten a real hear/say gap.
    const fs = memFileSystem();
    const draft = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, NOW);
    await recordBankPass(
      fs,
      KEY,
      DIRTY_TALK,
      { personId: P, resultId: draft.id, marks: { [GOOD_GIRL]: 'love' }, autosave: true },
      NOW,
    );
    await recordSplitPass(
      fs,
      KEY,
      { personId: P, resultId: draft.id, splits: { [GOOD_GIRL]: { hear: 4, say: 1 } } },
      NOW,
    );
    const closed = await recordBankPass(
      fs,
      KEY,
      DIRTY_TALK,
      { personId: P, resultId: draft.id, marks: { [GOOD_GIRL]: 'love' } },
      NOW,
    );
    const entry = closed.entries.find((e) => e.key === GOOD_GIRL);
    expect(entry?.hear).toBe(4);
    expect(entry?.say).toBe(1);
  });

  it('un-marking a 🔥 clears the ratings it seeded, not just the state', async () => {
    const fs = memFileSystem();
    const draft = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, NOW);
    await recordBankPass(
      fs,
      KEY,
      DIRTY_TALK,
      { personId: P, resultId: draft.id, marks: { [MINE]: 'love' }, autosave: true },
      NOW,
    );
    const undone = await recordBankPass(
      fs,
      KEY,
      DIRTY_TALK,
      { personId: P, resultId: draft.id, marks: {}, cleared: [MINE], autosave: true },
      NOW,
    );
    const entry = undone.entries.find((e) => e.key === MINE);
    expect(entry?.hear).toBe(0);
    expect(entry?.say).toBe(0);
  });

  it('deleting the last take removes the Insight; deleting one of two re-derives it', async () => {
    const { fs, result } = await fullTake();
    const second = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, LATER);
    await completeAdaptiveTake(fs, KEY, DIRTY_TALK, { personId: P, resultId: second.id }, LATER);

    await deleteAdaptiveResult(fs, KEY, DIRTY_TALK, P, second.id, LATER);
    expect(await listAllInsights(fs, KEY)).toHaveLength(1); // re-derived from the survivor
    await deleteAdaptiveResult(fs, KEY, DIRTY_TALK, P, result!.id, LATER);
    expect(await listAllInsights(fs, KEY)).toHaveLength(0);
  });

  it('completes honestly with NO AI phases at all — a thinner profile, not a failed take', async () => {
    const fs = memFileSystem();
    const draft = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, NOW);
    await recordBankPass(
      fs,
      KEY,
      DIRTY_TALK,
      { personId: P, resultId: draft.id, marks: { [MINE]: 'love' } },
      NOW,
    );
    const result = await completeAdaptiveTake(
      fs,
      KEY,
      DIRTY_TALK,
      { personId: P, resultId: draft.id },
      NOW,
    );
    expect(result?.status).toBe('complete');
    expect(result?.narrative).toBeUndefined();
    expect(result?.scores.length).toBe(DIRTY_TALK.spine.length);
    expect(await listAllInsights(fs, KEY)).toHaveLength(1);
  });
});

describe('74 §3.6.8 — start over from the top', () => {
  it('clears EVERYTHING for that person, hard nos included', async () => {
    const fs = memFileSystem();
    const key = new Uint8Array(32).fill(7);
    const draft = await startAdaptiveTake(fs, key, DIRTY_TALK, 'p1', new Date());
    await recordBankPass(
      fs,
      key,
      DIRTY_TALK,
      {
        personId: 'p1',
        resultId: draft.id,
        marks: { 'names-praise:good-girl': 'love', 'names-rough-heavy:whore': 'never' },
      },
      NOW,
    );
    const before = await readLexicon(fs, key, 'p1');
    expect(before?.entries.length).toBeGreaterThan(0);
    expect(before?.boundaries.map((b) => b.text)).toContain('whore');

    await abandonAdaptiveTake(fs, 'p1', draft.id, key);

    const after = await readLexicon(fs, key, 'p1');
    // The deck comes back genuinely blank — the whole point of the owner's correction. A `never` left behind
    // would render as a settled "off the table" row, which is the state they are trying to leave.
    expect(after?.entries).toEqual([]);
    expect(after?.boundaries).toEqual([]);
    expect(after?.wantsToSay).toEqual([]);
    // …and the take record is gone with it.
    expect(await openDraft(fs, key, 'p1', DIRTY_TALK.id)).toBeNull();
  });

  it('keeps who the two of you are — start over is not "answer the setup again"', async () => {
    const fs = memFileSystem();
    const key = new Uint8Array(32).fill(7);
    const draft = await startAdaptiveTake(fs, key, DIRTY_TALK, 'p1', new Date());
    await recordBankPass(
      fs,
      key,
      DIRTY_TALK,
      {
        personId: 'p1',
        resultId: draft.id,
        marks: { 'names-praise:good-girl': 'love' },
      },
      NOW,
    );
    const seeded = await readLexicon(fs, key, 'p1');
    await writeLexicon(fs, key, {
      ...seeded!,
      address: { self: 'man', partner: 'girl' },
      identity: { self: 'man', partner: 'woman' },
    });

    await abandonAdaptiveTake(fs, 'p1', draft.id, key);

    const after = await readLexicon(fs, key, 'p1');
    expect(after?.address).toEqual({ self: 'man', partner: 'girl' });
    expect(after?.identity).toEqual({ self: 'man', partner: 'woman' });
  });
});

describe('74 §3.6.8 — recording the pet-name phase', () => {
  it('marks a name both ways, autosaves, and takes one direction back', async () => {
    const fs = memFileSystem();
    const key = new Uint8Array(32).fill(9);
    const draft = await startAdaptiveTake(fs, key, DIRTY_TALK, 'p1', NOW);
    const KEY = 'names-praise:good-girl';

    await recordNamePass(
      fs,
      key,
      DIRTY_TALK,
      {
        personId: 'p1',
        resultId: draft.id,
        marks: { [KEY]: { hear: 'never', say: 'love' } },
        autosave: true,
      },
      NOW,
    );
    const lex = await readLexicon(fs, key, 'p1');
    expect(lex?.entries.find((e) => e.key === KEY)).toMatchObject({
      hearState: 'never',
      sayState: 'love',
    });
    // The boundary it wrote is one-way, so his own coach can still put it in his mouth.
    expect(lex?.boundaries).toEqual([
      expect.objectContaining({ text: 'good girl', direction: 'hear' }),
    ]);
    // An autosave leaves no turn — 2,000 names would otherwise write 2,000 of them.
    const afterAutosave = await getAdaptiveResult(fs, key, 'p1', draft.id);
    expect(afterAutosave?.turns ?? []).toHaveLength(0);

    await recordNamePass(
      fs,
      key,
      DIRTY_TALK,
      { personId: 'p1', resultId: draft.id, marks: {}, cleared: { [KEY]: ['hear'] } },
      NOW,
    );
    const cleared = await readLexicon(fs, key, 'p1');
    expect(cleared?.entries.find((e) => e.key === KEY)?.hearState).toBeUndefined();
    expect(cleared?.entries.find((e) => e.key === KEY)?.sayState).toBe('love');
    expect(cleared?.boundaries).toEqual([]);
    // …and closing the pass stamps exactly one turn.
    const closed = await getAdaptiveResult(fs, key, 'p1', draft.id);
    expect(closed?.turns).toHaveLength(1);
  });

  it('refuses an un-mark aimed at a take that is no longer open', async () => {
    const fs = memFileSystem();
    const key = new Uint8Array(32).fill(9);
    const draft = await startAdaptiveTake(fs, key, DIRTY_TALK, 'p1', NOW);
    const KEY = 'names-rough-heavy:whore';
    await recordNamePass(
      fs,
      key,
      DIRTY_TALK,
      { personId: 'p1', resultId: draft.id, marks: { [KEY]: { hear: 'never' } }, autosave: true },
      NOW,
    );
    // A result id the renderer legitimately holds, for a take that is not the open draft.
    await recordNamePass(
      fs,
      key,
      DIRTY_TALK,
      { personId: 'p1', resultId: 'some-other-take', marks: {}, cleared: { [KEY]: ['hear'] } },
      NOW,
    );
    const lex = await readLexicon(fs, key, 'p1');
    expect(lex?.entries.find((e) => e.key === KEY)?.hearState).toBe('never');
    expect(lex?.boundaries).toHaveLength(1);
  });
});

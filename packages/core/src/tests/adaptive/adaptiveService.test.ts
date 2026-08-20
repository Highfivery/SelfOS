import { describe, expect, it } from 'vitest';

import { memFileSystem } from '../../host/memFileSystem';
import { probeTurnId, ambiguityOfProbeTurn } from '../../schemas';
import { readLedger } from '../../questionnaires/askLedger';
import { listAllInsights, summarizeForContext } from '../../insights/insightStore';
import { readLexicon, writeLexicon, suppressedTexts, violatesBoundary } from './lexicon';
import { DIRTY_TALK } from './instruments/dirtyTalk';
import {
  abandonAdaptiveTake,
  completeAdaptiveTake,
  deleteAllAdaptiveResults,
  deleteAdaptiveResult,
  latestCompleteResult,
  listAdaptiveResults,
  getAdaptiveResult,
  openDraft,
  recordMarkingPass,
  stampTurn,
  startAdaptiveTake,
} from './adaptiveService';

const NOW = new Date('2026-08-16T12:00:00.000Z');
const LATER = new Date('2026-11-20T12:00:00.000Z');
const KEY = new Uint8Array(32).fill(9);
const P = 'angel';

const GOOD_GIRL = 'names-praise:good-girl';
const MINE = 'claiming:you-re-mine';
const WHORE = 'names-rough-heavy:manwhore';
const CUNT = 'anatomy-her:cunt';

async function fullTake(fs = memFileSystem(), now = NOW) {
  const draft = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, now);
  await recordMarkingPass(
    fs,
    KEY,
    DIRTY_TALK,
    {
      phase: 'bank',
      personId: P,
      resultId: draft.id,
      marks: {
        // `good girl` is the hear/say GAP case: loved to hear, only okay to say (74 §3.6.26).
        [GOOD_GIRL]: { hear: 'love', say: 'okay' },
        [MINE]: { hear: 'love', say: 'okay' },
        [WHORE]: { hear: 'never', say: 'never' },
        [CUNT]: { hear: 'okay', say: 'okay' },
      },
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
  it('runs the whole deterministic path with no AI: marks → a scored, complete result', async () => {
    const { result } = await fullTake();
    expect(result?.status).toBe('complete');
    expect(result?.kind).toBe('adaptive');
    // Scored on the FIXED spine, so a retake compares.
    const byKey = new Map((result?.scores ?? []).map((s) => [s.key, s.normalized]));
    expect(byKey.get('dirtytalk.claiming')).toBeGreaterThan(0.7);
    expect(byKey.get('dirtytalk.degradation')).toBe(0);
    /*
     * Loves hearing it, only okay saying it → the gap shows, at exactly the half-way mark.
     *
     * It used to assert `< 0.5`, which the 0–4 split could reach (a say of 1 scored 0.25). Three marks
     * (74 §3.6.26) score a non-boundary say as 1.0 or 0.5, so 0.5 IS the floor for something they have not
     * ruled out — anything lower is a `never`, which suppresses the word rather than scoring it low. Pinned
     * at the real number so the narrowing is a recorded decision rather than a surprise.
     */
    expect(byKey.get('dirtytalk.say-confidence')).toBe(0.5);
  });

  it('persists what was ASKED, not just what came back', async () => {
    const { result } = await fullTake();
    // One marking turn, not two: the deck's separate split pass is gone (74 §3.6.26).
    expect(result?.turns?.map((turn) => turn.phase)).toEqual(['bank']);
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
    expect(text).not.toContain('manwhore');
    // …but the lexicon still suppresses it, which is what every consumer reads.
    expect(suppressedTexts(await readLexicon(fs, KEY, P, NOW))).toEqual(['manwhore']);
  });

  it('carries the hear/say GAP into the Insight as a goal the practice session can run on', async () => {
    const { fs } = await fullTake();
    const insight = (await listAllInsights(fs, KEY))[0]!;
    const goal = insight.facts.find((fact) => fact.id.endsWith(':wants-to-say'));
    expect(goal?.text).toContain('good girl'); // loves hearing it, only okay to say
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

  it('a retake CAN change a no — it is a preference, and the suppression follows it', async () => {
    const { fs } = await fullTake();
    const second = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, LATER);
    const lexicon = await recordMarkingPass(
      fs,
      KEY,
      DIRTY_TALK,
      {
        phase: 'bank',
        personId: P,
        resultId: second.id,
        marks: { [WHORE]: { hear: 'love', say: 'love' } },
      },
      LATER,
    );
    expect(lexicon.entries.find((e) => e.key === WHORE)?.hearState).toBe('love');
    expect(suppressedTexts(lexicon)).not.toContain('manwhore');
  });

  // --- 74 §3.4 — autosaving the passes ---

  it('an AUTOSAVE persists the marks but does not stamp a turn (or a pass costs ~1,100 of them)', async () => {
    const fs = memFileSystem();
    const draft = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, NOW);
    const lexicon = await recordMarkingPass(
      fs,
      KEY,
      DIRTY_TALK,
      {
        phase: 'bank',
        personId: P,
        resultId: draft.id,
        marks: { [GOOD_GIRL]: { hear: 'love', say: 'love' } },
        autosave: true,
      },
      NOW,
    );
    // Written — that is the whole point: closing the app here loses nothing.
    expect(lexicon.entries.find((e) => e.key === GOOD_GIRL)?.hear).toBeGreaterThan(0);
    expect((await openDraft(fs, KEY, P, DIRTY_TALK.id))?.turns ?? []).toHaveLength(0);

    // Closing the pass is what records that it happened.
    await recordMarkingPass(
      fs,
      KEY,
      DIRTY_TALK,
      {
        phase: 'bank',
        personId: P,
        resultId: draft.id,
        marks: { [GOOD_GIRL]: { hear: 'love', say: 'love' } },
      },
      NOW,
    );
    expect((await openDraft(fs, KEY, P, DIRTY_TALK.id))?.turns ?? []).toHaveLength(1);
  });

  it('un-marking a mis-tapped ✗ takes the boundary back — autosave must not make it permanent', async () => {
    const fs = memFileSystem();
    const draft = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, NOW);
    const marked = await recordMarkingPass(
      fs,
      KEY,
      DIRTY_TALK,
      {
        phase: 'bank',
        personId: P,
        resultId: draft.id,
        marks: { [CUNT]: { hear: 'never', say: 'never' } },
        autosave: true,
      },
      NOW,
    );
    expect(suppressedTexts(marked).some((t) => t.includes('cunt'))).toBe(true);

    const undone = await recordMarkingPass(
      fs,
      KEY,
      DIRTY_TALK,
      {
        phase: 'bank',
        personId: P,
        resultId: draft.id,
        marks: {},
        cleared: { [CUNT]: ['hear', 'say'] },
        autosave: true,
      },
      NOW,
    );
    expect(suppressedTexts(undone).some((t) => t.includes('cunt'))).toBe(false);
    expect(undone.entries.find((e) => e.key === CUNT)?.hearState).toBeUndefined();
  });

  it('takes back an EARLIER take’s mark from the open one — changing your mind is not take-scoped', () => {
    return (async () => {
      const { fs } = await fullTake(); // sets `manwhore` → never, in take #1
      const second = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, LATER);
      const lexicon = await recordMarkingPass(
        fs,
        KEY,
        DIRTY_TALK,
        {
          phase: 'bank',
          personId: P,
          resultId: second.id,
          marks: {},
          cleared: { [WHORE]: ['hear', 'say'] },
          autosave: true,
        },
        LATER,
      );
      expect(lexicon.entries.find((e) => e.key === WHORE)?.hearState).toBeUndefined();
      expect(suppressedTexts(lexicon)).not.toContain('manwhore');
    })();
  });

  it('refuses an un-mark aimed at a COMPLETED take, even with a matching source', async () => {
    // Result ids reach the renderer in `adaptiveState().history`, so "pass the old id" is a reachable string.
    const { fs, result } = await fullTake();
    await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, LATER);
    const lexicon = await recordMarkingPass(
      fs,
      KEY,
      DIRTY_TALK,
      {
        phase: 'bank',
        personId: P,
        resultId: result!.id,
        marks: {},
        cleared: { [WHORE]: ['hear', 'say'] },
        autosave: true,
      },
      LATER,
    );
    expect(lexicon.entries.find((e) => e.key === WHORE)?.hearState).toBe('never');
    expect(suppressedTexts(lexicon)).toContain('manwhore');
  });

  it('un-marking a 🔥 clears the ratings it seeded, not just the state', async () => {
    const fs = memFileSystem();
    const draft = await startAdaptiveTake(fs, KEY, DIRTY_TALK, P, NOW);
    await recordMarkingPass(
      fs,
      KEY,
      DIRTY_TALK,
      {
        phase: 'bank',
        personId: P,
        resultId: draft.id,
        marks: { [MINE]: { hear: 'love', say: 'love' } },
        autosave: true,
      },
      NOW,
    );
    const undone = await recordMarkingPass(
      fs,
      KEY,
      DIRTY_TALK,
      {
        phase: 'bank',
        personId: P,
        resultId: draft.id,
        marks: {},
        cleared: { [MINE]: ['hear', 'say'] },
        autosave: true,
      },
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
    await recordMarkingPass(
      fs,
      KEY,
      DIRTY_TALK,
      {
        phase: 'bank',
        personId: P,
        resultId: draft.id,
        marks: { [MINE]: { hear: 'love', say: 'love' } },
      },
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
  it('DELETE IS DELETE — removing every take takes the hard nos with it (74 §3.6.11)', async () => {
    // It used to keep `never` entries, which was right while a no was permanent. A preference that survives
    // the delete button is one the person cannot get rid of, so the carve-out is gone.
    const fs = memFileSystem();
    const key = new Uint8Array(32).fill(5);
    const draft = await startAdaptiveTake(fs, key, DIRTY_TALK, 'p1', NOW);
    await recordMarkingPass(
      fs,
      key,
      DIRTY_TALK,
      {
        phase: 'bank',
        personId: 'p1',
        resultId: draft.id,
        marks: {
          'names-praise:good-girl': { hear: 'love', say: 'love' },
          'names-rough-heavy:manwhore': { hear: 'never', say: 'never' },
        },
      },
      NOW,
    );
    await completeAdaptiveTake(fs, key, DIRTY_TALK, { personId: 'p1', resultId: draft.id }, LATER);
    const before = await readLexicon(fs, key, 'p1', LATER);
    expect(suppressedTexts(before)).toContain('manwhore');

    await deleteAllAdaptiveResults(fs, key, DIRTY_TALK, 'p1', LATER);

    const after = await readLexicon(fs, key, 'p1', LATER);
    expect(after.entries).toEqual([]);
    expect(after.boundaries).toEqual([]);
    // The whole point: nothing is still being suppressed on behalf of a test that no longer exists.
    expect(suppressedTexts(after)).toEqual([]);
    expect(await listAdaptiveResults(fs, key, 'p1', DIRTY_TALK.id)).toEqual([]);
  });

  it('leaves ANOTHER instrument’s entries alone — the lexicon is shared', async () => {
    const fs = memFileSystem();
    const key = new Uint8Array(32).fill(5);
    const draft = await startAdaptiveTake(fs, key, DIRTY_TALK, 'p1', NOW);
    await recordMarkingPass(
      fs,
      key,
      DIRTY_TALK,
      {
        phase: 'bank',
        personId: 'p1',
        resultId: draft.id,
        marks: { 'names-rough-heavy:manwhore': { hear: 'never', say: 'never' } },
      },
      NOW,
    );
    // A row some other adaptive instrument wrote: same lexicon, a source this delete does not own.
    const mine = await readLexicon(fs, key, 'p1', NOW);
    await writeLexicon(fs, key, {
      ...mine,
      entries: [
        ...mine.entries,
        {
          ...mine.entries[0]!,
          key: 'other:thing',
          text: 'from another test',
          source: 'test:other',
        },
      ],
    });

    await deleteAllAdaptiveResults(fs, key, DIRTY_TALK, 'p1', LATER);

    const after = await readLexicon(fs, key, 'p1', LATER);
    expect(after.entries.map((e) => e.key)).toEqual(['other:thing']);
  });

  it('clears EVERYTHING for that person, hard nos included', async () => {
    const fs = memFileSystem();
    const key = new Uint8Array(32).fill(7);
    const draft = await startAdaptiveTake(fs, key, DIRTY_TALK, 'p1', new Date());
    await recordMarkingPass(
      fs,
      key,
      DIRTY_TALK,
      {
        phase: 'bank',
        personId: 'p1',
        resultId: draft.id,
        marks: {
          'names-praise:good-girl': { hear: 'love', say: 'love' },
          'names-rough-heavy:manwhore': { hear: 'never', say: 'never' },
        },
      },
      NOW,
    );
    const before = await readLexicon(fs, key, 'p1');
    expect(before?.entries.length).toBeGreaterThan(0);
    expect(suppressedTexts(before)).toContain('manwhore');

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
    await recordMarkingPass(
      fs,
      key,
      DIRTY_TALK,
      {
        phase: 'bank',
        personId: 'p1',
        resultId: draft.id,
        marks: { 'names-praise:good-girl': { hear: 'love', say: 'love' } },
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

    await recordMarkingPass(
      fs,
      key,
      DIRTY_TALK,
      {
        phase: 'names',
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
    // The suppression is one-way, so his own coach can still put it in his mouth.
    expect(violatesBoundary(lex, 'that\u2019s my good girl', 'hear')).toBe(true);
    expect(violatesBoundary(lex, 'that\u2019s my good girl', 'say')).toBe(false);
    // An autosave leaves no turn — 2,000 names would otherwise write 2,000 of them.
    const afterAutosave = await getAdaptiveResult(fs, key, 'p1', draft.id);
    expect(afterAutosave?.turns ?? []).toHaveLength(0);

    await recordMarkingPass(
      fs,
      key,
      DIRTY_TALK,
      {
        phase: 'names',
        personId: 'p1',
        resultId: draft.id,
        marks: {},
        cleared: { [KEY]: ['hear'] },
      },
      NOW,
    );
    const cleared = await readLexicon(fs, key, 'p1');
    expect(cleared?.entries.find((e) => e.key === KEY)?.hearState).toBeUndefined();
    expect(cleared?.entries.find((e) => e.key === KEY)?.sayState).toBe('love');
    expect(violatesBoundary(cleared, 'that\u2019s my good girl', 'hear')).toBe(false);
    // …and closing the pass stamps exactly one turn.
    const closed = await getAdaptiveResult(fs, key, 'p1', draft.id);
    expect(closed?.turns).toHaveLength(1);
  });

  it('refuses an un-mark aimed at a take that is no longer open', async () => {
    const fs = memFileSystem();
    const key = new Uint8Array(32).fill(9);
    const draft = await startAdaptiveTake(fs, key, DIRTY_TALK, 'p1', NOW);
    const KEY = 'names-rough-heavy:manwhore';
    await recordMarkingPass(
      fs,
      key,
      DIRTY_TALK,
      {
        phase: 'names',
        personId: 'p1',
        resultId: draft.id,
        marks: { [KEY]: { hear: 'never' } },
        autosave: true,
      },
      NOW,
    );
    // A result id the renderer legitimately holds, for a take that is not the open draft.
    await recordMarkingPass(
      fs,
      key,
      DIRTY_TALK,
      {
        phase: 'names',
        personId: 'p1',
        resultId: 'some-other-take',
        marks: {},
        cleared: { [KEY]: ['hear'] },
      },
      NOW,
    );
    const lex = await readLexicon(fs, key, 'p1');
    expect(lex?.entries.find((e) => e.key === KEY)?.hearState).toBe('never');
    // The draft guard is what bounced it: `resultId` was not the open take. Changing your mind is free,
    // but only through the take you actually have open.
    expect(violatesBoundary(lex, 'take it, manwhore', 'hear')).toBe(true);
  });
});

describe('a retake keeps what you told it (74 §3.6.16)', () => {
  it("carries the prior take's answers into the new draft, and an edit replaces rather than duplicates", async () => {
    const fs = memFileSystem();
    const key = new Uint8Array(32).fill(9);
    const now = new Date('2026-08-18T00:00:00.000Z');

    const first = await startAdaptiveTake(fs, key, DIRTY_TALK, 'p1', now);
    await stampTurn(fs, key, 'p1', first.id, {
      phase: 'probe',
      item: { id: 'a1', pack: 'probe', text: 'What lands?', options: [] },
      answer: 'the first answer',
      at: now.toISOString(),
    });
    // Editing an answer REPLACES it. Appending made a changed answer a duplicate — both reached the
    // synthesis, and the ask ledger counted the item twice.
    await stampTurn(fs, key, 'p1', first.id, {
      phase: 'probe',
      item: { id: 'a1', pack: 'probe', text: 'What lands?', options: [] },
      answer: 'the edited answer',
      at: now.toISOString(),
    });
    const edited = await getAdaptiveResult(fs, key, 'p1', first.id);
    expect(edited?.turns).toHaveLength(1);
    expect(edited?.turns?.[0]?.answer).toBe('the edited answer');

    await completeAdaptiveTake(fs, key, DIRTY_TALK, { personId: 'p1', resultId: first.id }, now);
    const retake = await startAdaptiveTake(fs, key, DIRTY_TALK, 'p1', now);

    // A retake used to start with `turns: []`, so every line reaction, question answer and moment pick from
    // last time vanished — while the MARKS survived, because those live in the lexicon. "Keep what you
    // marked" means keep what they told us too; there was also nothing left to review or edit.
    expect(retake.id).not.toBe(first.id);
    expect(retake.turns).toHaveLength(1);
    expect(retake.turns?.[0]?.answer).toBe('the edited answer');
  });

  /*
   * The one that mattered most, and the one nothing was watching.
   *
   * `stampTurn` replaces on `(phase, item.id)` — correct, and what makes an answer editable. The probe then
   * stamped every question of a pass under the bare AMBIGUITY id, so answering the second question silently
   * destroyed the answer to the first. Six answers typed, one on disk; the review screen showed a single card
   * because that was all there was, and the synthesis was fed a sixth of the richest input in the take.
   *
   * No fixture ever ran a multi-question pass, so a green suite said nothing about it.
   */
  it('keeps every answer in one probe pass — a turn per QUESTION, not per ambiguity (74 §3.6.17)', async () => {
    const fs = memFileSystem();
    const key = new Uint8Array(32).fill(4);
    const now = new Date('2026-08-18T00:00:00.000Z');
    const draft = await startAdaptiveTake(fs, key, DIRTY_TALK, 'p1', now);

    const ambiguity = 'split:praise';
    const pass = [
      'Does "my good girl" hit different from "good girl"?',
      'Being told what to do — an order, or a request?',
      'What kills it fastest mid-way through?',
    ];
    for (const [i, question] of pass.entries()) {
      await stampTurn(fs, key, 'p1', draft.id, {
        phase: 'probe',
        item: {
          id: probeTurnId(ambiguity, question),
          pack: 'probe',
          text: question,
          options: ['a', 'b'],
        },
        answer: `answer ${i}`,
        at: now.toISOString(),
      });
    }

    const after = await getAdaptiveResult(fs, key, 'p1', draft.id);
    expect(after?.turns).toHaveLength(3);
    expect(after?.turns?.map((t) => t.answer)).toEqual(['answer 0', 'answer 1', 'answer 2']);
    // The options travel with the turn, so an answered question can be re-opened and re-picked.
    expect(after?.turns?.[0]?.item.options).toEqual(['a', 'b']);
    // …and every one of them still resolves to the ambiguity the bridge asks about, or the same ambiguity
    // would be served forever and the step could never finish.
    expect(new Set(after?.turns?.map((t) => ambiguityOfProbeTurn(t.item.id)))).toEqual(
      new Set([ambiguity]),
    );

    // Re-answering ONE of them still replaces in place rather than appending a duplicate.
    await stampTurn(fs, key, 'p1', draft.id, {
      phase: 'probe',
      item: { id: probeTurnId(ambiguity, pass[1]!), pack: 'probe', text: pass[1]!, options: [] },
      answer: 'changed my mind',
      at: now.toISOString(),
    });
    const revised = await getAdaptiveResult(fs, key, 'p1', draft.id);
    expect(revised?.turns).toHaveLength(3);
    expect(revised?.turns?.find((t) => t.item.text === pass[1])?.answer).toBe('changed my mind');
  });
});

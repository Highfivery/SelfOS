import { describe, expect, it } from 'vitest';

import type { EroticLexicon, LexiconEntry } from '../../schemas';
import { DIRTY_TALK } from './instruments/dirtyTalk';

import type { ClaudeClient } from '../../host';
import { memFileSystem } from '../../host/memFileSystem';
import type { AiDeps } from '../../questionnaires/aiCall';
import {
  applyDirectionalMarks,
  emptyLexicon,
  writeLexicon,
  addBoundary,
  type BankMark,
  type DirectionalMark,
} from './lexicon';
import {
  lexiconDigest,
  openAmbiguities,
  openEndedAmbiguity,
  runLinesPhase,
  runProbePhase,
  runScenarioPhase,
  runSynthesis,
} from './engine';

const NOW = new Date('2026-08-16T12:00:00.000Z');
const KEY = new Uint8Array(32).fill(3);

function fakeClient(responses: string[]): {
  client: ClaudeClient;
  prompts: { system: string; user: string }[];
} {
  const prompts: { system: string; user: string }[] = [];
  let i = 0;
  return {
    prompts,
    client: {
      send: () => Promise.resolve(''),
      stream: (o, onDelta) => {
        prompts.push({
          system: o.system ?? '',
          user: o.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n'),
        });
        const text = responses[Math.min(i, responses.length - 1)] ?? '';
        i += 1;
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    },
  };
}

function deps(client: ClaudeClient): AiDeps {
  return {
    fs: memFileSystem(),
    key: KEY,
    client,
    apiKey: 'sk-test',
    model: 'claude-sonnet-4-6',
    personId: 'angel',
    now: NOW,
  };
}

/** The same mark both ways — what a whole-entry mark used to mean before §3.6.26. */
const both = (mark: BankMark): DirectionalMark => ({ hear: mark, say: mark });

function seeded() {
  return applyDirectionalMarks(
    emptyLexicon('angel', NOW),
    DIRTY_TALK.bank,
    {
      // Loves hearing it, saying it is merely okay — the hear/say gap (§3.6.26).
      'names-praise:good-girl': { hear: 'love', say: 'okay' },
      'names-rough-heavy:manwhore': both('never'),
      'names-rough-heavy:anal-slut': both('love'),
      'anatomy-her:cunt': both('okay'),
    },
    'take:1',
    NOW,
  );
}

describe('the adaptive engine (74 §5.1/§5.3)', () => {
  it('derives its ambiguities from the DATA, so the loop terminates on facts not on model confidence', () => {
    const ambiguities = openAmbiguities(seeded());
    const ids = ambiguities.map((a) => a.id);
    // The family split is drawn against the MIDDLE mark now, never a hard no (74 §3.6.15). Loved `slut` +
    // ruled out `manwhore` no longer produces one: a hard no is settled, and a question that names it both asks
    // them to justify a boundary and is then rejected for containing it.
    expect(ids).not.toContain('split:names-rough-heavy');
    // Loves hearing "good girl", only okay saying it → preference or goal?
    expect(ids).toContain('frozen');
    /*
     * 74 §3.6.34 — ONE ambiguity per signal.
     *
     * This used to also assert `cringe`, which was `lexicon.entries.filter(hasSayGap)` — byte-identical to
     * `frozen`, taking the same `[0]`. Pinning both pinned the duplicate: the probe consumes one ambiguity
     * per pass and keys `asked` on the id, so a second billed round re-asked about the identical word, and
     * `ambiguitiesLeft` reported one open gap as two. Its wording was also false ("rate themselves near zero
     * on saying it" for a MIDDLE mark, an explicit mild yes) — the exact phrasing `frozen` had already been
     * rewritten to remove.
     */
    expect(ids).not.toContain('cringe');
    expect(ids.filter((id) => id === 'frozen')).toHaveLength(1);
    // Nothing marked → nothing to probe. The loop ends rather than inventing work.
    expect(openAmbiguities(emptyLexicon('angel', NOW))).toEqual([]);
  });

  /*
   * 74 §3.6.34 — a contrast needs two DIFFERENT words, and one row is not a split.
   *
   * `loved` and `lukewarm` are both direction-blind over the same rows, so a single row marked
   * love-to-hear + okay-to-say landed in both and the question came out `They loved "good girl" but were
   * only lukewarm on "good girl"` — the same word twice, in a premise the probe is told it may quote from.
   * That is the say-gap, which `frozen` already asks about properly, not a split in the register.
   */
  it('never contrasts a word with itself, and asks about a single say-gap exactly once', () => {
    const one = applyDirectionalMarks(
      emptyLexicon('p1', NOW),
      DIRTY_TALK.bank,
      { 'names-praise:good-girl': { hear: 'love', say: 'okay' } },
      'take:1',
      NOW,
    );
    const ambiguities = openAmbiguities(one);
    for (const a of ambiguities) {
      expect(new Set(a.terms).size).toBe(a.terms.length);
      expect(a.question).not.toMatch(/"([^"]+)"[^"]*"\1"/);
    }
    // One marked row, one open question about it — not three.
    expect(ambiguities).toHaveLength(1);
    expect(ambiguities[0]?.id).toBe('frozen');
  });

  /**
   * 74 §3.6.36 — OWNER-REPORTED: `"my big cock" hit, "my beautiful pussy" only half-did. What's the split?`
   *
   * The model was faithful; the premise it was handed was nonsense. Both of the split's lists were
   * direction-blind, so the contrast paired a mark made about being CALLED something with a mark made about
   * SAYING something else — not two points on one scale. For a mixed-anatomy couple it is not even about the
   * same person's body: orientation shows a penis name only on the side its owner can hear and a vulva name
   * only on the side he can say (§3.6.23), which is exactly the pair he was asked about.
   */
  it('never contrasts what they like being CALLED with what they like SAYING', () => {
    const lex = applyDirectionalMarks(
      emptyLexicon('p1', NOW),
      DIRTY_TALK.bank,
      {
        // His body, so he only ever sees it as something he is called.
        'names-body:my-big-cock': { hear: 'love' },
        // Hers, so he only ever sees it as something he says.
        'names-body:my-beautiful-pussy': { say: 'okay' },
      },
      'take:1',
      NOW,
    );
    // Asserted, not assumed: both marks really did land, or this passes on an empty lexicon.
    expect(lex.entries.find((e) => e.text === 'my big cock')?.hearState).toBe('love');
    expect(lex.entries.find((e) => e.text === 'my beautiful pussy')?.sayState).toBe('okay');

    for (const ambiguity of openAmbiguities(lex)) {
      expect(ambiguity.question).not.toContain('my beautiful pussy');
    }
  });

  it('still asks the split when both marks are the SAME direction, and says which', () => {
    // The other half of the fix: comparing within one direction must not disable the ambiguity that makes
    // this phase worth running. Two penis names, both marks about being CALLED — a real register question.
    const lex = applyDirectionalMarks(
      emptyLexicon('p1', NOW),
      DIRTY_TALK.bank,
      {
        'names-body:my-big-cock': { hear: 'love' },
        'names-body:my-good-cock': { hear: 'okay' },
      },
      'take:1',
      NOW,
    );
    const split = openAmbiguities(lex).find((a) => a.id.startsWith('split:'));
    expect(split, 'the split ambiguity must survive the direction fix').toBeDefined();
    expect(split!.id).toBe('split:names-body:hear');
    // The DIRECTION is in the sentence the model is asked to resolve, so a question that omits it cannot be
    // written from a premise that states it.
    expect(split!.question).toContain('being called');
    expect(split!.question).not.toContain('saying');
    // …and each quoted word carries how it was marked, so the two cannot be flattened back together.
    expect(split!.termNote?.['my big cock']).toBe('they love being called this');
    expect(split!.termNote?.['my good cock']).toBe('only lukewarm about being called this');
  });

  it('says which way each word landed in the open-ended fallback', () => {
    // The same conflation in the pass that runs once the derived ambiguities are used up — which is most of
    // them. It said "they marked these as landing" and then asked the model to go deeper on "the direction".
    const lex = applyDirectionalMarks(
      emptyLexicon('p1', NOW),
      DIRTY_TALK.bank,
      {
        'names-body:my-big-cock': { hear: 'love' },
        'names-body:my-beautiful-pussy': { say: 'love' },
      },
      'take:1',
      NOW,
    );
    const open = openEndedAmbiguity(lex);
    expect(open?.question).toContain('"my big cock" as landing to be called');
    expect(open?.question).toContain('"my beautiful pussy" as landing to say');
    expect(open?.termNote?.['my beautiful pussy']).toBe('landed to say');
  });

  it('puts each quoted word in the prompt WITH how it was marked', async () => {
    const { client, prompts } = fakeClient([
      '{"questions": [{"question": "Which?", "options": ["a"]}]}',
    ]);
    const lex = applyDirectionalMarks(
      emptyLexicon('p1', NOW),
      DIRTY_TALK.bank,
      {
        'names-body:my-big-cock': { hear: 'love' },
        'names-body:my-good-cock': { hear: 'okay' },
      },
      'take:1',
      NOW,
    );
    const split = openAmbiguities(lex).find((a) => a.id.startsWith('split:'))!;
    await runProbePhase(deps(client), lex, split);
    // The bare list gave the model two words and no idea which was which — the direction lived only in the
    // user message while the rule about what may be quoted lived here.
    expect(prompts[0]?.system).toContain('- "my big cock" — they love being called this');
    expect(prompts[0]?.system).toContain(
      '- "my good cock" — only lukewarm about being called this',
    );
  });

  it('puts the hard nos in the prompt as a negative constraint', async () => {
    const { client, prompts } = fakeClient(['{"lines": ["good girl"]}']);
    await runLinesPhase(deps(client), seeded(), 1);
    expect(prompts[0]?.system).toContain('THEIR HARD NOS');
    expect(prompts[0]?.system).toContain('manwhore');
    // …and the explicit register that makes the model engage rather than deflect.
    expect(prompts[0]?.system).toContain('Frank, explicit, filthy language is appropriate');
  });

  it('DROPS a generated line that touches a boundary, even when the prompt was ignored', async () => {
    const { client } = fakeClient([
      '{"lines": ["good girl, just like that", "you filthy manwhore", "you\'re mine"]}',
    ]);
    const out = await runLinesPhase(deps(client), seeded(), 1);
    expect(out.value).toEqual(['good girl, just like that', "you're mine"]);
  });

  it('degrades rather than failing when a phase comes back unusable', async () => {
    const { client } = fakeClient(['not json at all']);
    const out = await runLinesPhase(deps(client), seeded(), 1);
    expect(out.ok).toBe(false);
    expect(out.degraded).toBe(true);
  });

  it('degrades when there is no API key, and never spends', async () => {
    const { client, prompts } = fakeClient(['{"lines": ["x"]}']);
    const out = await runLinesPhase({ ...deps(client), apiKey: null }, seeded(), 1);
    expect(out.degraded).toBe(true);
    expect(out.costUsd).toBe(0);
    expect(prompts).toHaveLength(0);
  });

  it('asks as many as the ambiguity needs, and never asks them to justify a boundary', async () => {
    const { client, prompts } = fakeClient([
      // As many as it needs (74 §3.6.16), each standing alone with its own example — a single question that
      // assumes they remember what they tapped is unanswerable a week later.
      JSON.stringify({
        questions: ['Is it the word, or being talked down to?', 'Does it change mid-scene?'],
      }),
    ]);
    const ambiguity = openAmbiguities(seeded())[0]!;
    const out = await runProbePhase(deps(client), seeded(), ambiguity);
    expect(out.value?.map((q) => q.question)).toEqual([
      'Is it the word, or being talked down to?',
      'Does it change mid-scene?',
    ]);
    // 74 §3.6.17 — SHORT and tappable, which is the opposite of what the prompt used to demand. It required
    // every question to restate the marks and carry a worked example before asking, so paragraphs were the
    // spec rather than a drift; the concrete OPTIONS carry that weight now.
    expect(prompts[0]?.system).toContain('Hard limit: 20 words');
    expect(prompts[0]?.system).toContain('ANSWERABLE BY TAPPING');
    expect(prompts[0]?.system).not.toContain('CONCRETE EXAMPLE');
    // …and it stays on the words. "What this says about them" is a reading, and it belongs in the profile
    // where it is labelled as one — not as a question they answer about themselves mid-test.
    expect(prompts[0]?.system).toContain('About LANGUAGE');
    expect(prompts[0]?.system).toContain('never ask why something is a hard no');
    expect(prompts[0]?.user).toContain(ambiguity.question);
  });

  it('drops a probe QUESTION that names a hard no — the instruction is belt, this is braces', async () => {
    // Every sibling phase filters what the model wrote; this one shipped its prose straight to the screen,
    // and it is the phase that asks open questions. "Never ask them to justify a boundary" has to be
    // enforced, not requested.
    const { client } = fakeClient([
      JSON.stringify({ questions: ['What is it about being called a manwhore?'] }),
    ]);
    const ambiguity = openAmbiguities(seeded())[0]!;
    const out = await runProbePhase(deps(client), seeded(), ambiguity);
    expect(out.value).toBeUndefined();
    expect(out.degraded).toBe(true);
  });

  it('drops a scenario whose SCENE names a hard no, not just its options', async () => {
    const { client } = fakeClient([
      JSON.stringify({
        scenes: [
          { scene: 'He calls you a manwhore across the room.', options: ['tease', 'escalate'] },
        ],
      }),
    ]);
    const out = await runScenarioPhase(deps(client), seeded(), 'sexting');
    expect(out.value).toBeUndefined();
    expect(out.degraded).toBe(true);
  });

  it('writes a SET of moments per context, because filth mid-act is wrong at 2pm', async () => {
    const { client, prompts } = fakeClient([
      JSON.stringify({
        scenes: [
          { scene: 'He texts you at 2pm.', options: ['escalate', 'tease', 'not at work'] },
          { scene: 'He calls on the way home.', options: ['tell him', 'make him wait'] },
        ],
      }),
    ]);
    const out = await runScenarioPhase(deps(client), seeded(), 'sexting');
    // More than one moment per pass (74 §3.6.16) — one at a time meant a call per scene and no sense of a set.
    expect(out.value).toHaveLength(2);
    expect(out.value?.[0]?.context).toBe('sexting');
    expect(out.value?.[0]?.options).toHaveLength(3);
    expect(prompts[0]?.system).toContain('"sexting"');
  });

  it('synthesizes a profile + narrative, and refuses a narrative that quotes a boundary back', async () => {
    const good = fakeClient([
      JSON.stringify({
        narrative: 'You want to be claimed, not demeaned.',
        registers: { claiming: 0.9 },
        contexts: { during: { heat: 0.9, note: 'full filth' } },
        themes: ['being claimed'],
        wantsToSay: ['cunt'],
        voice: 'low, close, certain.',
      }),
    ]);
    const ok = await runSynthesis(deps(good.client), seeded(), 'turns…');
    expect(ok.value?.narrative).toContain('claimed');
    expect(ok.value?.profile.registers['claiming']).toBe(0.9);
    expect(ok.value?.profile.voice).toBe('low, close, certain.');

    const bad = fakeClient([
      JSON.stringify({
        narrative: 'You loved being called a manwhore.',
        registers: {},
        contexts: {},
        themes: [],
        wantsToSay: [],
      }),
    ]);
    const refused = await runSynthesis(deps(bad.client), seeded(), 'turns…');
    expect(refused.ok).toBe(false);
    expect(refused.value?.narrative).toBe('');
  });

  it('carries the lede and the keyed readings, and filters a boundary out of both', async () => {
    const { client, prompts } = fakeClient([
      JSON.stringify({
        narrative: 'You want to be claimed.',
        lede: 'You want to be claimed, not pushed around.',
        readings: [
          {
            kind: 'pattern',
            text: 'The praise is about effort.',
            source: 'Your onboarding answers.',
          },
          { kind: 'gap', text: 'You loved being called a manwhore.' },
        ],
        registers: {},
        contexts: {},
        themes: [],
        wantsToSay: [],
      }),
    ]);
    const out = await runSynthesis(deps(client), seeded(), 'turns…', [
      'Confidence comes from effort.',
    ]);
    expect(out.value?.lede).toContain('not pushed around');
    // The lede and the readings are printed at the top of their report, so a boundary quoted back there is
    // the worst version of that failure — both go through the same filter as the prose.
    expect(out.value?.readings).toHaveLength(1);
    expect(out.value?.readings[0]?.kind).toBe('pattern');
    expect(out.value?.readings[0]?.source).toBe('Your onboarding answers.');
    // The signals reach the model, or a reading citing one would be a guess wearing a citation.
    expect(prompts[0]?.system).toContain('Confidence comes from effort.');
  });

  it('drops a cited source when there was nothing on file to cite', async () => {
    const { client, prompts } = fakeClient([
      JSON.stringify({
        narrative: 'You want to be claimed.',
        lede: 'Claimed, not demeaned.',
        readings: [{ kind: 'pattern', text: 'Praise lands.', source: 'Your onboarding answers.' }],
        registers: {},
        contexts: {},
        themes: [],
        wantsToSay: [],
      }),
    ]);
    // No signals: the instruction says not to cite, and this is the enforcement. A source the model invented
    // anyway is a claim about the person's own records that nothing backs.
    const out = await runSynthesis(deps(client), seeded(), 'turns…');
    expect(out.value?.readings[0]?.text).toBe('Praise lands.');
    expect(out.value?.readings[0]?.source).toBeUndefined();
    expect(prompts[0]?.system).toContain('nothing else on file');
  });

  it('filters a boundary out of the synthesized themes too', async () => {
    const { client } = fakeClient([
      JSON.stringify({
        narrative: 'You want to be claimed.',
        registers: {},
        contexts: {},
        themes: ['being claimed', 'being called a manwhore'],
        wantsToSay: [],
      }),
    ]);
    const out = await runSynthesis(deps(client), seeded(), 'turns…');
    expect(out.value?.profile.themes).toEqual(['being claimed']);
  });

  it('carries what the bank already established, so a phase never re-asks what it knows', () => {
    const digest = lexiconDigest(seeded());
    expect(digest).toContain('good girl');
    expect(digest).not.toContain('manwhore'); // a hard no is never offered back as material
  });

  it('surfaces the hear/say GAP as context — the signal that replaced the old cringe list (§3.6.2)', () => {
    // Loves hearing it, rated 0 to say, and BOTH sides were asked: that is the coachable material now.
    const lex = applyDirectionalMarks(
      seeded(),
      DIRTY_TALK.bank,
      { 'names-praise:good-girl': { hear: 'love', say: 'okay' } },
      'take:1',
      NOW,
    );
    expect(lexiconDigest(lex)).toContain('low on saying');
  });

  it('honors a themed boundary a probe recorded, not just a bank entry', async () => {
    const lex = addBoundary(seeded(), { text: 'being used', kind: 'theme' }, NOW);
    const { client } = fakeClient(['{"lines": ["I love using you", "good girl"]}']);
    const out = await runLinesPhase(deps(client), lex, 1);
    expect(out.value).toEqual(['good girl']);
  });
});

describe('74 §3.6.6 — an unasked side is never read as a refusal', () => {
  it('does NOT raise the "frozen" probe for a HEAR-ONLY entry', () => {
    // The probe says "they rated it 0 to say" out loud. For an oriented entry the say side was never
    // offered, so that statement is false — and the person's answer to it feeds synthesis.
    const lex = {
      ...emptyLexicon('p1', NOW),
      entries: [
        {
          key: 'names-praise:good-girl',
          text: 'good girl',
          kind: 'word' as const,
          family: 'names-power',
          tier: 2,
          hear: 3,
          say: 0,
          sides: ['hear' as const],
        },
      ],
    };
    expect(openAmbiguities(lex).map((a) => a.id)).not.toContain('frozen');
  });

  it('still raises it when both sides WERE asked', () => {
    const lex = {
      ...emptyLexicon('p1', NOW),
      entries: [
        {
          key: 'names-praise:good-girl',
          text: 'good girl',
          kind: 'word' as const,
          family: 'names-power',
          tier: 2,
          // Answered both ways, and the two answers differ — the gap (74 §3.6.26).
          hear: 4,
          say: 2,
          hearState: 'love' as const,
          sayState: 'okay' as const,
          sides: ['hear' as const, 'say' as const],
        },
      ],
    };
    expect(openAmbiguities(lex).map((a) => a.id)).toContain('frozen');
  });
});

describe('§3.6.11 — an unanswered side is not a rated zero', () => {
  /** A pet name marked one way and left blank the other. Every name row offers BOTH directions. */
  const name = (over: Partial<LexiconEntry> = {}): LexiconEntry => ({
    key: 'names-praise:good-girl',
    text: 'good girl',
    kind: 'word',
    family: 'names-praise',
    tier: 2,
    hear: 4,
    say: 0,
    hearState: 'love',
    sides: ['hear', 'say'],
    source: 'test:r1',
    ...over,
  });
  const lexicon = (entries: LexiconEntry[]): EroticLexicon => ({
    schemaVersion: 1,
    personId: 'p1',
    entries,
    registers: {},
    contexts: {},
    themes: [],
    wantsToSay: [],
    boundaries: [],
    updatedAt: 'now',
  });

  it('does not invent a hear/say GAP from a side they never answered', () => {
    // The reported prompt, verbatim from a capture: "They love hearing 'good girl' but rated it 0 to say" —
    // they rated nothing. `sides` says both were OFFERED, which is true of every name row, so the old
    // asked-based guard could never catch this.
    const open = openAmbiguities(lexicon([name()]));
    expect(open.map((a) => a.id)).not.toContain('frozen');
    expect(open.map((a) => a.id)).not.toContain('cringe');
    expect(lexiconDigest(lexicon([name()]))).not.toMatch(/low on saying/i);
  });

  it('still finds the gap when they DID answer both ways', () => {
    // A real gap — answered on both sides, and the most coachable signal in the take. The fix must not
    // silence it.
    //
    // 74 §3.6.26: the gap is love-to-hear against OKAY-to-say. It used to be `sayState: 'never'`, which
    // three marks make a contradiction: a `never` is a boundary — `suppressedTexts` strips that word from
    // everything generated, and §3.6.15 forbids the probe from asking anyone to justify one. Probing it
    // would put the single thing they ruled out in front of them as homework, which is the leak §3.2's goal
    // guard exists to stop. So "I could never say it" is respected, and "saying it is only okay" is coached.
    const answered = name({ sayState: 'okay', say: 2 });
    const open = openAmbiguities(lexicon([answered]));
    expect(open.map((a) => a.id)).toContain('frozen');
    expect(lexiconDigest(lexicon([answered]))).toMatch(/low on saying/i);
  });
});

describe('a heavy no-marker still gets lines (74 §8.4)', () => {
  it('does not filter out everything the model writes', async () => {
    const { DIRTY_TALK } = await import('./instruments/dirtyTalk');
    const { applyDirectionalMarks, emptyLexicon } = await import('./lexicon');
    const now = new Date('2026-08-18T00:00:00.000Z');

    // The reported state: went through the pet-name pass and ruled out most of it. Dozens of those names are
    // ordinary English (love · baby · beautiful · angel · treasure), so before the vocative rule the filter
    // killed most of what the model wrote — and a whole round landing on the floor was reported to them as
    // "Nothing usable came back this time".
    const names = DIRTY_TALK.bank.entries
      .filter((e) => e.family.startsWith('names-'))
      .slice(0, 130);
    const marks = Object.fromEntries(names.map((e) => [e.key, both('never')]));
    const lexicon = applyDirectionalMarks(
      emptyLexicon('p1', now),
      DIRTY_TALK.bank,
      marks,
      'take:1',
      now,
    );

    const written = [
      'I love the sound you make',
      'you look beautiful like that',
      'stay just like that',
      'I have wanted this all day',
      'you take it so well',
      'come here, baby', // a real vocative — this one SHOULD be dropped
    ];
    const { client } = fakeClient([JSON.stringify({ lines: written })]);
    const out = await runLinesPhase(deps(client), lexicon, 1);

    expect(out.ok).toBe(true);
    expect(out.value).toContain('I love the sound you make');
    expect(out.value).toContain('you look beautiful like that');
    // The boundary still holds where it means something: being CALLED baby is off.
    expect(out.value).not.toContain('come here, baby');
  });
});

describe('the probe never asks about a hard no (74 §3.6.15)', () => {
  it('draws its contrast against the middle mark, not a boundary', async () => {
    const { DIRTY_TALK } = await import('./instruments/dirtyTalk');
    const { applyDirectionalMarks, emptyLexicon } = await import('./lexicon');
    const { openAmbiguities } = await import('./engine');
    const now = new Date('2026-08-18T00:00:00.000Z');
    const names = DIRTY_TALK.bank.entries
      .filter((e) => e.family.startsWith('names-warm'))
      .slice(0, 6);
    const marks = Object.fromEntries(
      names.map((e, i) => [e.key, both(i === 0 ? 'love' : i === 1 ? 'okay' : 'never')] as const),
    );
    const lex = applyDirectionalMarks(
      emptyLexicon('p1', now),
      DIRTY_TALK.bank,
      marks,
      'take:1',
      now,
    );

    const banned = new Set(names.slice(2).map((e) => e.text));
    for (const ambiguity of openAmbiguities(lex)) {
      // It used to generate `They loved "X" but ruled out "Y"` — which asks them to justify a boundary (its
      // own prompt forbids that) AND guarantees the question it produces is rejected for naming Y. The phase
      // billed a call to produce nothing, every time, for anyone who had ruled anything out.
      for (const term of banned) expect(ambiguity.question).not.toContain(term);
      for (const term of ambiguity.terms) expect(banned.has(term)).toBe(false);
    }
  });

  it('salvages a question whose inner quotes were never escaped', async () => {
    const { client } = fakeClient([
      // What roughly half of live replies look like for a one-string payload: valid-looking, not valid JSON.
      '{"question": "When you hear "baby" land right — is it the word, or the register behind it?"}',
    ]);
    const out = await runProbePhase(deps(client), seeded(), {
      id: 'x',
      question: 'is it the word or the register?',
      terms: ['baby'],
    });
    expect(out.ok).toBe(true);
    expect(out.value?.[0]?.question).toContain('land right');
  });

  /*
   * 74 §3.6.17 — the length is ENFORCED, not merely requested.
   *
   * A live run produced a 27-word question in a set of six. The prompt asks for under 20 and mostly gets it,
   * but "too long" is the exact complaint this rewrite answers, and every other generated thing here is
   * checked in code as well as asked for.
   */
  it('drops a rambling question rather than showing it', async () => {
    const long = `Thinking back to what you marked earlier about the words you like to hear in the moment, \
would you say that it is the specific phrasing that lands for you or something else entirely about it?`;
    const { client } = fakeClient([
      JSON.stringify({
        questions: [
          { question: 'Which lands harder?', options: ['a', 'b'] },
          { question: 'Order or request?', options: ['a', 'b'] },
          { question: 'What kills it?', options: ['a', 'b'] },
          { question: long, options: ['a', 'b'] },
        ],
      }),
    ]);
    const out = await runProbePhase(deps(client), seeded(), openAmbiguities(seeded())[0]!);
    expect(out.value?.map((q) => q.question)).toEqual([
      'Which lands harder?',
      'Order or request?',
      'What kills it?',
    ]);
  });

  it('gives way rather than leaving them a thin pass when EVERY question is long', async () => {
    // The cap must not be able to empty the step. A whole verbose pass still ships — shortest first — since
    // an honest set of slightly-long questions beats a paid call that produced nothing.
    const long = (n: number): string => `${'word '.repeat(n)}land?`;
    const { client } = fakeClient([
      JSON.stringify({
        questions: [
          { question: long(40), options: ['a', 'b'] },
          { question: long(25), options: ['a', 'b'] },
        ],
      }),
    ]);
    const out = await runProbePhase(deps(client), seeded(), openAmbiguities(seeded())[0]!);
    expect(out.ok).toBe(true);
    expect(out.value).toHaveLength(2);
    // Shortest first, so the best of a bad set leads.
    expect(out.value?.[0]?.question.split(/\s+/).length).toBeLessThan(
      out.value![1]!.question.split(/\s+/).length,
    );
  });
});

describe('the analysis survives one unlucky word (74 §3.6.15)', () => {
  it('drops the offending PARAGRAPH, not the whole narrative', async () => {
    const { client } = fakeClient([
      JSON.stringify({
        lede: 'You want to be claimed.',
        narrative:
          'A good paragraph about what lands.\n\nYou loved being called a manwhore.\n\nAnd a third.',
        readings: [{ kind: 'pattern', text: 'Praise lands.' }],
        registers: {},
        contexts: {},
        themes: [],
        wantsToSay: [],
      }),
    ]);
    const out = await runSynthesis(deps(client), seeded(), 'turns…');
    // The boundary is still absolute — no sentence containing it is ever shown…
    expect(out.value?.narrative).not.toContain('manwhore');
    // …but the other 3,000 words survive. Rejecting the whole thing for one hit is what "the psychological
    // analysis didn't come through" WAS: the model wrote it and we threw it away.
    expect(out.value?.narrative).toContain('A good paragraph');
    expect(out.value?.narrative).toContain('And a third');
    expect(out.ok).toBe(true);
  });

  it('is a success when the lede and readings survive, even with no narrative', async () => {
    const { client } = fakeClient([
      JSON.stringify({
        lede: 'You want to be claimed.',
        narrative: 'You loved being called a manwhore.',
        readings: [{ kind: 'pattern', text: 'Praise lands.' }],
        registers: {},
        contexts: {},
        themes: [],
        wantsToSay: [],
      }),
    ]);
    const out = await runSynthesis(deps(client), seeded(), 'turns…');
    // The report LEADS with these two. Gating `ok` on the narrative alone reported a total failure over a
    // good lede and a reading — which is the state the owner kept hitting.
    expect(out.ok).toBe(true);
    expect(out.value?.lede).toContain('claimed');
    expect(out.value?.readings).toHaveLength(1);
  });
});

describe('a name loved one way and ruled out the other (74 §3.6.16)', () => {
  // The normal shape of the names pass: every loved name is marked in ONE direction, which makes it a hard no
  // in the other (§3.6.8 — "never call me slut" must not stop him calling her slut). `violatesBoundary` with
  // no direction then refuses it, so the engine picked a term BECAUSE they loved it and forbade itself from
  // naming it. Verified against the owner's own vault: every one of his four loved terms is this shape, so
  // the probe failed 100% of the time.
  it('lets the probe quote a word it was handed, while still filtering everything else', async () => {
    const { applyDirectionalMarks, emptyLexicon, suppressedTexts } = await import('./lexicon');
    const { DIRTY_TALK } = await import('./instruments/dirtyTalk');
    const now = new Date('2026-08-18T00:00:00.000Z');
    const naughtyGirl = DIRTY_TALK.bank.entries.find((e) => e.text === 'naughty girl')!;
    const manwhore = DIRTY_TALK.bank.entries.find((e) => e.text === 'manwhore')!;

    let lex = applyDirectionalMarks(
      emptyLexicon('p1', now),
      DIRTY_TALK.bank,
      {
        [naughtyGirl.key]: { hear: 'never', say: 'love' },
        [manwhore.key]: { hear: 'never', say: 'never' },
      },
      'take:1',
      now,
    );
    lex = applyDirectionalMarks(lex, DIRTY_TALK.bank, {}, 'take:1', now);
    // Undirected, it reads as ruled out — which is right for a line and wrong for a question about it.
    expect(suppressedTexts(lex)).toContain('naughty girl');

    const ok = fakeClient([
      JSON.stringify({
        question: 'When you hear "naughty girl" — is it the word or the register?',
      }),
    ]);
    const kept = await runProbePhase(deps(ok.client), lex, {
      id: 'x',
      question: 'word or register?',
      terms: ['naughty girl'],
    });
    expect(kept.ok).toBe(true);
    expect(kept.value?.[0]?.question).toContain('naughty girl');

    // …and a question that reaches for a DIFFERENT ruled-out word is still dropped.
    const bad = fakeClient([
      JSON.stringify({ questions: ['Is "naughty girl" different from being called a manwhore?'] }),
    ]);
    const dropped = await runProbePhase(deps(bad.client), lex, {
      id: 'x',
      question: 'word or register?',
      terms: ['naughty girl'],
    });
    expect(dropped.ok).toBe(false);
  });
});

describe('74 §3.6.29 — the digest keeps the two directions apart', () => {
  /*
   * The synthesis prompt asks for "the role they take, what they want to BE to the other person" and for the
   * hear/say gap. Neither is answerable from a flat list, and a flat list is what it used to get: one line
   * built from `Math.max(hear, say) >= 3`, so "call me this" and "I want to call them this" — opposite
   * answers on a pet name (§3.6.8) — arrived as the same fact.
   */
  it('says which direction each loved term runs in, and carries the middle mark', () => {
    const lex = applyDirectionalMarks(
      emptyLexicon('p1', new Date('2026-08-19T00:00:00.000Z')),
      DIRTY_TALK.bank,
      {
        // Loved to be CALLED it, never to say it.
        'names-praise:good-girl': { hear: 'love', say: 'never' },
        // The mirror: loved to SAY, never to hear.
        'names-praise:good-boy': { hear: 'never', say: 'love' },
        // The middle mark, which reached the synthesis nowhere at all.
        'anatomy-her:cunt': { hear: 'okay', say: 'okay' },
      },
      'take:1',
      new Date('2026-08-19T00:00:00.000Z'),
    );
    const digest = lexiconDigest(lex);
    const hearLine = digest.split('\n').find((l) => l.startsWith('They want to HEAR')) ?? '';
    const sayLine = digest.split('\n').find((l) => l.startsWith('They want to SAY')) ?? '';
    expect(hearLine).toContain('good girl');
    expect(hearLine).not.toContain('good boy');
    expect(sayLine).toContain('good boy');
    expect(sayLine).not.toContain('good girl');
    expect(digest).toMatch(/Fine with, not favourites.*cunt/);
  });
});

describe('74 §3.6.34 — a truncated scenario set keeps the scenes that did arrive', () => {
  it('salvages the complete scenes instead of losing all five', async () => {
    const fs = memFileSystem();
    const key = new Uint8Array(32).fill(9);
    const lexicon = emptyLexicon('p1', new Date());
    await writeLexicon(fs, key, lexicon);
    // Cut off mid-way through the third scene, exactly as a max_tokens stop does.
    const truncated =
      '{"scenes":[' +
      '{"scene":"You get in first and wait.","options":["tell me what you want","come here"]},' +
      '{"scene":"They text you at lunch.","options":["say it out loud","not yet"]},' +
      '{"scene":"The third one never fini';
    const client: ClaudeClient = {
      send: () => Promise.resolve(truncated),
      stream: () =>
        Promise.resolve({
          text: truncated,
          usage: { inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        }),
    };
    const result = await runScenarioPhase(
      {
        fs,
        key,
        client,
        apiKey: 'sk-test',
        model: 'claude-sonnet-4-6',
        personId: 'p1',
        now: new Date(),
      },
      lexicon,
      'buildUp',
    );
    expect(result.ok).toBe(true);
    expect(result.value?.map((scene) => scene.scene)).toEqual([
      'You get in first and wait.',
      'They text you at lunch.',
    ]);
  });
});

/*
 * 74 §3.6.39 — a premise must state what the person actually marked, in the register they marked it in.
 *
 * §3.6.36 fixed WHICH DIRECTION a mark was made in and left what that direction MEANS for the family it came
 * from: "being called" was used for all 42 families, so every hear-split drawn from one of the 33 LINE
 * families said something untrue. Found live on the owner's own take — 4 of his 11 derived premises.
 */
describe('a hear-premise names the right register (74 §3.6.39)', () => {
  const marked = (marks: Record<string, DirectionalMark>) =>
    applyDirectionalMarks(emptyLexicon('p1', NOW), DIRTY_TALK.bank, marks, 'take:1', NOW);

  it('a LINE family says "hearing" — you are not CALLED "suck me"', () => {
    const lex = marked({
      'oral:suck-me': { hear: 'love' },
      'oral:lick-me': { hear: 'okay' },
    });
    const split = openAmbiguities(lex).find((a) => a.id === 'split:oral:hear');
    expect(split).toBeDefined();
    expect(split!.question).toContain('love hearing "suck me"');
    expect(split!.question).toContain('lukewarm about hearing "lick me"');
    expect(split!.question).not.toContain('being called');
    expect(split!.termNote?.['suck me']).toBe('they love hearing this');
    expect(split!.termNote?.['lick me']).toBe('only lukewarm about hearing this');
  });

  /*
   * The anti-vacuity half: the fix must not simply delete the vocative wording. A name IS something you are
   * called, and §3.6.33 established that register split deliberately — `names-body:my cock` is a vocative
   * where `anatomy-him:cock` is descriptive.
   */
  it('a NAME family keeps "being called"', () => {
    const lex = marked({
      'names-warm:beautiful': { hear: 'love' },
      'names-warm:babe': { hear: 'okay' },
    });
    const split = openAmbiguities(lex).find((a) => a.id === 'split:names-warm:hear');
    expect(split).toBeDefined();
    expect(split!.question).toContain('love being called "beautiful"');
    expect(split!.question).not.toContain('love hearing');
    expect(split!.termNote?.['beautiful']).toBe('they love being called this');
  });

  it('the SAY direction is unchanged for both — you say a name and you say a line', () => {
    const line = marked({ 'oral:suck-me': { say: 'love' }, 'oral:lick-me': { say: 'okay' } });
    const name = marked({
      'names-warm:beautiful': { say: 'love' },
      'names-warm:babe': { say: 'okay' },
    });
    expect(openAmbiguities(line).find((a) => a.id === 'split:oral:say')!.question).toContain(
      'love saying "suck me"',
    );
    expect(openAmbiguities(name).find((a) => a.id === 'split:names-warm:say')!.question).toContain(
      'love saying "beautiful"',
    );
  });

  /*
   * The same rule in the fallback that runs for most later passes. The owner's own list happened to draw four
   * names, so it read correctly by luck — the first loved LINE to reach it would have said "landing to be
   * called 'suck me'".
   */
  it('the open-ended fallback says "to hear" for a line and "to be called" for a name', () => {
    const line = openEndedAmbiguity(marked({ 'oral:suck-me': { hear: 'love' } }));
    expect(line!.question).toContain('"suck me" as landing to hear');
    expect(line!.termNote?.['suck me']).toBe('landed to hear');

    const name = openEndedAmbiguity(marked({ 'names-warm:beautiful': { hear: 'love' } }));
    expect(name!.question).toContain('"beautiful" as landing to be called');
    expect(name!.termNote?.['beautiful']).toBe('landed to be called');
  });
});

/*
 * 74 §3.6.39 — one bad element must not sink a whole pass.
 *
 * Measured live at the owner's real shape: 2 of 4 open-ended probe passes came back MALFORMED, every one of
 * them `end_turn` — complete replies, not truncated and not refused. The model wrote ONE question with raw
 * inner quotes while the other five escaped theirs correctly, and `extractJsonObject` returned null for the
 * lot. This phase is the most exposed to it in the whole take, because its entire job is to quote the
 * person's own marked terms back at them.
 *
 * The reply below is the real captured one, trimmed to three questions and keeping the defect verbatim.
 */
const PROBE_REPLY_WITH_ONE_RAW_QUOTE = `\`\`\`json
{
  "questions": [
    {
      "question": "When she says "my big cock" — what makes it land?",
      "options": ["She means it like a fact, not a compliment", "It's the possessive"]
    },
    {
      "question": "\\"My big cock\\" vs \\"my big dick\\" — do they hit differently?",
      "options": ["\\"Cock\\" is rawer, that's the one", "Same hit, either works"]
    },
    {
      "question": "You say \\"beautiful\\" — where does it belong?",
      "options": ["Looking at her before anything starts", "Mid-fuck, no thinking"]
    }
  ]
}
\`\`\``;

describe('a phase salvages what arrived (74 §3.6.39)', () => {
  it('the probe keeps the well-formed questions when one carries unescaped quotes', async () => {
    const { client } = fakeClient([PROBE_REPLY_WITH_ONE_RAW_QUOTE]);
    const lex = applyDirectionalMarks(
      emptyLexicon('p1', NOW),
      DIRTY_TALK.bank,
      { 'names-body:my-big-cock': { hear: 'love' }, 'names-body:my-good-cock': { hear: 'okay' } },
      'take:1',
      NOW,
    );
    const ambiguity = openAmbiguities(lex).find((a) => a.id.startsWith('split:'))!;
    const out = await runProbePhase(deps(client), lex, ambiguity);
    // Before the salvage this was ok:false / MALFORMED, and a billed call reported "an unexpected shape".
    expect(out.ok).toBe(true);
    expect(out.value?.map((q) => q.question)).toEqual([
      '"My big cock" vs "my big dick" — do they hit differently?',
      'You say "beautiful" — where does it belong?',
    ]);
    // The malformed element is dropped, never repaired into something the model didn't write.
    expect(out.value?.some((q) => q.question.includes('what makes it land'))).toBe(false);
  });

  it('a reply that is genuinely unusable still fails honestly', async () => {
    const { client } = fakeClient(['not json at all, and not a question']);
    const lex = seeded();
    const ambiguity = openAmbiguities(lex)[0]!;
    const out = await runProbePhase(deps(client), lex, ambiguity);
    expect(out.ok).toBe(false);
    expect(out.degraded).toBe(true);
  });

  /*
   * `parseLines` had NO callers anywhere — production parsed more strictly than the helper written for it,
   * so a bare top-level array (a shape the model returns about as often as the wrapped one) was thrown away.
   */
  it('the lines phase accepts a bare top-level array, which never reached production before', async () => {
    const { client } = fakeClient(['["hold still", "look at me"]']);
    const out = await runLinesPhase(deps(client), emptyLexicon('p1', NOW), 1);
    expect(out.ok).toBe(true);
    expect(out.value).toEqual(['hold still', 'look at me']);
  });

  it('the lines phase keeps the complete lines when the array is cut off mid-element', async () => {
    const { client } = fakeClient(['{"lines": ["hold still", "look at me", "don\'t you da']);
    const out = await runLinesPhase(deps(client), emptyLexicon('p1', NOW), 1);
    expect(out.ok).toBe(true);
    expect(out.value).toEqual(['hold still', 'look at me']);
  });
});

import { describe, expect, it } from 'vitest';

import type { EroticLexicon, LexiconEntry } from '../../schemas';
import { DIRTY_TALK } from './instruments/dirtyTalk';

import type { ClaudeClient } from '../../host';
import { memFileSystem } from '../../host/memFileSystem';
import type { AiDeps } from '../../questionnaires/aiCall';
import { applyBankMarks, applyDirections, emptyLexicon, addBoundary } from './lexicon';
import {
  lexiconDigest,
  openAmbiguities,
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

function seeded() {
  let lex = applyBankMarks(
    emptyLexicon('angel', NOW),
    DIRTY_TALK.bank,
    {
      'names-praise:good-girl': 'love',
      'names-rough-heavy:whore': 'never',
      'names-rough-heavy:slut': 'love',
      'anatomy-her:cunt': 'okay',
    },
    'take:1',
    NOW,
  );
  lex = applyDirections(lex, { 'names-praise:good-girl': { hear: 4, say: 0 } }, NOW);
  return lex;
}

describe('the adaptive engine (74 §5.1/§5.3)', () => {
  it('derives its ambiguities from the DATA, so the loop terminates on facts not on model confidence', () => {
    const ambiguities = openAmbiguities(seeded());
    const ids = ambiguities.map((a) => a.id);
    // Loved `slut`, ruled out `whore`, same family → the "is it the word or the register?" question, which is
    // the single most useful thing a probe can settle.
    expect(ids).toContain('split:names-rough-heavy');
    // Loves hearing "good girl", rated 0 to say → preference or goal?
    expect(ids).toContain('frozen');
    expect(ids).toContain('cringe');
    // Nothing marked → nothing to probe. The loop ends rather than inventing work.
    expect(openAmbiguities(emptyLexicon('angel', NOW))).toEqual([]);
  });

  it('puts the hard nos in the prompt as a negative constraint', async () => {
    const { client, prompts } = fakeClient(['{"lines": ["good girl"]}']);
    await runLinesPhase(deps(client), seeded(), 1);
    expect(prompts[0]?.system).toContain('THEIR HARD NOS');
    expect(prompts[0]?.system).toContain('whore');
    // …and the explicit register that makes the model engage rather than deflect.
    expect(prompts[0]?.system).toContain('Frank, explicit, filthy language is appropriate');
  });

  it('DROPS a generated line that touches a boundary, even when the prompt was ignored', async () => {
    const { client } = fakeClient([
      '{"lines": ["good girl, just like that", "you filthy whore", "you\'re mine"]}',
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

  it('asks ONE question per probe, and never asks them to justify a boundary', async () => {
    const { client, prompts } = fakeClient([
      '{"question": "Is it the word, or being talked down to?"}',
    ]);
    const ambiguity = openAmbiguities(seeded())[0]!;
    const out = await runProbePhase(deps(client), seeded(), ambiguity);
    expect(out.value).toBe('Is it the word, or being talked down to?');
    expect(prompts[0]?.system).toContain('never ask why something is a hard no');
    expect(prompts[0]?.user).toContain(ambiguity.question);
  });

  it('drops a probe QUESTION that names a hard no — the instruction is belt, this is braces', async () => {
    // Every sibling phase filters what the model wrote; this one shipped its prose straight to the screen,
    // and it is the phase that asks open questions. "Never ask them to justify a boundary" has to be
    // enforced, not requested.
    const { client } = fakeClient(['{"question": "What is it about being called a whore?"}']);
    const ambiguity = openAmbiguities(seeded())[0]!;
    const out = await runProbePhase(deps(client), seeded(), ambiguity);
    expect(out.value).toBeUndefined();
    expect(out.degraded).toBe(true);
  });

  it('drops a scenario whose SCENE names a hard no, not just its options', async () => {
    const { client } = fakeClient([
      '{"scene": "He calls you a whore across the room.", "options": ["tease", "escalate"]}',
    ]);
    const out = await runScenarioPhase(deps(client), seeded(), 'sexting');
    expect(out.value).toBeUndefined();
    expect(out.degraded).toBe(true);
  });

  it('scores a scenario per CONTEXT, because filth mid-act is wrong at 2pm', async () => {
    const { client, prompts } = fakeClient([
      '{"scene": "He texts you at 2pm.", "options": ["escalate", "tease", "not at work"]}',
    ]);
    const out = await runScenarioPhase(deps(client), seeded(), 'sexting');
    expect(out.value?.context).toBe('sexting');
    expect(out.value?.options).toHaveLength(3);
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
        narrative: 'You loved being called a whore.',
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

  it('filters a boundary out of the synthesized themes too', async () => {
    const { client } = fakeClient([
      JSON.stringify({
        narrative: 'You want to be claimed.',
        registers: {},
        contexts: {},
        themes: ['being claimed', 'being called a whore'],
        wantsToSay: [],
      }),
    ]);
    const out = await runSynthesis(deps(client), seeded(), 'turns…');
    expect(out.value?.profile.themes).toEqual(['being claimed']);
  });

  it('carries what the bank already established, so a phase never re-asks what it knows', () => {
    const digest = lexiconDigest(seeded());
    expect(digest).toContain('good girl');
    expect(digest).not.toContain('whore'); // a hard no is never offered back as material
  });

  it('surfaces the hear/say GAP as context — the signal that replaced the old cringe list (§3.6.2)', () => {
    // Loves hearing it, rated 0 to say, and BOTH sides were asked: that is the coachable material now.
    const lex = applyDirections(seeded(), { 'names-praise:good-girl': { hear: 4, say: 0 } }, NOW);
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
          hear: 3,
          say: 0,
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
    // A real "I love hearing it and I can't say it" — answered on both sides, and the most coachable signal
    // in the take. The fix must not silence it.
    const answered = name({ sayState: 'never', say: 0 });
    const open = openAmbiguities(lexicon([answered]));
    expect(open.map((a) => a.id)).toContain('frozen');
    expect(lexiconDigest(lexicon([answered]))).toMatch(/low on saying/i);
  });
});

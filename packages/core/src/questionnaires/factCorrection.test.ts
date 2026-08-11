import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import type { Question } from '../schemas';
import { resolveFactCorrection, type KnownFact } from './factCorrectionService';
import { questionLabels, sanitizeRewrite } from './questionLabels';
import type { AiDeps } from './generationService';

const key = generateMasterKey();
const now = new Date('2026-08-11T12:00:00.000Z');

let lastUser = '';
function fakeClient(text: string): ClaudeClient {
  return {
    send: () => Promise.resolve(text),
    stream: (o, onDelta) => {
      lastUser = o.messages.map((m) => m.content).join('\n');
      onDelta(text);
      return Promise.resolve({
        text,
        usage: { inputTokens: 10, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}
function deps(fs: FileSystem, client: ClaudeClient): AiDeps {
  return { fs, key, client, apiKey: 'sk-x', model: 'claude-sonnet-4-6', personId: 'p1', now };
}

const facts: KnownFact[] = [
  {
    source: 'profile',
    label: 'your birthday',
    text: 'age: 39 (born 1987-05-14)',
    field: 'birthday',
    currentValue: '1987-05-14',
  },
  {
    source: 'insight',
    label: 'your Memory',
    text: 'Turned 39 last May',
    insightId: 'i1',
    factId: 'f1',
  },
];

const choiceQ: Question = {
  id: 'q1',
  type: 'singleChoice',
  prompt: 'Now that you’re 39, how has your view of ambition shifted?',
  required: true,
  options: ['It’s sharper at 39', 'It’s softened since my late 30s', 'About the same as at 35'],
};

describe('questionLabels + sanitizeRewrite', () => {
  it('reads exactly the visible surface, and nothing structural', () => {
    const l = questionLabels(choiceQ);
    expect(l.prompt).toBe(choiceQ.prompt);
    expect(l.options).toEqual(choiceQ.options);
    expect(l).not.toHaveProperty('matrixRows');
  });

  it('accepts a same-length option rewrite', () => {
    const r = sanitizeRewrite(choiceQ, {
      prompt: 'Now that you’re in your forties, how has your view of ambition shifted?',
      options: ['It’s sharper than before', 'It’s softened lately', 'About the same as always'],
    });
    expect(r.options).toEqual([
      'It’s sharper than before',
      'It’s softened lately',
      'About the same as always',
    ]);
  });

  it('REJECTS an option list whose length changed, keeping the originals', () => {
    // Adding or dropping an option changes the question rather than rewording it — and would break the
    // sender's counts and any branch rule keyed on an option string (§32.3).
    const added = sanitizeRewrite(choiceQ, { prompt: 'p', options: ['a', 'b', 'c', 'd'] });
    const dropped = sanitizeRewrite(choiceQ, { prompt: 'p', options: ['a', 'b'] });
    expect(added.options).toBeUndefined();
    expect(dropped.options).toBeUndefined();
  });

  it('REJECTS a rewrite that collapses two options to the SAME label', () => {
    // An option label stands in for its value, so two options sharing a label would silently record the
    // wrong one. Dropping the wrong detail is exactly what causes this collapse, so it must be rejected —
    // `answersStillWrong` is the honest exit for a question rewording can't rescue.
    const r = sanitizeRewrite(choiceQ, {
      prompt: 'p',
      options: ['Sharper than before', 'Sharper than before', 'About the same'],
    });
    expect(r.options).toBeUndefined();
  });

  it('never renames the reserved Other option (it would kill the write-in)', () => {
    const withOther: Question = {
      ...choiceQ,
      options: ['At 39 I felt good', 'Other'],
      allowOther: true,
    };
    const r = sanitizeRewrite(withOther, {
      prompt: 'p',
      options: ['I felt good', 'Something else'],
    });
    expect(r.options).toEqual(['I felt good', 'Other']);
  });

  it('never blanks a label with an empty string', () => {
    const r = sanitizeRewrite(choiceQ, { prompt: '   ', options: ['', 'b', 'c'] });
    expect(r.prompt).toBe(choiceQ.prompt);
    expect(r.options?.[0]).toBe(choiceQ.options![0]);
  });

  it('omits an options key entirely when nothing actually changed', () => {
    const r = sanitizeRewrite(choiceQ, { prompt: 'reworded', options: [...choiceQ.options!] });
    expect(r.options).toBeUndefined();
    expect(r.prompt).toBe('reworded');
  });

  it('rewords matrix ROW labels but never their count', () => {
    const matrixQ: Question = {
      id: 'q2',
      type: 'matrix',
      prompt: 'Rate these',
      required: false,
      matrix: {
        rows: [
          { key: 'a', label: 'At 39, mornings' },
          { key: 'b', label: 'Evenings' },
        ],
        min: 1,
        max: 5,
      },
    };
    expect(
      sanitizeRewrite(matrixQ, { prompt: 'Rate these', matrixRows: ['Mornings', 'Evenings'] })
        .matrixRows,
    ).toEqual(['Mornings', 'Evenings']);
    expect(
      sanitizeRewrite(matrixQ, { prompt: 'Rate these', matrixRows: ['Only one'] }).matrixRows,
    ).toBeUndefined();
  });
});

describe('resolveFactCorrection', () => {
  it('rewrites the prompt AND the options, and maps the matched index to its KnownFact', async () => {
    const reply = JSON.stringify({
      matchedIndex: 2,
      prompt: 'Now that you’re in your forties, how has your view of ambition shifted?',
      options: ['It’s sharper than before', 'It’s softened lately', 'About the same as always'],
    });
    const res = await resolveFactCorrection(deps(memFileSystem(), fakeClient(reply)), {
      question: choiceQ,
      correction: 'I’m 41, not 39 — and none of these answers fit.',
      knownFacts: facts,
    });
    expect(res.ok).toBe(true);
    expect(res.rewrite?.prompt).toContain('forties');
    expect(res.rewrite?.options?.[0]).toBe('It’s sharper than before');
    // matchedIndex 2 → the SECOND fact (the Memory insight), 1-based.
    expect(res.matched?.source).toBe('insight');
    expect(res.matched?.factId).toBe('f1');
  });

  it('sends the options to the model — a prompt-only call could never fix the answers', async () => {
    const reply = JSON.stringify({ matchedIndex: 0, prompt: 'p' });
    await resolveFactCorrection(deps(memFileSystem(), fakeClient(reply)), {
      question: choiceQ,
      correction: 'wrong',
      knownFacts: facts,
    });
    expect(lastUser).toContain('It’s sharper at 39');
    expect(lastUser).toContain('Options (3)');
  });

  it('surfaces answersStillWrong so the panel can offer the honest skip exit', async () => {
    const reply = JSON.stringify({ matchedIndex: 0, prompt: 'p', answersStillWrong: true });
    const res = await resolveFactCorrection(deps(memFileSystem(), fakeClient(reply)), {
      question: choiceQ,
      correction: 'these answers make no sense at all',
      knownFacts: facts,
    });
    expect(res.rewrite?.answersStillWrong).toBe(true);
  });

  it('proposes a corrected value only for a matched PROFILE field', async () => {
    const withValue = JSON.stringify({
      matchedIndex: 1,
      prompt: 'p',
      correctedValue: '1985-05-14',
    });
    const profileRes = await resolveFactCorrection(deps(memFileSystem(), fakeClient(withValue)), {
      question: choiceQ,
      correction: 'I was born in 1985.',
      knownFacts: facts,
    });
    expect(profileRes.proposedValue).toBe('1985-05-14');

    // The same value against an INSIGHT match is not a profile fix — there's no field to write.
    const insightReply = JSON.stringify({
      matchedIndex: 2,
      prompt: 'p',
      correctedValue: '1985-05-14',
    });
    const insightRes = await resolveFactCorrection(
      deps(memFileSystem(), fakeClient(insightReply)),
      {
        question: choiceQ,
        correction: 'I was born in 1985.',
        knownFacts: facts,
      },
    );
    expect(insightRes.proposedValue).toBeUndefined();
  });

  it('returns no match (index 0) so the caller can fall back to the candidate picker', async () => {
    const reply = JSON.stringify({ matchedIndex: 0, prompt: 'How are you doing lately?' });
    const res = await resolveFactCorrection(deps(memFileSystem(), fakeClient(reply)), {
      question: choiceQ,
      correction: 'I never moved.',
      knownFacts: facts,
    });
    expect(res.ok).toBe(true);
    expect(res.matched).toBeUndefined();
  });

  it('reports an honest failure when the reply is unparseable', async () => {
    const res = await resolveFactCorrection(deps(memFileSystem(), fakeClient('sorry, no')), {
      question: choiceQ,
      correction: 'nope',
      knownFacts: facts,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBeDefined();
  });
});

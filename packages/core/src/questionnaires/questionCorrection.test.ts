import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem } from '../host';
import type { Question } from '../schemas';
import { resolveFactCorrection, type KnownFact } from './factCorrectionService';
import {
  repairBranchRules,
  replaceQuestion,
  sanitizeCorrectedQuestion,
} from './questionCorrection';
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
  options: ['It’s sharper at 39', 'It’s softened since my late 30s'],
};

describe('sanitizeCorrectedQuestion', () => {
  it('accepts a genuine rewrite — new wording, a DIFFERENT number of options, a real "neither"', () => {
    const q = sanitizeCorrectedQuestion(choiceQ, {
      prompt: 'How has your view of ambition shifted lately?',
      options: ['Sharper', 'Softer', 'About the same', 'It varies'],
    });
    expect(q?.options).toHaveLength(4);
    expect(q?.prompt).toBe('How has your view of ambition shifted lately?');
  });

  it('lets the answer TYPE change, dropping the shape the old type needed', () => {
    const q = sanitizeCorrectedQuestion(choiceQ, {
      type: 'longText',
      prompt: 'How has your view of ambition shifted?',
    });
    expect(q?.type).toBe('longText');
    expect(q?.options).toBeUndefined();
  });

  it('preserves the question’s IDENTITY — other records point at it', () => {
    const withIds: Question = { ...choiceQ, canonicalId: 'c1', metricKey: 'ambition' };
    const q = sanitizeCorrectedQuestion(withIds, {
      id: 'hijacked',
      canonicalId: 'other',
      metricKey: 'other',
      prompt: 'Reworded?',
      options: ['a', 'b'],
    });
    expect(q?.id).toBe('q1');
    expect(q?.canonicalId).toBe('c1');
    expect(q?.metricKey).toBe('ambition');
  });

  it('REFUSES a structurally broken rewrite rather than overwriting a working question', () => {
    // A choice question with no usable options, and one whose options collapsed to the same text — an
    // option string IS the stored answer, so duplicates make the recorded choice ambiguous.
    expect(sanitizeCorrectedQuestion(choiceQ, { type: 'singleChoice', options: [] })).toBeNull();
    expect(sanitizeCorrectedQuestion(choiceQ, { options: ['Same', 'Same'] })).toBeNull();
    expect(sanitizeCorrectedQuestion(choiceQ, undefined)).toBeNull();
  });
});

describe('repairBranchRules', () => {
  const trigger: Question = {
    id: 'q1',
    type: 'singleChoice',
    prompt: 'Partnered?',
    required: true,
    options: ['Yes', 'No'],
  };
  const follow: Question = {
    id: 'q2',
    type: 'shortText',
    prompt: 'Tell me about them',
    required: false,
    branch: { whenQuestionId: 'q1', equals: 'Yes', action: 'show' },
  };

  it('keeps a rule whose trigger value survived the rewrite', () => {
    const corrected = { ...trigger, options: ['Yes', 'No', 'It’s complicated'] };
    expect(repairBranchRules([trigger, follow], corrected)[1]?.branch).toEqual(follow.branch);
  });

  it('DROPS a rule stranded by the rewrite, so the follow-up can still be seen', () => {
    // Its condition can never be met again — leaving it would make the question silently vanish.
    const corrected = { ...trigger, options: ['Partnered', 'Single'] };
    expect(repairBranchRules([trigger, follow], corrected)[1]?.branch).toBeUndefined();
  });

  it('keeps only the surviving values of an equalsAny rule', () => {
    const any: Question = {
      ...follow,
      branch: { whenQuestionId: 'q1', equalsAny: ['Yes', 'No'], action: 'show' },
    };
    const corrected = { ...trigger, options: ['Yes', 'Single'] };
    expect(repairBranchRules([trigger, any], corrected)[1]?.branch?.equalsAny).toEqual(['Yes']);
  });

  it('replaceQuestion swaps by id and repairs branches in one pass', () => {
    const corrected = { ...trigger, options: ['Partnered', 'Single'] };
    const out = replaceQuestion([trigger, follow], corrected);
    expect(out[0]?.options).toEqual(['Partnered', 'Single']);
    expect(out[1]?.branch).toBeUndefined();
  });
});

describe('resolveFactCorrection', () => {
  it('returns a CORRECTED QUESTION and maps the matched index to its KnownFact', async () => {
    const reply = JSON.stringify({
      problem: 'wrongFact',
      matchedIndex: 2,
      question: {
        id: 'q1',
        type: 'singleChoice',
        prompt: 'How has your view of ambition shifted?',
        required: true,
        options: ['Sharper', 'Softer', 'About the same'],
      },
    });
    const res = await resolveFactCorrection(deps(memFileSystem(), fakeClient(reply)), {
      question: choiceQ,
      correction: 'I’m 41, not 39.',
      knownFacts: facts,
    });
    expect(res.ok).toBe(true);
    expect(res.question?.options).toEqual(['Sharper', 'Softer', 'About the same']);
    expect(res.matched?.factId).toBe('f1');
  });

  it('sends the WHOLE question to the model — a prompt-only call could never fix the answers', async () => {
    const reply = JSON.stringify({ problem: 'other', matchedIndex: 0, question: choiceQ });
    await resolveFactCorrection(deps(memFileSystem(), fakeClient(reply)), {
      question: choiceQ,
      correction: 'wrong',
      knownFacts: facts,
    });
    expect(lastUser).toContain('It’s sharper at 39');
    expect(lastUser).toContain('"type": "singleChoice"');
  });

  it('“the answers don’t fit” never resolves to a record — nothing on file is disputed (§32.7)', async () => {
    // The reported bug: objecting to the ANSWERS produced a "which of your records is wrong?" picker.
    const reply = JSON.stringify({
      problem: 'answersDontFit',
      matchedIndex: 2, // even if the model guesses one, it must be ignored
      question: {
        id: 'q1',
        type: 'singleChoice',
        prompt: 'Which pull is stronger right now?',
        required: true,
        options: ['Staying in control', 'Handing it over', 'Neither, it varies'],
      },
    });
    const res = await resolveFactCorrection(deps(memFileSystem(), fakeClient(reply)), {
      question: choiceQ,
      correction: 'the answers dont match the question',
      knownFacts: facts,
    });
    expect(res.problem).toBe('answersDontFit');
    expect(res.matched).toBeUndefined();
    expect(res.question?.options).toContain('Neither, it varies');
  });

  it('proposes a corrected value only for a matched PROFILE field', async () => {
    const q = { id: 'q1', type: 'shortText', prompt: 'p', required: false };
    const withValue = JSON.stringify({
      problem: 'wrongFact',
      matchedIndex: 1,
      question: q,
      correctedValue: '1985-05-14',
    });
    const profileRes = await resolveFactCorrection(deps(memFileSystem(), fakeClient(withValue)), {
      question: choiceQ,
      correction: 'I was born in 1985.',
      knownFacts: facts,
    });
    expect(profileRes.proposedValue).toBe('1985-05-14');

    const insightReply = JSON.stringify({
      problem: 'wrongFact',
      matchedIndex: 2,
      question: q,
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

  it('reports an honest failure rather than persisting a broken question', async () => {
    const broken = JSON.stringify({
      problem: 'answersDontFit',
      matchedIndex: 0,
      question: { id: 'q1', type: 'singleChoice', prompt: 'p', required: true, options: [] },
    });
    const res = await resolveFactCorrection(deps(memFileSystem(), fakeClient(broken)), {
      question: choiceQ,
      correction: 'nope',
      knownFacts: facts,
    });
    expect(res.ok).toBe(false);
    expect(res.question).toBeUndefined();

    const garbage = await resolveFactCorrection(deps(memFileSystem(), fakeClient('sorry, no')), {
      question: choiceQ,
      correction: 'nope',
      knownFacts: facts,
    });
    expect(garbage.ok).toBe(false);
    expect(garbage.reason).toBeDefined();
  });
});

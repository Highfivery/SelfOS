import { describe, expect, it } from 'vitest';
import type { IntakeSectionMeta } from '@shared/channels';
import {
  intakeQuestionTotals,
  isAnswered,
  onboardingAttention,
  overallProgress,
  sectionProgress,
} from './progress';
import type { IntakeSectionStatus } from './progress';

const meta = (over: Partial<IntakeSectionMeta>): IntakeSectionMeta => ({
  id: 'x',
  title: 'X',
  blurb: '',
  restricted: false,
  adult: false,
  tier: 'invited',
  mode: 'form',
  opener: '',
  ...over,
});

describe('isAnswered', () => {
  it('treats empty string / list / object / nullish as unanswered, real values as answered', () => {
    expect(isAnswered(undefined)).toBe(false);
    expect(isAnswered('')).toBe(false);
    expect(isAnswered('  ')).toBe(false);
    expect(isAnswered([])).toBe(false);
    expect(isAnswered({})).toBe(false);
    expect(isAnswered('hi')).toBe(true);
    expect(isAnswered(['a'])).toBe(true);
    expect(isAnswered(0)).toBe(true); // a rating/slider of 0 is a real answer
    expect(isAnswered(false)).toBe(true); // a "No" is a real answer
    expect(isAnswered({ row: 3 })).toBe(true);
  });
});

describe('sectionProgress', () => {
  const section = meta({
    questions: [
      { id: 'a', type: 'shortText', prompt: 'A', required: false },
      { id: 'b', type: 'singleChoice', prompt: 'B', required: false, options: ['Yes', 'No'] },
      { id: 'c', type: 'longText', prompt: 'C', required: false },
    ],
  });

  it('counts answered vs total visible questions', () => {
    expect(sectionProgress(section, { a: 'hello', b: 'Yes' })).toEqual({ answered: 2, total: 3 });
    expect(sectionProgress(section, {})).toEqual({ answered: 0, total: 3 });
  });

  it('a chat-only section (no questions) reports 0/0', () => {
    expect(sectionProgress(meta({ questions: undefined as never }), {})).toEqual({
      answered: 0,
      total: 0,
    });
  });

  it('excludes branch-hidden questions from the total (branch-aware)', () => {
    const branched = meta({
      questions: [
        { id: 'trigger', type: 'yesNo', prompt: 'T', required: false },
        {
          id: 'followup',
          type: 'shortText',
          prompt: 'F',
          required: false,
          branch: { whenQuestionId: 'trigger', equals: true, action: 'show' },
        },
      ],
    });
    // The follow-up is hidden until the trigger is true → only 1 question counts.
    expect(sectionProgress(branched, { trigger: false })).toEqual({ answered: 1, total: 1 });
    // Trigger true → the follow-up appears → 2 total, 1 answered.
    expect(sectionProgress(branched, { trigger: true })).toEqual({ answered: 1, total: 2 });
  });
});

describe('intakeQuestionTotals', () => {
  const metas = [
    meta({
      id: 's1',
      questions: [
        { id: 'a', type: 'shortText', prompt: 'A', required: false },
        { id: 'b', type: 'shortText', prompt: 'B', required: false },
      ],
    }),
    meta({
      id: 's2',
      questions: [{ id: 'c', type: 'shortText', prompt: 'C', required: false }],
    }),
    meta({ id: 's3', mode: 'chat' }), // chat-only (no questions) → 0/0
  ];

  it('sums answered / total across sections, branch-aware', () => {
    const sectionFor = (id: string) =>
      ({ s1: { answers: { a: 'x' } }, s2: { answers: { c: 'y' } } })[id] ?? { answers: {} };
    expect(intakeQuestionTotals(metas, sectionFor)).toEqual({ answered: 2, total: 3 });
  });

  it('excludes intentionally-skipped sections from the totals', () => {
    const sectionFor = (id: string) =>
      ({
        s1: { status: 'skipped' as const, answers: {} },
        s2: { answers: { c: 'y' } },
      })[id] ?? { answers: {} };
    // s1 (2 questions) is skipped → excluded entirely; only s2 counts.
    expect(intakeQuestionTotals(metas, sectionFor)).toEqual({ answered: 1, total: 1 });
  });
});

describe('onboardingAttention (55) — new + left-blank only', () => {
  const q = (id: string): { id: string; type: 'shortText'; prompt: string; required: false } => ({
    id,
    type: 'shortText',
    prompt: id,
    required: false,
  });
  // A full snapshot of the two-section catalog below, so nothing reads as "new" unless deliberately omitted.
  const fullSnapshot = {
    adultAcknowledged: true,
    knownSectionIds: ['s1', 's2', 'story'],
    knownQuestionKeys: ['s1.a', 's1.b', 's2.c'],
  };

  it('flags a blank ONLY in a section left inProgress (started, not finished)', () => {
    const metas = [meta({ id: 's1', questions: [q('a'), q('b')] })];
    // inProgress with `b` left blank → an unfinished section → flagged.
    expect(
      onboardingAttention(
        metas,
        () => ({ status: 'inProgress', answers: { a: 'x' } }),
        fullSnapshot,
      ),
    ).toEqual({ areas: ['s1'], total: 1 });
    // A COMPLETE section's known blank is an intentional optional skip → NOT flagged (no nagging).
    expect(
      onboardingAttention(metas, () => ({ status: 'complete', answers: { a: 'x' } }), fullSnapshot)
        .total,
    ).toBe(0);
    // The same blank in a not-yet-started deep section → NOT flagged (no nagging about un-started catalog).
    expect(
      onboardingAttention(metas, () => ({ status: 'notStarted', answers: {} }), fullSnapshot).total,
    ).toBe(0);
    // A skipped section's old blanks are also not flagged (they declined it).
    expect(
      onboardingAttention(metas, () => ({ status: 'skipped', answers: {} }), fullSnapshot).total,
    ).toBe(0);
  });

  it('flags a genuinely-new question (∉ snapshot) even in a not-started section', () => {
    // s2.c exists but is absent from this snapshot → an app update added it after completion.
    const metas = [meta({ id: 's2', questions: [q('c')] })];
    const snap = {
      adultAcknowledged: true,
      knownSectionIds: ['s2'],
      knownQuestionKeys: [] as string[],
    };
    expect(onboardingAttention(metas, () => ({ status: 'notStarted', answers: {} }), snap)).toEqual(
      { areas: ['s2'], total: 1 },
    );
  });

  it('flags a whole new section (all its questions ∉ snapshot)', () => {
    const metas = [
      meta({ id: 's1', questions: [q('a')] }), // known + answered
      meta({ id: 'brandnew', questions: [q('x'), q('y')] }), // absent from snapshot
    ];
    const snap = { adultAcknowledged: true, knownSectionIds: ['s1'], knownQuestionKeys: ['s1.a'] };
    const a = onboardingAttention(
      metas,
      (id) =>
        id === 's1'
          ? { status: 'complete', answers: { a: 'v' } }
          : { status: 'notStarted', answers: {} },
      snap,
    );
    expect(a.total).toBe(2);
    expect(a.areas).toEqual(['brandnew']);
  });

  it('flags a NEW chat section un-started (1 topic), never an old un-started one', () => {
    const metas = [meta({ id: 'story', mode: 'chat', questions: undefined as never })];
    // Not in snapshot → new → 1.
    expect(
      onboardingAttention(metas, () => ({ status: 'notStarted', answers: {} }), {
        adultAcknowledged: true,
        knownSectionIds: [],
        knownQuestionKeys: [],
      }).total,
    ).toBe(1);
    // In snapshot (old) + un-started → not flagged.
    expect(
      onboardingAttention(metas, () => ({ status: 'notStarted', answers: {} }), fullSnapshot).total,
    ).toBe(0);
  });

  it('never counts branch-hidden follow-ups', () => {
    const metas = [
      meta({
        id: 's1',
        questions: [
          { id: 'trigger', type: 'yesNo', prompt: 'T', required: false },
          {
            id: 'followup',
            type: 'shortText',
            prompt: 'F',
            required: false,
            branch: { whenQuestionId: 'trigger', equals: true, action: 'show' },
          },
        ],
      }),
    ];
    const snap = {
      adultAcknowledged: true,
      knownSectionIds: ['s1'],
      knownQuestionKeys: ['s1.trigger', 's1.followup'],
    };
    // Engaged (inProgress); trigger "No" → follow-up hidden → nothing outstanding.
    expect(
      onboardingAttention(
        metas,
        () => ({ status: 'inProgress', answers: { trigger: false } }),
        snap,
      ).total,
    ).toBe(0);
    // Trigger "Yes" → follow-up visible + blank + engaged → 1 outstanding.
    expect(
      onboardingAttention(metas, () => ({ status: 'inProgress', answers: { trigger: true } }), snap)
        .total,
    ).toBe(1);
  });

  it('excludes an 18+ section until the ack is given, then includes its new/blank items', () => {
    const metas = [meta({ id: 'intimacy', adult: true, questions: [q('a')] })];
    // Engaged so the blank would count once unlocked.
    const sectionFor = () => ({ status: 'inProgress' as const, answers: {} });
    const snap = { knownSectionIds: ['intimacy'], knownQuestionKeys: ['intimacy.a'] };
    expect(
      onboardingAttention(metas, sectionFor, { adultAcknowledged: false, ...snap }).total,
    ).toBe(0);
    expect(onboardingAttention(metas, sectionFor, { adultAcknowledged: true, ...snap }).total).toBe(
      1,
    );
  });

  it('with NO snapshot, nothing reads as new — only engaged blanks count (pre-55, un-baselined)', () => {
    const metas = [
      meta({ id: 's1', questions: [q('a')] }),
      meta({ id: 's2', questions: [q('c')] }),
    ];
    // s1 engaged with a blank → counts; s2 not-started → would only count if "new", but no snapshot → not new.
    const a = onboardingAttention(
      metas,
      (id) =>
        id === 's1' ? { status: 'inProgress', answers: {} } : { status: 'notStarted', answers: {} },
      { adultAcknowledged: true }, // no knownSectionIds/knownQuestionKeys
    );
    expect(a.total).toBe(1);
    expect(a.areas).toEqual(['s1']);
  });

  it('is 0 when engaged sections are fully answered and nothing is new', () => {
    const metas = [meta({ id: 's1', questions: [q('a')] })];
    expect(
      onboardingAttention(metas, () => ({ status: 'complete', answers: { a: 'x' } }), fullSnapshot)
        .total,
    ).toBe(0);
  });
});

describe('overallProgress', () => {
  const metas = [meta({ id: 's1' }), meta({ id: 's2' }), meta({ id: 's3' }), meta({ id: 's4' })];
  it('counts completed + skipped out of all sections and a completed %', () => {
    const status = new Map<string, IntakeSectionStatus>([
      ['s1', 'complete'],
      ['s2', 'skipped'],
      ['s3', 'complete'],
    ]);
    expect(overallProgress(metas, (id) => status.get(id))).toEqual({
      completed: 2,
      skipped: 1,
      total: 4,
      pct: 50,
    });
  });
});

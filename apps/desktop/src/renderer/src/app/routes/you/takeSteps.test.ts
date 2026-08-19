import { describe, expect, it } from 'vitest';

import { nextStepAfter, stepStatuses, TAKE_STEPS, type StepInput } from './takeSteps';

/**
 * 74 §3.6.9 — the step model. These pin the cases the walk turned up, all of which were reachable in the old
 * one-way chain and none of which were visible on screen.
 */

const BASE: StepInput = {
  phase: 'names',
  closed: new Set<string>(),
  skipped: [],
  nameMarks: 0,
  bankMarks: 0,
  lineReactions: 0,
  probesAnswered: 0,
  scenariosAnswered: 0,
  momentCategories: 6,
  loved: 0,
  seeded: { names: 0, bank: 0 },
  identityAnswered: false,
};

/** Enough marked material for a generating step to be worth running (74 §3.6.9). */
const ENOUGH = { bankMarks: 20, loved: 5 };

const byId = (input: StepInput) =>
  Object.fromEntries(stepStatuses(input).map((status) => [status.step.id, status]));

describe('stepStatuses', () => {
  it('names every step, in order, with the AI ones marked', () => {
    expect(TAKE_STEPS.map((step) => step.id)).toEqual([
      // Who you both are is the FIRST step, not a prerequisite hidden behind the second one — it decides which
      // half of a 1,000-line bank a person ever sees.
      'identity',
      'names',
      'bank',
      'lines',
      'probe',
      'scenario',
      'profile',
    ]);
    expect(TAKE_STEPS.filter((step) => step.ai).map((step) => step.id)).toEqual([
      'lines',
      'probe',
      'scenario',
      'profile',
    ]);
  });

  it('blocks every step that has nothing to work from — the whole point of the rail not being a trap', () => {
    const steps = byId(BASE);
    // The two marking steps are always reachable: they are where the material comes from.
    expect(steps.names?.state).toBe('now');
    expect(steps.bank?.state).toBe('open');
    for (const id of ['lines', 'probe', 'scenario', 'profile'] as const) {
      expect(steps[id]?.state).toBe('blocked');
      expect(steps[id]?.reason).toMatch(/marks first/i);
    }
  });

  it('keeps a GENERATING step blocked until there is enough to write from, and says how much more', () => {
    // The reported problem: you could answer two or three things and run the AI on them, which is not useful —
    // the model has nothing of yours to draw on, so it writes from its own defaults and charges for it.
    const thin = byId({ ...BASE, nameMarks: 1, loved: 1 });
    expect(thin.lines?.state).toBe('blocked');
    expect(thin.lines?.reason).toMatch(/14 more marks/);
    expect(thin.scenario?.state).toBe('blocked');
    // …and so does the profile: being unable to finish is worse than a thin profile, and the report is honest
    // about working from little.
    expect(thin.profile?.state).toBe('open');
  });

  it('blocks on the LOVED count too — a page of hard nos is not material to write from', () => {
    const allNos = byId({ ...BASE, bankMarks: 30, loved: 0 });
    expect(allNos.lines?.state).toBe('blocked');
    expect(allNos.lines?.reason).toMatch(/3 more you.d want/);
  });

  it('opens every step once there is enough', () => {
    const steps = byId({ ...BASE, ...ENOUGH });
    expect(steps.lines?.state).toBe('open');
    expect(steps.probe?.state).toBe('open');
    expect(steps.scenario?.state).toBe('open');
  });

  it('ticks a step that stamped a turn, and counts marks in the same unit for every step', () => {
    const steps = byId({
      ...BASE,
      phase: 'lines',
      closed: new Set(['names', 'bank']),
      nameMarks: 68,
      bankMarks: 216,
      loved: 40,
      lineReactions: 2,
    });
    expect(steps.names).toMatchObject({ state: 'done', count: 68 });
    expect(steps.bank).toMatchObject({ state: 'done', count: 216 });
    expect(steps.lines).toMatchObject({ state: 'now', count: 2 });
  });

  it('shows a skip as a skip, and never as the step you are standing on', () => {
    const steps = byId({
      ...BASE,
      phase: 'probe',
      ...ENOUGH,
      skipped: ['lines', 'probe'],
    });
    expect(steps.lines?.state).toBe('skipped');
    // Being ON a step wins: a row reading "skipped" while you are inside it is the app disagreeing with itself.
    expect(steps.probe?.state).toBe('now');
  });

  it('keeps the step you are on visible even when it has nothing to work from', () => {
    // Arriving early must not make the current step disappear from the rail's "now" slot — the frame is what
    // explains the block, and it can only do that if it knows it is current.
    const steps = byId({ ...BASE, phase: 'lines' });
    expect(steps.lines?.state).toBe('now');
    expect(steps.lines?.reason).toMatch(/marks first/i);
  });
});

describe('this sitting vs on record', () => {
  it("separates a retake's carried-over marks from what was marked today", () => {
    // Marks live in ONE lexicon across takes, so a retake opens with last time's already seeded. One number
    // would be standing for the other — "68" whether they marked 68 today or 68 last month.
    const steps = byId({
      ...BASE,
      phase: 'bank',
      nameMarks: 68,
      bankMarks: 216,
      loved: 30,
      seeded: { names: 60, bank: 200 },
    });
    expect(steps.names).toMatchObject({ count: 68, fresh: 8 });
    expect(steps.bank).toMatchObject({ count: 216, fresh: 16 });
  });

  it("says nothing about it on a FIRST take, where every mark is this sitting's", () => {
    const steps = byId({ ...BASE, phase: 'bank', nameMarks: 4, bankMarks: 20, loved: 6 });
    expect(steps.names?.fresh).toBeUndefined();
    expect(steps.bank?.fresh).toBeUndefined();
  });
});

describe('nextStepAfter', () => {
  it('skips over a blocked step rather than offering a dead end', () => {
    const statuses = stepStatuses({ ...BASE, phase: 'names' });
    // Nothing marked ⇒ everything after the words is blocked, so "next" from the names is the words.
    expect(nextStepAfter(statuses, 'names')?.step.id).toBe('bank');
    expect(nextStepAfter(statuses, 'bank')).toBeNull();
  });

  it('walks in order once there is material', () => {
    const statuses = stepStatuses({ ...BASE, phase: 'bank', ...ENOUGH });
    expect(nextStepAfter(statuses, 'bank')?.step.id).toBe('lines');
    expect(nextStepAfter(statuses, 'scenario')?.step.id).toBe('profile');
    expect(nextStepAfter(statuses, 'profile')).toBeNull();
  });
});

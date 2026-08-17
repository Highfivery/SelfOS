import { generationReadiness, type GenerationReadiness } from '@selfos/core/schemas';
import type { TakePhase } from '../../../stores/adaptiveTestStore';

/**
 * 74 §3.6.9 — the take as seven named steps, so a person can see the shape of it and move around inside it.
 *
 * Before this, the take was a one-way chain: the only way through was the primary button, `setPhase` was called
 * exactly twice in the whole screen (both times to return to `address`), and a resumed take dropped you
 * straight into whichever AI phase you happened to have reached with no route back to your own words. Opening
 * it said "What do you call each other?" and gave no indication anything followed.
 *
 * This module is the one source of truth for what the steps ARE and what state each is in, so the rail, the map
 * and the per-step frames can never disagree about it (the §7 coherence rule).
 */

export type StepId = Exclude<TakePhase, 'intro' | 'map' | 'address' | 'done'> | 'profile';

export interface TakeStep {
  id: StepId;
  /** The phase to enter. `profile` is the synthesis, which has no phase of its own until it finishes. */
  label: string;
  /**
   * What the RAIL shows. The full label is the button's accessible name either way — a 232px column truncated
   * "What you call each other" to "What you call each ot…", which names nothing.
   */
  short: string;
  /** One line on the map: what the step actually asks of them. */
  blurb: string;
  /** Whether entering it can spend their AI allowance — stated up front, never discovered afterwards. */
  ai: boolean;
  /** Anything that happens before the step proper, said on the map rather than sprung on them. */
  note?: string;
}

export const TAKE_STEPS: readonly TakeStep[] = [
  {
    id: 'names',
    label: 'What you call each other',
    short: 'Pet names',
    blurb: 'Pet names, both ways — what you like being called, and what you like calling them.',
    ai: false,
  },
  {
    id: 'bank',
    label: 'The words',
    short: 'The words',
    blurb: 'The vocabulary, one area at a time. Mark what lands; skip the rest.',
    ai: false,
    note: 'Asks who you both are first, then two practice taps.',
  },
  {
    id: 'split',
    label: 'Hearing it, or saying it',
    short: 'Hear or say',
    blurb: 'For what you marked: how much you want to hear it, and how much to say it.',
    ai: false,
  },
  {
    id: 'lines',
    label: 'Lines written for you',
    short: 'Lines for you',
    blurb: 'Real lines in your own register. You say which ones you would actually want said.',
    ai: true,
  },
  {
    id: 'probe',
    label: 'The questions it still has',
    short: 'Its questions',
    blurb: 'Where your marks could mean two things, it asks — in words, not buttons.',
    ai: true,
  },
  {
    id: 'scenario',
    label: 'In the moment',
    short: 'In the moment',
    blurb: 'What lands mid-act is wrong at 2pm, so this asks per moment.',
    ai: true,
  },
  {
    id: 'profile',
    label: 'Your profile',
    short: 'Your profile',
    blurb: 'Everything you marked, read back to you.',
    ai: true,
    note: 'Works without AI too — you get the honest short version.',
  },
];

export type StepState =
  /** Closed: a turn was stamped for it. */
  | 'done'
  /** Where they are. */
  | 'now'
  /** Reachable, not started. */
  | 'open'
  /** Deliberately passed over in this sitting. */
  | 'skipped'
  /** Cannot run yet, and says why rather than failing after the tap. */
  | 'blocked';

export interface StepStatus {
  step: TakeStep;
  state: StepState;
  /** Marks made in this step — the SAME unit for every step, so the rail's numbers are comparable. */
  count: number;
  /** Work that appeared after they left the step (marks added later still need splitting). */
  outstanding?: number;
  /** Why it is blocked, in their terms. */
  reason?: string;
}

export interface StepInput {
  phase: TakePhase;
  /** Phases with a stamped turn — a turn means the pass closed. */
  closed: ReadonlySet<string>;
  skipped: readonly StepId[];
  nameMarks: number;
  bankMarks: number;
  /** Entries still owed the hear/say question, and how many of those have an answer. */
  splitNeeded: number;
  splitAnswered: number;
  lineReactions: number;
  probesAnswered: number;
  scenariosAnswered: number;
  /** Marks that were a yes — a lexicon of nothing but hard nos gives a generator nothing to write from. */
  loved: number;
}

/** What a step that cannot run yet says, in their terms — never a bare refusal. */
function shortfall(readiness: GenerationReadiness): string {
  if (readiness.moreMarks > 0) return `${readiness.moreMarks} more marks`;
  return `${readiness.moreLoved} more you'd want`;
}

/**
 * The state of every step, in order. Pure, so the rail/map/frames read one answer and the tests can pin the
 * awkward cases (arriving early, coming back after adding marks, skipping) without a DOM.
 */
export function stepStatuses(input: StepInput): StepStatus[] {
  const marked = input.nameMarks + input.bankMarks;
  // 74 §3.6.9 — enough to work FROM, not merely something. Two or three marks leave a generating step falling
  // back on the model's own defaults, which is the generic output the test exists to avoid, charged for.
  const readiness = generationReadiness(marked, input.loved);
  const countOf = (id: StepId): number => {
    switch (id) {
      case 'names':
        return input.nameMarks;
      case 'bank':
        return input.bankMarks;
      case 'split':
        return input.splitAnswered;
      case 'lines':
        return input.lineReactions;
      case 'probe':
        return input.probesAnswered;
      case 'scenario':
        return input.scenariosAnswered;
      case 'profile':
        return 0;
    }
  };

  return TAKE_STEPS.map((step) => {
    const count = countOf(step.id);
    // Blocked beats everything except being the step you are actually on: a rail that lets you jump anywhere
    // must not offer a tap whose only outcome is an empty screen (or, for an AI step, a paid call that can only
    // come back empty — `testsAdaptiveLines`/`Scenario` reach the model with no marks-guard of their own).
    // The split needs marks; the three generating steps need enough of them. The profile is deliberately NOT
    // gated on the threshold — being unable to finish is worse than a thin profile, and the report already says
    // when it is working from little (it just needs SOMETHING).
    const gate =
      step.id === 'split' || step.id === 'profile'
        ? marked > 0
        : step.id === 'names' || step.id === 'bank'
          ? true
          : readiness.ready;
    if (!gate) {
      return {
        step,
        state: input.phase === step.id ? 'now' : 'blocked',
        count,
        reason:
          marked === 0
            ? 'Needs some marks first'
            : step.id === 'split' || step.id === 'profile'
              ? 'Needs some marks first'
              : shortfall(readiness),
      };
    }
    if (input.phase === step.id || (step.id === 'profile' && input.phase === 'done')) {
      return { step, state: 'now', count };
    }
    if (input.skipped.includes(step.id)) return { step, state: 'skipped', count };
    if (step.id === 'split' && input.closed.has('split')) {
      // The split is recomputed from the marks every time, so going back to the words and marking twenty more
      // leaves a "closed" step with real work in it. A tick there would be quietly out of date.
      const outstanding = Math.max(0, input.splitNeeded - input.splitAnswered);
      return outstanding > 0
        ? { step, state: 'open', count, outstanding }
        : { step, state: 'done', count };
    }
    if (input.closed.has(step.id)) return { step, state: 'done', count };
    return { step, state: 'open', count };
  });
}

/** The next step after this one that is worth offering — skipping over anything blocked. */
export function nextStepAfter(statuses: readonly StepStatus[], from: StepId): StepStatus | null {
  const at = statuses.findIndex((status) => status.step.id === from);
  if (at < 0) return null;
  for (const status of statuses.slice(at + 1)) {
    if (status.state !== 'blocked') return status;
  }
  return null;
}

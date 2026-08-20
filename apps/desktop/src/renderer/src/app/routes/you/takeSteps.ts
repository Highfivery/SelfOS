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

export type StepId =
  | Exclude<TakePhase, 'intro' | 'map' | 'address' | 'done'>
  /** The two identity taps. Its phase is `address` — the id reads as what it asks. */
  | 'identity'
  | 'profile';

/** The phase a step enters. Only the first one differs from its id. */
export function phaseForStep(id: StepId): TakePhase {
  return id === 'identity' ? 'address' : (id as TakePhase);
}

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
    /**
     * 74 §3.6.9 — the FIRST step, not a prerequisite hidden behind the second one. It was reachable only by
     * tapping "The words", which buried the one screen that decides which half of a 1,000-line bank a person
     * ever sees: "IT SHOULD BE THE FIRST STEP IN THE WHOLE PROCESS".
     */
    id: 'identity',
    label: 'Who you two are',
    short: 'Who you are',
    blurb: 'Two taps, so the words you see are ones that could be said between the two of you.',
    ai: false,
  },
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
    blurb:
      'The vocabulary, one area at a time — marked both ways at once: hearing it, and saying it.',
    ai: false,
    note: 'Starts with two practice taps.',
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
  /** How much has been done in this step. */
  count: number;
  /**
   * What `count` COUNTS, so the rail can say it.
   *
   * The doc here used to claim one unit for every step "so the rail's numbers are comparable", and they never
   * were: 132 marks sat next to 6 answered questions next to 8 moment picks, three different things wearing
   * one bare number. Naming the unit is what makes them readable side by side.
   */
  unit?: string;
  /** The denominator where the step has one — moments are 2 of 6, not 2. */
  outOf?: number;
  /**
   * How many of those were made in THIS sitting. Marks live in one lexicon across takes, so a retake opens with
   * last time's already on record; where the two differ, both are shown rather than one standing for the other.
   */
  fresh?: number;
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
  lineReactions: number;
  probesAnswered: number;
  scenariosAnswered: number;
  /** What was already on record when this sitting opened, for the two marking steps. */
  seeded: { names: number; bank: number };
  /** How many moment CATEGORIES have at least one answer, and how many there are (74 §3.6.19). */
  momentCategories: number;
  /** Whether the two identity taps have been answered — that step's "done", since it stamps no turn. */
  identityAnswered: boolean;
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
/**
 * 74 §3.6.34 — how many MARKS this person has, from the step statuses.
 *
 * The map summed every counted step and called the total "N marks so far" — and, on the retake screen, "You
 * have N marks on record from last time", which is the number someone weighs when deciding whether to keep
 * them or start from an empty sheet. Three of the five counted steps are not marks: line reactions, answered
 * probe questions and worked moment categories. `TakeMap`'s own `doneLabel` docstring already said why they
 * cannot be added — "132 marks beside 6 answered questions beside 8 moment picks is three different things
 * wearing one bare number" — which is exactly what `unit` was added for.
 *
 * So the unit decides, and it lives here beside `unitOf` rather than as a set of magic strings at the call
 * site. The two marking steps partition the lexicon between them, so their sum is the real count.
 */
const MARK_UNITS: ReadonlySet<string> = new Set(['names', 'words']);

export function markCount(statuses: readonly StepStatus[]): number {
  return statuses.reduce(
    (sum, status) => (status.unit && MARK_UNITS.has(status.unit) ? sum + status.count : sum),
    0,
  );
}

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
      case 'lines':
        return input.lineReactions;
      case 'probe':
        return input.probesAnswered;
      case 'scenario':
        return input.scenariosAnswered;
      case 'identity':
      case 'profile':
        return 0;
    }
  };

  /** What this step's number means, in the person's words. */
  const unitOf = (id: StepId): { unit?: string; outOf?: number } => {
    switch (id) {
      case 'names':
        return { unit: 'names' };
      case 'bank':
        return { unit: 'words' };
      case 'lines':
        return { unit: 'lines' };
      case 'probe':
        return { unit: 'asked' };
      case 'scenario':
        // 74 §3.6.19 — a moment count on its own is meaningless (8 of what?). The denominator is the six
        // categories, which is the thing a person is actually working through.
        return { unit: 'moments', outOf: input.momentCategories };
      default:
        return {};
    }
  };

  const freshOf = (id: StepId): number | undefined => {
    if (id === 'names') return Math.max(0, input.nameMarks - input.seeded.names);
    if (id === 'bank') return Math.max(0, input.bankMarks - input.seeded.bank);
    return undefined;
  };

  // Annotated, or the trailing `.map` below strips the contextual typing and every `state` widens to string.
  return TAKE_STEPS.map((step): StepStatus => {
    const count = countOf(step.id);
    const freshCount = freshOf(step.id);
    // Only worth saying when it differs — on a first take every mark IS this sitting's.
    const fresh = freshCount !== undefined && freshCount !== count ? { fresh: freshCount } : {};
    // Blocked beats everything except being the step you are actually on: a rail that lets you jump anywhere
    // must not offer a tap whose only outcome is an empty screen (or, for an AI step, a paid call that can only
    // come back empty — `testsAdaptiveLines`/`Scenario` reach the model with no marks-guard of their own).
    // The three generating steps need enough marks. The profile is deliberately NOT
    // gated on the threshold — being unable to finish is worse than a thin profile, and the report already says
    // when it is working from little (it just needs SOMETHING).
    const gate =
      step.id === 'profile'
        ? marked > 0
        : step.id === 'identity' || step.id === 'names' || step.id === 'bank'
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
            : step.id === 'profile'
              ? 'Needs some marks first'
              : shortfall(readiness),
      };
    }
    if (
      input.phase === phaseForStep(step.id) ||
      (step.id === 'profile' && (input.phase === 'done' || input.phase === 'profile'))
    ) {
      return { step, state: 'now', count, ...fresh };
    }
    // The identity step stamps no turn — its "done" is simply having answered it.
    if (step.id === 'identity') {
      return { step, state: input.identityAnswered ? 'done' : 'open', count };
    }
    if (input.skipped.includes(step.id)) return { step, state: 'skipped', count, ...fresh };
    if (input.closed.has(step.id)) return { step, state: 'done', count, ...fresh };
    return { step, state: 'open', count, ...fresh };
  }).map((status): StepStatus => ({ ...status, ...unitOf(status.step.id) }));
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

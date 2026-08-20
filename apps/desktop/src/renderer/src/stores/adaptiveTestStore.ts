import { create } from 'zustand';
// A value, not a type — the marker that distinguishes a recorded SKIP from an answer (74 §3.6.17), shared
// with the bridge so both sides read one definition (`schemas` is the crypto-free half of core).
//
// `probeTurnId` used to be built here too. The BRIDGE mints a question's id now, at the moment the pass is
// recorded (74 §3.6.35), so the renderer answers under the id it was given rather than reconstructing one and
// hoping the two agree.
import { PROBE_SKIPPED, scenarioTurnId } from '@selfos/core/schemas';
import type {
  AdaptiveBankView,
  AdaptiveNamesView,
  AdaptiveLexiconEdit,
  AdaptivePhaseView,
  AdaptiveProbeView,
  AdaptiveScenarioView,
  AdaptiveStateView,
  EroticLexicon,
} from '@shared/schemas';

/**
 * 74 — the adaptive take's renderer state. Per-person, so it resets on a switch like every other
 * person-scoped store (the `personScopedStores` rule).
 *
 * The take is a small state machine over the phases: `bank` → `split` → `lines` → `probe` → `scenario` →
 * `synthesis`. Each phase persists as it completes, so leaving mid-take resumes rather than losing it.
 */

export type TakePhase =
  | 'intro'
  /**
   * 74 §3.6.9 — the map: every step, its state, and a tap into any of them. Shown on the way in and reachable
   * from every step, so the take is never a one-way chain.
   */
  | 'map'
  /**
   * 74 §3.6.4 — the two identity taps. A prerequisite of the WORDS step (it decides which half of the bank is
   * shown), so it is entered from there rather than sprung on someone before they know what the test contains.
   */
  | 'address'
  /** 74 §3.6.8 — the pet-name phase, which runs FIRST: what the two of you call each other. */
  | 'names'
  | 'bank'
  | 'lines'
  | 'probe'
  | 'scenario'
  /**
   * 74 §3.6.16 — the profile step, BEFORE it is written. Tapping "Your profile" used to call `synthesize`
   * straight from the navigation, so the step that spends the most was the one step you could not look at
   * without paying for it — and, once `done`, it had no view of its own and rendered a blank page.
   */
  | 'profile'
  | 'done';

export type BankMark = 'love' | 'never' | 'okay';

/** Long enough that a fast run of taps is one write; short enough that closing the app loses nothing real. */
const AUTOSAVE_DELAY_MS = 700;

/**
 * The autosave's pending work, held OUTSIDE the store: a debounce timer and the delta since the last flush.
 * Keeping it out of zustand means a tap re-renders the one row it changed, not the whole ~1,100-entry grid.
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Pending work, per phase: which SIDES of which keys changed, and which were taken back.
 *
 * One shape for both since §3.6.26 — the deck answers per direction exactly as the pet names always have, so
 * the deck's old `Set<string>` of whole-entry marks plus a third set for the 0–4 split are gone.
 */
type DirtySides = Map<string, Set<'hear' | 'say'>>;
let dirtyMarks: DirtySides = new Map();
let dirtyCleared: DirtySides = new Map();
let dirtyNames: DirtySides = new Map();
let dirtyNameCleared: DirtySides = new Map();

/** Serializes the writes — see `flush`. */
let inFlight: Promise<void> = Promise.resolve();
/**
 * Bumped by every `reset()`. A flush that started before a person switch (or before the take was left) must
 * NOT put its work back into the pending sets afterwards: those keys belong to the previous person's take,
 * and the next flush would carry them into whoever is active now.
 */
let generation = 0;
/** Un-marks made anywhere in this take, so the closing call can carry them (an absent key undoes nothing). */
let clearedThisTake: DirtySides = new Map();

function resetPending(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  generation += 1;
  // Start a fresh chain. The old one may still be waiting on a call that never settles (a wedged IPC), and
  // every later save queues behind it — so a single hung write would silently stop autosaving for good.
  inFlight = Promise.resolve();
  dirtyMarks = new Map();
  dirtyCleared = new Map();
  dirtyNames = new Map();
  dirtyNameCleared = new Map();
  clearedThisTake = new Map();
}

/** A mark map keyed by entry, each side answered independently. Both phases use it. */
type DirectionalMarks = Record<string, { hear?: BankMark; say?: BankMark }>;

/** Record a side as pending (or as taken back), keeping the two maps mutually exclusive per side. */
function markPending(
  dirty: DirtySides,
  cleared: DirtySides,
  key: string,
  side: 'hear' | 'say',
): void {
  const sides = dirty.get(key) ?? new Set<'hear' | 'say'>();
  const clearedSides = cleared.get(key) ?? new Set<'hear' | 'say'>();
  sides.add(side);
  clearedSides.delete(side);
  dirty.set(key, sides);
  if (clearedSides.size > 0) cleared.set(key, clearedSides);
  else cleared.delete(key);
}

function clearPending(
  dirty: DirtySides,
  cleared: DirtySides,
  key: string,
  side: 'hear' | 'say',
): void {
  const sides = dirty.get(key) ?? new Set<'hear' | 'say'>();
  const clearedSides = cleared.get(key) ?? new Set<'hear' | 'say'>();
  sides.delete(side);
  clearedSides.add(side);
  cleared.set(key, clearedSides);
  if (sides.size > 0) dirty.set(key, sides);
  else dirty.delete(key);
}

/**
 * Toggle one direction of one entry. Tapping the mark that is already set takes it back.
 *
 * Shared by the deck and the pet names: since §3.6.26 they do the same thing to different slices of state,
 * and keeping two copies is how one of them grows a fix the other never gets.
 */
function toggleMark(
  prev: DirectionalMarks,
  key: string,
  side: 'hear' | 'say',
  mark: BankMark,
  dirty: DirtySides,
  cleared: DirtySides,
): DirectionalMarks {
  // A no is a preference (74 §3.2, amended 2026-08-19): re-markable in any sitting, in either direction,
  // exactly like every other mark.
  const current = prev[key] ?? {};
  const next = { ...current };
  const takenBack = current[side] === mark;
  if (takenBack) delete next[side];
  else next[side] = mark;
  const marks = { ...prev };
  if (Object.keys(next).length === 0) delete marks[key];
  else marks[key] = next;
  if (takenBack) clearPending(dirty, cleared, key, side);
  else markPending(dirty, cleared, key, side);
  return marks;
}

/** The pending delta for one phase: only the sides that actually changed, and only where a mark survives. */
function deltaFor(dirty: DirtySides, marks: DirectionalMarks): DirectionalMarks {
  const out: DirectionalMarks = {};
  for (const [key, sides] of dirty) {
    const current = marks[key];
    const mark: { hear?: BankMark; say?: BankMark } = {};
    for (const side of sides) {
      const value = current?.[side];
      if (value) mark[side] = value;
    }
    if (Object.keys(mark).length > 0) out[key] = mark;
  }
  return out;
}

/** `Map<key, Set<side>>` → the wire shape the bridge takes. */
function clearedFor(cleared: DirtySides): Record<string, ('hear' | 'say')[]> {
  const out: Record<string, ('hear' | 'say')[]> = {};
  for (const [key, sides] of cleared) out[key] = [...sides];
  return out;
}

type Get = () => AdaptiveTestState;
type Set_ = (patch: Partial<AdaptiveTestState>) => void;

/**
 * One flush. Split out of the store so `flush` can queue calls to it without re-entering the store action.
 *
 * Every bridge handler returns `null` when its gate refuses (`tests.own` revoked, the 18+ ack withdrawn, an
 * unknown test id) — which is NOT a throw, so treating "no exception" as success would show "Saved" over a
 * write that never happened. That is the worst possible lie for this feature, so `null` is a failure.
 */
async function runFlush(testId: string, get: Get, set: Set_): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const mine = generation;
  const { state, marks, nameMarks } = get();
  const resultId = state?.draft?.id;
  const marksDelta = deltaFor(dirtyMarks, marks);
  const cleared = clearedFor(dirtyCleared);
  const namesDelta = deltaFor(dirtyNames, nameMarks);
  const nameCleared = clearedFor(dirtyNameCleared);
  const nothing =
    Object.keys(marksDelta).length === 0 &&
    Object.keys(cleared).length === 0 &&
    Object.keys(namesDelta).length === 0 &&
    Object.keys(nameCleared).length === 0;
  if (nothing) {
    set({ saveState: 'saved' });
    return;
  }
  if (!resultId) {
    // Work pending with nowhere to put it — say so rather than going quiet, which reads as saved.
    set({ saveState: 'unsaved' });
    return;
  }
  // Drained BEFORE the await: a tap during the write belongs to the next flush, not this one.
  dirtyMarks = new Map();
  dirtyCleared = new Map();
  dirtyNames = new Map();
  dirtyNameCleared = new Map();
  let ok = true;
  try {
    if (Object.keys(marksDelta).length > 0 || Object.keys(cleared).length > 0) {
      const res = await window.selfos?.testsAdaptiveBank({
        testId,
        resultId,
        marks: marksDelta,
        cleared,
        autosave: true,
      });
      ok = res !== null && res !== undefined;
    }
    if (ok && (Object.keys(namesDelta).length > 0 || Object.keys(nameCleared).length > 0)) {
      const res = await window.selfos?.testsAdaptiveNames({
        testId,
        resultId,
        marks: namesDelta,
        cleared: nameCleared,
        autosave: true,
      });
      ok = res !== null && res !== undefined;
    }
  } catch {
    ok = false;
  }
  // The store was reset while this was in flight (a person switch, or the take was left). Its keys are the
  // OTHER person's now — drop them rather than re-queueing them into the next person's pending set.
  if (mine !== generation) return;
  if (ok) {
    set({ saveState: 'saved' });
    return;
  }
  const requeue = (
    delta: DirectionalMarks,
    clearedDelta: Record<string, ('hear' | 'say')[]>,
    dirty: DirtySides,
    dirtyClearedSet: DirtySides,
  ): void => {
    for (const [key, mark] of Object.entries(delta)) {
      const sides = dirty.get(key) ?? new Set<'hear' | 'say'>();
      for (const side of ['hear', 'say'] as const) if (mark[side]) sides.add(side);
      dirty.set(key, sides);
    }
    for (const [key, sides] of Object.entries(clearedDelta)) {
      dirtyClearedSet.set(key, new Set(sides));
    }
  };
  requeue(marksDelta, cleared, dirtyMarks, dirtyCleared);
  requeue(namesDelta, nameCleared, dirtyNames, dirtyNameCleared);
  set({ saveState: 'unsaved', error: "Couldn't save that just now — it'll retry." });
}

interface AdaptiveTestState {
  bank: AdaptiveBankView | null;
  state: AdaptiveStateView | null;
  loaded: boolean;
  busy: boolean;
  /** The live AI phase's label + elapsed seconds — the realtime-progress rule (CLAUDE.md §12). */
  progress: { phase: string; startedAt: number } | null;
  error: string | null;

  phase: TakePhase;
  /** Which test is open — the debounced flush fires long after the tap, so it can't close over an argument. */
  activeTestId: string;
  /**
   * Autosave state, for the "Saved" line — never a blocking spinner (a tap must stay instant). `unsaved` is
   * deliberately distinct from `idle`: work that could not be written must never look like nothing happened.
   */
  saveState: 'idle' | 'saving' | 'saved' | 'unsaved';
  /**
   * Keys marked in THIS sitting. A `never` autosaves the instant it is tapped, which would otherwise make the
   * row read "off the table" and lock a mis-tap in place before they could look at it (74 §3.5's settled-
   * boundary display is for marks from EARLIER takes). These stay editable until the take ends.
   */
  touched: string[];
  /** 74 §3.6.26 — the deck, answered per direction. Same shape as `nameMarks`; same writer behind both. */
  marks: DirectionalMarks;
  /** 74 §3.6.8 — the pet-name phase: its registers + names, and two marks per name. */
  names: AdaptiveNamesView | null;
  nameMarks: DirectionalMarks;
  /** Which register is open. `null` ⇒ the grid, which is where the phase starts. */
  openRegister: string | null;
  /**
   * What the lines phase said when it could not produce anything — its words, not a guess.
   *
   * 74 §3.6.35 — the LINES themselves are no longer here. They, the probe's questions and the moments are all
   * read from the take's own turns now, because holding a generated set in renderer state is what made it
   * disposable: `store.lines` was hard-replaced by the next round (and blanked by a FAILED one), it started
   * empty on every load, and the bridge's avoid-list — built from the turns — could not see any of it. The
   * three sets were three copies of one bug.
   */
  linesMessage: string | null;
  lineReactions: Record<string, 'love' | 'meh' | 'no'>;
  /** The probe has nothing left to ask — a real outcome, shown as one, not a silent hop to the next phase. */
  probeDone: boolean;
  /** Why the probe couldn't ask — kept apart from `probeDone`, which is the SUCCESS state. */
  probeMessage: string | null;
  /**
   * 74 §3.6.18 — why the profile couldn't be written. The one AI phase that never carried its own reason, and
   * the one that got reported over and over because of it.
   */
  synthesisMessage: string | null;
  /** Why a moment produced no scene. Without it the tap read as doing nothing at all. */
  scenarioMessage: string | null;
  /**
   * 74 §3.6.9 — how many marks were already on record when this sitting opened, per marking step.
   *
   * Marks live in ONE lexicon across takes, so a retake opens with everything from last time already seeded.
   * Without this the rail says "68" whether they marked 68 today or 68 last month — one number pretending to be
   * the other. Where the two differ the rail shows both.
   */
  seeded: { names: number; bank: number };
  /**
   * 74 §3.6.9 — steps passed over in THIS sitting, so the rail and the profile can say so instead of quietly
   * filling the gap. Deliberately not persisted: a skip is a decision about this sitting, and on a later one the
   * step should simply be open again rather than carrying a stale refusal forward.
   */
  skipped: string[];

  load(testId: string): Promise<void>;
  /** 74 §3.6.35 — re-read the take alone, for the actions that only change its turns. See the impl. */
  refreshState(testId: string): Promise<void>;
  start(testId: string): Promise<void>;
  mark(key: string, side: 'hear' | 'say', mark: BankMark): void;
  /** Load the pet-name phase (free — no AI). */
  loadNames(testId: string): Promise<void>;
  /** Mark one direction of one name. Passing the same mark again takes it back (74 §3.4). */
  markName(key: string, side: 'hear' | 'say', mark: BankMark): void;
  setOpenRegister(id: string | null): void;
  /** Close the phase and move on to the deck. */
  finishNames(testId: string): Promise<void>;
  /** Write whatever is pending right now — on leaving the take, and before closing a pass. */
  flush(testId: string): Promise<void>;
  /** 74 §3.6.4 — record the two address taps, then re-read the bank so it comes back oriented. */
  setAddress(
    testId: string,
    self: 'girl' | 'man' | 'either',
    partner: 'girl' | 'man' | 'either',
    /** Who the two of you are — backs the BODY axis when onboarding has no anatomy answer (§3.6.3). */
    identity?: { self: 'man' | 'woman' | 'either'; partner: 'man' | 'woman' | 'either' },
  ): Promise<void>;
  /**
   * Turn a line they rejected into a THEME boundary (74 §3.6.2). Deliberate and separate from the soft `no`,
   * because a boundary is permanent — `violatesBoundary` blocks any future line whose content words cover the
   * theme, so "beat that pussy" also stops "gonna beat that pussy up".
   */
  banLine(line: string): Promise<void>;
  /**
   * 74 §3.6.35 — take that boundary back.
   *
   * A `never` is a PREFERENCE, not a locked door (§3.2), and this one had no way out: `addBoundary` had no
   * counterpart in core or at the seam, so the tap above minted a suppression that nothing in the app could
   * lift. The marks were fixed for this in §3.2's amendment because their suppression is derived from a live
   * mark; a themed boundary is a standalone record and was left behind.
   */
  unbanLine(line: string): Promise<void>;
  /** Remember the deck position so resuming lands where they stopped (74 §3.6.4). */
  rememberArea(area: number): Promise<void>;
  submitBank(testId: string): Promise<void>;
  loadLines(testId: string, round: number): Promise<void>;
  reactToLine(testId: string, line: string, reaction: 'love' | 'meh' | 'no'): Promise<void>;
  nextProbe(testId: string): Promise<void>;
  /** Record a question as passed over (74 §3.6.17) — it stays visible, and stays answerable. */
  skipProbeQuestion(
    testId: string,
    itemId: string,
    question: string,
    options?: string[],
  ): Promise<void>;
  loadScenario(testId: string, context: string): Promise<void>;
  /** Answer (or re-answer) one moment. The moment itself is passed in — see the implementation. */
  answerScenario(
    testId: string,
    option: string,
    moment: { context: string; scene: string; options: string[] },
  ): Promise<void>;
  /** Change an answer already given (74 §3.6.16) — `stampTurn` replaces by item, so it updates in place. */
  reviseProbeAnswer(
    testId: string,
    itemId: string,
    question: string,
    answer: string,
    /** The question's own options, carried so revising never strips the way to answer it by tapping. */
    options?: string[],
  ): Promise<void>;
  /**
   * Write the profile. `acceptDegraded` finishes on the deterministic half after the written analysis has
   * failed and they have been told why — never the default (74 §3.6.18).
   */
  synthesize(testId: string, resultId?: string, acceptDegraded?: boolean): Promise<void>;
  abandon(testId: string): Promise<void>;
  editLexicon(edit: AdaptiveLexiconEdit): Promise<void>;
  setPhase(phase: TakePhase): void;
  /**
   * 74 §3.6.9 — go to a step from the rail or the map. Entering an AI step must NOT fire its call: with a rail
   * you can reach any step from anywhere, so arrival-fires-the-call would turn a mis-tap into a billed request
   * (and `testsAdaptiveLines`/`Scenario` will write from an empty lexicon if asked). The step frame presents
   * itself and waits to be asked.
   */
  goToStep(id: string): void;
  /** Pass over a step, recording that it was passed over rather than silently jumping. */
  skipStep(id: string, next: string | null): void;
  reset(): void;
}

const EMPTY = {
  bank: null,
  state: null,
  loaded: false,
  busy: false,
  progress: null,
  error: null,
  phase: 'intro' as TakePhase,
  activeTestId: '',
  saveState: 'idle' as 'idle' | 'saving' | 'saved' | 'unsaved',
  touched: [] as string[],
  marks: {},
  names: null,
  nameMarks: {},
  openRegister: null,
  linesMessage: null,
  lineReactions: {},
  probeDone: false,
  probeMessage: null,
  synthesisMessage: null,
  scenarioMessage: null,
  skipped: [] as string[],
  seeded: { names: 0, bank: 0 },
};

/**
 * Where a resumed take picks up (74 §3.4). Without this, coming back after two sittings drops you at the top
 * of a ~1,100-entry bank you already walked — which would make "leave whenever, you'll pick up here" a lie.
 *
 * A stamped turn means that phase CLOSED, so `bank` → split and `split` → lines. The AI phases are many-turned
 * and advance themselves, so they resume where they are.
 */
export function resumePhase(turns: readonly { phase: string }[] | undefined): TakePhase {
  const seen = new Set((turns ?? []).map((turn) => turn.phase));
  if (seen.has('scenario')) return 'scenario';
  if (seen.has('probe')) return 'probe';
  if (seen.has('lines')) return 'lines';
  if (seen.has('bank')) return 'lines';
  // A stamped `names` turn means the pet-name phase closed, so the deck is next (74 §3.6.8).
  if (seen.has('names')) return 'bank';
  return 'names';
}

/**
 * Every async action goes through this. A rejected bridge call used to leave `busy: true` and freeze the
 * take mid-phase with nothing on screen and no route out but quitting the app — which, on a take that
 * autosaves, reads as losing everything you just marked. A failure now stops, says so, and leaves the phase
 * exactly where it was, so the same button is simply tried again.
 *
 * Wrapping at construction rather than per action means a future phase can't quietly reintroduce the
 * dead-end by forgetting a `catch`.
 */
function guardAsync<T extends object>(
  actions: T,
  set: (patch: Partial<AdaptiveTestState>) => void,
): T {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(actions)) {
    if (typeof value !== 'function') {
      out[name] = value;
      continue;
    }
    const fn = value as (...args: unknown[]) => unknown;
    out[name] = (...args: unknown[]): unknown => {
      let result: unknown;
      try {
        result = fn(...args);
      } catch {
        set({ busy: false, progress: null, error: FAILED });
        return undefined;
      }
      if (result instanceof Promise) {
        return result.catch(() => {
          set({ busy: false, progress: null, error: FAILED });
        });
      }
      return result;
    };
  }
  return out as T;
}

const FAILED = "That didn't go through — try again.";

export const useAdaptiveTestStore = create<AdaptiveTestState>((set, get) => {
  const actions: Omit<AdaptiveTestState, keyof typeof EMPTY> = {
    reset: () => {
      resetPending();
      set({ ...EMPTY });
    },
    setPhase: (phase) => set({ phase }),

    goToStep: (id) => {
      // The words need the two identity taps first — they decide which half of the bank is ever shown, so
      // entering the step without them would show everything in both directions (the §3.6.3 fail-open).
      if (id === 'bank' && get().bank?.address === undefined) {
        set({ phase: 'address', error: null });
        return;
      }
      // Re-entering a step un-skips it: arriving at it IS taking it back, and a row that still read "skipped"
      // while you were standing on it would be the app disagreeing with itself.
      set((prev) => ({
        phase: id as TakePhase,
        error: null,
        skipped: prev.skipped.filter((step) => step !== id),
      }));
    },

    skipStep: (id, next) =>
      set((prev) => ({
        skipped: prev.skipped.includes(id) ? prev.skipped : [...prev.skipped, id],
        // No next step left ⇒ back to the map, never a blank screen.
        phase: (next ?? 'map') as TakePhase,
        error: null,
      })),

    /**
     * 74 §3.6.35 — re-read the TAKE, and nothing else.
     *
     * The AI steps and every turn-stamping action need one thing back from the vault: the draft, with its
     * turns. `load` is the mount-time read — it re-fetches the oriented bank and re-seeds `marks`,
     * `lineReactions` and `seeded` from what is on disk — and using it here would let a re-read overwrite
     * marking state that the 700ms autosave has not written yet. That is not hypothetical for a full `load`:
     * `marks` is rebuilt from the lexicon, so anything still in the debounce would vanish off the screen.
     *
     * So this sets the state alone. A failed or refused read leaves the last good one standing rather than
     * blanking the take (the `start` lesson — a gated handler reports a closed gate with `null`, not a throw).
     */
    refreshState: async (testId) => {
      const state = await (window.selfos?.testsAdaptiveState({ testId }) ?? Promise.resolve(null));
      if (!state) return;
      set({ state });
    },

    load: async (testId) => {
      set({ activeTestId: testId });
      const [bank, state] = await Promise.all([
        window.selfos?.testsBank({ testId }) ?? Promise.resolve(null),
        window.selfos?.testsAdaptiveState({ testId }) ?? Promise.resolve(null),
      ]);
      // Seed from what they have already said (74 §3.5/§8.2). Without this a retake presents every hard no
      // again, unmarked — the one thing the boundary rule promises will never happen — and "pick up where you
      // left off" drops back to an empty grid.
      // Restore what they already reacted to (74 §3.6.16), so returning to the lines step shows the set with
      // its marks rather than an empty screen — the reactions were recorded and then unreachable.
      const priorReactions: Record<string, 'love' | 'meh' | 'no'> = {};
      for (const turn of state?.draft?.turns ?? []) {
        if (turn.phase === 'lines' && typeof turn.answer === 'string') {
          priorReactions[turn.item.text] = turn.answer as 'love' | 'meh' | 'no';
        }
      }
      /*
       * Seed from the per-direction marks, exactly as the names phase does (74 §3.6.26). Pre-Option-B deck
       * answers were 0–4 ratings with no mark behind them; those are cleared on read by
       * `resetPreDirectionalDeckMarks` rather than guessed at here, so an unmarked row means unmarked.
       *
       * 74 §3.6.34 — scoped to THIS STEP'S OWN ROWS, which is the whole of the fix below.
       *
       * There is ONE lexicon per person: `applyDirectionalMarks` writes the deck's marks and the pet names'
       * marks into the same `entries`, which is why `steer.ts` and the report both have to filter names back
       * out. Seeding from all of them made `marks` a superset of `nameMarks` rather than its sibling, and
       * four numbers downstream read it as "the words step's marks":
       *
       *   - the rail's tally said "320 of 924 shown here" on a vault with 22 marked WORDS (measured), with a
       *     numerator and a denominator drawn from different populations — so it could exceed 100%
       *   - the rail's trailing "N words" on the words step said 320 for the same reason
       *   - `bankTally`'s love/okay/never counted every pet name as a word
       *   - `stepStatuses` does `nameMarks + bankMarks`, so every marked name was counted TWICE, against a
       *     bridge that counts each entry once (`lexiconReadyForGeneration`). That one is not cosmetic: the
       *     renderer greys an AI step on `generationReadiness(marked, loved)` and the bridge REFUSES on the
       *     same helper, and the bridge's own comment says the two "can never disagree". With 8 marked names
       *     and no words the renderer sees 16, offers the step, and the bridge answers "mark a few more".
       *
       * `bank` here is the deck view (`deckFamilies`, coreBridge `testsBank`), so its keys ARE this step's
       * rows. Deck marks + name marks now partition the lexicon exactly, which is what makes the renderer's
       * total agree with the bridge's again.
       */
      const deckKeys = new Set((bank?.entries ?? []).map((entry) => entry.key));
      const marks: DirectionalMarks = {};
      for (const entry of state?.lexicon.entries ?? []) {
        if (!deckKeys.has(entry.key)) continue;
        if (entry.hearState || entry.sayState) {
          marks[entry.key] = {
            ...(entry.hearState ? { hear: entry.hearState } : {}),
            ...(entry.sayState ? { say: entry.sayState } : {}),
          };
        }
      }
      set((prev) => ({
        bank,
        state,
        loaded: true,
        lineReactions: { ...priorReactions },
        marks,
        seeded: { ...prev.seeded, bank: Object.keys(marks).length },
      }));
    },

    start: async (testId) => {
      set({ busy: true, error: null, activeTestId: testId });
      const state = await (window.selfos?.testsAdaptiveStart({ testId }) ?? Promise.resolve(null));
      // 74 §3.6.9 — the map, not a phase. Both a first take and a resumed one land here: the whole reason it
      // exists is that "pick up where you left off" used to drop into whichever AI phase had been reached, with
      // no route back to the person's own words.
      // Never blank a state we already have. A refused or failed `testsAdaptiveStart` resolves to `null`
      // (that is how every gated handler reports a closed gate — it does not throw), and assigning it
      // straight through replaced the state `load` had already fetched, leaving the screen on "Loading…"
      // with no error and no route out. Latent until §3.6.30 made this run on arrival rather than only
      // behind a tap.
      set((prev) => ({ state: state ?? prev.state, busy: false, phase: 'map' }));
      // Free (no AI), so the map can show the names step's real count without asking for anything.
      await get().loadNames(testId);
    },

    mark: (key, side, mark) => {
      set((prev) => {
        const marks = toggleMark(prev.marks, key, side, mark, dirtyMarks, dirtyCleared);
        // Mirrored into the take-wide record so the CLOSING call can carry the un-mark: it sends the whole
        // pass, and an un-marked side is simply absent from `marks` — absence undoes nothing, so without this
        // a failed autosave would leave the stale mark on record for good.
        if (marks[key]?.[side] === undefined) {
          const sides = clearedThisTake.get(key) ?? new Set<'hear' | 'say'>();
          sides.add(side);
          clearedThisTake.set(key, sides);
        } else clearedThisTake.get(key)?.delete(side);
        return {
          marks,
          saveState: 'saving',
          touched: prev.touched.includes(key) ? prev.touched : [...prev.touched, key],
        };
      });
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void get().flush(get().activeTestId), AUTOSAVE_DELAY_MS);
    },

    loadNames: async (testId) => {
      const names = await (window.selfos?.testsNames({ testId }) ?? Promise.resolve(null));
      // No registers to ask about (a bank with no name families, or a refused gate) — move on rather than
      // stranding them on an empty phase. A dead end is never the right answer to missing content.
      if (!names || names.registers.length === 0) {
        set({ names: null, phase: get().phase === 'names' ? 'bank' : get().phase });
        return;
      }
      // Seed from what they have already said, exactly as the deck seeds from the lexicon — a retake must not
      // present every answered name blank, and "pick up where you left off" must look like it did.
      const nameMarks: DirectionalMarks = {};
      for (const entry of names.entries) {
        if (entry.hearState || entry.sayState) {
          nameMarks[entry.key] = {
            ...(entry.hearState ? { hear: entry.hearState } : {}),
            ...(entry.sayState ? { say: entry.sayState } : {}),
          };
        }
      }
      set((prev) => ({
        names,
        nameMarks,
        seeded: { ...prev.seeded, names: Object.keys(nameMarks).length },
      }));
    },

    markName: (key, side, mark) => {
      set((prev) => ({
        nameMarks: toggleMark(prev.nameMarks, key, side, mark, dirtyNames, dirtyNameCleared),
        saveState: 'saving',
      }));
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void get().flush(get().activeTestId), AUTOSAVE_DELAY_MS);
    },

    setOpenRegister: (id) => set({ openRegister: id }),

    finishNames: async (testId) => {
      // Flush first, then close the pass so it stamps its one turn — the same order the deck uses.
      await get().flush(testId);
      const resultId = get().state?.draft?.id;
      if (resultId) {
        const next = await (window.selfos?.testsAdaptiveNames({
          testId,
          resultId,
          marks: {},
        }) ?? Promise.resolve(null));
        if (next) set({ state: next });
      }
      set({ phase: 'bank', openRegister: null });
    },

    /**
     * Persist the delta. Autosave never touches `phase` and never re-reads `state.lexicon` into the store: a
     * refresh mid-pass would re-lock rows they are still working on, and the grid would jump under their hands.
     */
    flush: async (testId) => {
      // Chain, never overlap. The debounce guarantees one TIMER, not one flush: on a round trip slower than the
      // delay (iCloud, a big lexicon), flush B would read the lexicon before flush A's write landed and silently
      // drop A's delta — `recordMarkingPass` is read-modify-write over one file and IPC handlers are not serialized.
      // A lost mark is precisely the promise this feature makes, so the writes queue.
      inFlight = inFlight.then(() => runFlush(testId, get, set)).catch(() => undefined);
      await inFlight;
    },

    setAddress: async (testId, self, partner, identity) => {
      set({ busy: true });
      await window.selfos?.testsLexiconEdit({
        kind: 'setAddress',
        self,
        partner,
        ...(identity ? { identity } : {}),
      });
      // The bank is oriented HOST-SIDE, so it has to be re-read for the new answers to take effect.
      const bank = await (window.selfos?.testsBank({ testId }) ?? Promise.resolve(null));
      // Step 1 → step 2. These two taps are the take's FIRST step now (74 §3.6.9), so answering them moves to
      // the pet names rather than jumping into the deck they happen to orient.
      set({ bank: bank ?? get().bank, busy: false, phase: 'names' });
      // ...and so are the NAMES, since 2026-08-19 (§3.6.3). Without this re-read the very next screen renders
      // the pills resolved from the PREVIOUS answers — which on a first take is no answers, so every name
      // shows both ways and the step these two taps exist to orient is the one they don't reach.
      await get().loadNames(testId);
    },

    banLine: async (line) => {
      const lexicon = await (window.selfos?.testsLexiconEdit({
        kind: 'addBoundary',
        text: line,
        boundaryKind: 'theme',
      }) ?? Promise.resolve(null));
      if (!lexicon) return;
      set((prev) => ({ state: prev.state ? { ...prev.state, lexicon } : prev.state }));
    },

    /*
     * 74 §3.6.35 — the way back out, which did not exist.
     *
     * The patched `state.lexicon` is what the row reads to know it is ruled out, so both halves have to write
     * it: without this the Undo would call the seam, succeed, and leave the row saying "Ruled out" until the
     * next full load — the same say-nothing failure the ban itself had.
     */
    unbanLine: async (line) => {
      const lexicon = await (window.selfos?.testsLexiconEdit({
        kind: 'removeBoundary',
        text: line,
      }) ?? Promise.resolve(null));
      if (!lexicon) return;
      set((prev) => ({ state: prev.state ? { ...prev.state, lexicon } : prev.state }));
    },

    rememberArea: async (area) => {
      await window.selfos?.testsAdaptiveSetArea({ testId: get().activeTestId, area });
    },

    submitBank: async (testId) => {
      const { state, marks } = get();
      const resultId = state?.draft?.id;
      if (!resultId) return;
      set({ busy: true });
      await get().flush(testId);
      // The closing call sends the WHOLE pass, not the delta — cheap, and it makes the stamped turn an honest
      // record of what the pass ended up being.
      // It carries the take's un-marks too: an un-marked key is simply ABSENT from `marks`, and absence undoes
      // nothing — so without this a lost or failed un-mark leaves the stale mark on record forever, and if it
      // was a `never`, a boundary they took back stays settled.
      const next = await (window.selfos?.testsAdaptiveBank({
        testId,
        resultId,
        marks,
        cleared: clearedFor(clearedThisTake),
      }) ?? Promise.resolve(null));
      set({
        state: next ?? state,
        busy: false,
        phase: 'lines',
        saveState: 'saved',
      });
    },

    loadLines: async (testId, round) => {
      const resultId = get().state?.draft?.id;
      if (!resultId) return;
      set({ busy: true, progress: { phase: 'Writing lines for you', startedAt: Date.now() } });
      const fallback: AdaptivePhaseView = { ok: false, degraded: true };
      const out = await (window.selfos?.testsAdaptiveLines({ testId, resultId, round }) ??
        Promise.resolve(fallback));
      // A degraded phase no longer JUMPS the person to the next one (74 §3.6.9): the rail owns navigation, so a
      // phase that couldn't produce anything says so and leaves them standing somewhere they recognise. Silently
      // relocating them was indistinguishable from the step having worked.
      // 74 §3.6.12 — keep the phase's OWN account of what went wrong. Without it the screen fell back to the
      // generic "AI isn't set up yet", which is a lie whenever a key is present and the call simply failed.
      /*
       * 74 §3.6.35 — RE-READ, rather than assigning the round's lines into the store.
       *
       * `lines: out.lines ?? []` was a hard replace, and the `?? []` made it worse than that: a round that
       * FAILED blanked the set the person was part-way through reacting to. It was half-hidden because the
       * renderer unioned in the lines that had a reaction, so a line you had answered survived and a line you
       * had not vanished — which reads as arbitrary rather than broken. The bridge records the whole round as
       * offers now, so re-reading the take is what shows them, appended to what was already there.
       */
      set({ busy: false, progress: null, linesMessage: out.message ?? null });
      await get().refreshState(testId);
    },

    reactToLine: async (testId, line, reaction) => {
      const resultId = get().state?.draft?.id;
      if (!resultId) return;
      set((prev) => ({ lineReactions: { ...prev.lineReactions, [line]: reaction } }));
      await window.selfos?.testsAdaptiveTurn({
        testId,
        resultId,
        phase: 'lines',
        itemId: line,
        text: line,
        answer: reaction,
      });
    },

    nextProbe: async (testId) => {
      const resultId = get().state?.draft?.id;
      if (!resultId) return;
      set({
        busy: true,
        progress: { phase: 'Thinking about your answers', startedAt: Date.now() },
      });
      const fallback: AdaptiveProbeView = { ok: false, done: true, degraded: true };
      const out = await (window.selfos?.testsAdaptiveProbe({ testId, resultId }) ??
        Promise.resolve(fallback));
      set({
        busy: false,
        progress: null,
        // "Nothing left to ask" is an OUTCOME, not a reason to relocate them. It used to jump to the
        // scenario, which made it indistinguishable from the step never having run.
        //
        // A DEGRADED pass is NOT that outcome, and folding it in here reported a failure in the words of a
        // success: "everything you marked was clear enough that it has no question to ask — that's this step
        // finished." The bridge returns the same `done` either way, so the two are separated here.
        probeDone: out.done && !out.degraded,
        probeMessage: out.degraded
          ? (out.message ?? 'That didn\u2019t come through — try again.')
          : null,
      });
      /*
       * 74 §3.6.35 — the pass's questions come back from the TAKE, not from this reply.
       *
       * A pass writes up to six and only one of them existed anywhere: the first went into `probeQuestion` and
       * the other five sat in a renderer queue that a reload, or walking to another step, threw away. They are
       * all stamped as offers now, so re-reading is what puts the whole pass on screen — and the screen shows
       * every question it has ever asked, which is what "reviewable" has to mean.
       */
      await get().refreshState(testId);
    },

    skipProbeQuestion: async (testId, itemId, question, options) => {
      const resultId = get().state?.draft?.id;
      if (!resultId) return;
      await window.selfos?.testsAdaptiveTurn({
        testId,
        resultId,
        phase: 'probe',
        itemId,
        text: question,
        // Carried for the same reason a revision carries them: a skipped question stays ANSWERABLE, so it must
        // not lose the taps it would be answered with.
        ...(options ? { options } : {}),
        answer: PROBE_SKIPPED,
      });
      await get().refreshState(testId);
    },

    loadScenario: async (testId, context) => {
      const resultId = get().state?.draft?.id;
      if (!resultId) return;
      set({ busy: true, progress: { phase: 'Setting a scene', startedAt: Date.now() } });
      const fallback: AdaptiveScenarioView = { ok: false, context, degraded: true };
      const out = await (window.selfos?.testsAdaptiveScenario({ testId, resultId, context }) ??
        Promise.resolve(fallback));
      const scenes = out.scenes ?? [];
      set({
        busy: false,
        progress: null,
        // A moment that produced nothing used to clear `busy` and set no scene — so the tap showed a thinking
        // state and then returned to the same grid with nothing to react to. It read as a button that does
        // nothing at all.
        scenarioMessage:
          scenes.length > 0 ? null : (out.message ?? 'That didn’t come through — try again.'),
      });
      // 74 §3.6.35 — the append-and-dedupe this used to do by hand happens in the bridge now, against the
      // take's own turns, so an unpicked moment survives a reload instead of living until the next load. It
      // was the only one of the three sets that appended at all; the other two are joining it rather than the
      // other way round.
      await get().refreshState(testId);
    },

    reviseProbeAnswer: async (testId, itemId, question, answer, options) => {
      const resultId = get().state?.draft?.id;
      if (!resultId) return;
      if (answer.trim() === '') return;
      await window.selfos?.testsAdaptiveTurn({
        testId,
        resultId,
        phase: 'probe',
        itemId,
        text: question,
        // Carried, or a revision would silently strip the options off the turn and the question could never
        // be answered by tapping again.
        ...(options ? { options } : {}),
        answer,
      });
      await get().refreshState(testId);
    },

    /*
     * The moment is PASSED IN rather than looked up (74 §3.6.19).
     *
     * A moment can now come from two places — freshly written this sitting, or read back off an answered
     * turn — and the store only holds the first kind. Looking it up here would silently no-op on exactly the
     * case this change exists to support: changing an answer you gave in an earlier sitting.
     */
    answerScenario: async (testId, option, target) => {
      const resultId = get().state?.draft?.id;
      if (!resultId || !target) return;
      await window.selfos?.testsAdaptiveTurn({
        testId,
        resultId,
        phase: 'scenario',
        // Per SCENE, not per context: a pass writes several, and keying them all to the context meant the
        // second answer overwrote the first. The format is shared with the bridge, which stamps the moment as
        // an offer under this same id before anyone picks anything — two hand-written copies would mean the
        // pick appended a second turn instead of filling in the first (74 §3.6.35).
        itemId: scenarioTurnId(target.context, target.scene),
        text: target.scene,
        // The choices this moment offered, PERSISTED. Without them an answered moment could be seen but never
        // re-picked, and re-opening its category could only mean spending again on five different moments.
        options: target.options,
        answer: option,
      });
      // Re-read so the answered list reflects the write — including a CHANGED answer, which replaces rather
      // than appending (`stampTurn`).
      await get().refreshState(testId);
      set({ scenarioMessage: null });
    },

    synthesize: async (testId, resultIdOverride, acceptDegraded) => {
      // The override re-runs the read for a take that is already COMPLETE. A synthesis that produced nothing
      // used to leave the report saying so with no way to try again — the honest message, and a dead end.
      // `completeAdaptiveTake` is idempotent (it reuses the insight id), so re-running is safe.
      const resultId = resultIdOverride ?? get().state?.draft?.id;
      if (!resultId) return;
      // Flush FIRST. Every other closing call does (`submitBank`, `submitSplit`, `finishNames`), and this one
      // did not — which was survivable while finishing meant walking through them, and became a data-loss bug
      // the moment "Finish — show me my profile" appeared on every step's rail (74 §3.6.9): tap it inside the
      // 700ms debounce and the profile is built without the marks you just made.
      await get().flush(testId);
      set({
        busy: true,
        synthesisMessage: null,
        progress: { phase: 'Writing your profile', startedAt: Date.now() },
      });
      const out = await (window.selfos?.testsAdaptiveSynthesize({
        testId,
        resultId,
        ...(acceptDegraded ? { acceptDegraded: true } : {}),
      }) ?? Promise.resolve(null));
      /*
       * 74 §3.6.18 — a FAILURE stays on the step and says why.
       *
       * This used to set `phase: 'done'` unconditionally, which redirected to a report that had no profile in
       * it and one generic sentence about it. The take is not completed on a failure either, so the retry is
       * right here and the step is still honestly unfinished.
       */
      if (out && !out.ok) {
        set({
          state: out.state ?? get().state,
          busy: false,
          progress: null,
          synthesisMessage: out.message ?? FAILED,
        });
        return;
      }
      set({
        state: out?.state ?? get().state,
        busy: false,
        progress: null,
        synthesisMessage: null,
        phase: 'done',
      });
    },

    abandon: async (testId) => {
      const resultId = get().state?.draft?.id;
      // Flush first, or the debounce would land the last taps back onto a draft that is about to be deleted.
      // The marks themselves are kept on purpose — they live in the lexicon, which is the person's answers,
      // not this take's scratch state. Only the take's own record and its place in the deck go.
      await get().flush(testId);
      if (resultId) await window.selfos?.testsAdaptiveAbandon({ testId, resultId });
      // Without this, "start over" would drop them back at the area they stopped in, which is the one thing
      // it is supposed to undo.
      await window.selfos?.testsAdaptiveSetArea({ testId, area: 0 });
      set({ ...EMPTY });
      // The FULL read here, not the narrow one: `EMPTY` has just cleared the bank and every seeded mark, and
      // start-over has to put them back (the marks live in the lexicon and are deliberately kept).
      await get().load(testId);
    },

    editLexicon: async (edit) => {
      const lexicon: EroticLexicon | null = await (window.selfos?.testsLexiconEdit(edit) ??
        Promise.resolve(null));
      if (!lexicon) return;
      set((prev) => ({ state: prev.state ? { ...prev.state, lexicon } : prev.state }));
    },
  };
  return { ...EMPTY, ...guardAsync(actions, (patch) => set(patch)) };
});

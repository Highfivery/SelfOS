import { create } from 'zustand';
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
  | 'split'
  | 'lines'
  | 'probe'
  | 'scenario'
  | 'done';

export type BankMark = 'love' | 'never' | 'okay';

/** Long enough that a fast run of taps is one write; short enough that closing the app loses nothing real. */
const AUTOSAVE_DELAY_MS = 700;

/**
 * The autosave's pending work, held OUTSIDE the store: a debounce timer and the delta since the last flush.
 * Keeping it out of zustand means a tap re-renders the one row it changed, not the whole ~1,100-entry grid.
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirtyMarks = new Set<string>();
let dirtyCleared = new Set<string>();
let dirtySplits = new Set<string>();
/** 74 §3.6.8 — pending pet-name work: which sides of which names changed, and which were taken back. */
let dirtyNames = new Map<string, Set<'hear' | 'say'>>();
let dirtyNameCleared = new Map<string, Set<'hear' | 'say'>>();

/** Serializes the writes — see `flush`. */
let inFlight: Promise<void> = Promise.resolve();
/**
 * Bumped by every `reset()`. A flush that started before a person switch (or before the take was left) must
 * NOT put its work back into the pending sets afterwards: those keys belong to the previous person's take,
 * and the next flush would carry them into whoever is active now.
 */
let generation = 0;
/** Un-marks made anywhere in this take, so the closing call can carry them (an absent key undoes nothing). */
let clearedThisTake = new Set<string>();

function resetPending(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  generation += 1;
  // Start a fresh chain. The old one may still be waiting on a call that never settles (a wedged IPC), and
  // every later save queues behind it — so a single hung write would silently stop autosaving for good.
  inFlight = Promise.resolve();
  dirtyMarks = new Set();
  dirtyCleared = new Set();
  dirtySplits = new Set();
  dirtyNames = new Map();
  dirtyNameCleared = new Map();
  clearedThisTake = new Set();
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
  const { state, marks, splits, nameMarks } = get();
  const resultId = state?.draft?.id;
  const marksDelta: Record<string, BankMark> = {};
  for (const key of dirtyMarks) {
    const mark = marks[key];
    if (mark) marksDelta[key] = mark;
  }
  const cleared = [...dirtyCleared];
  const splitsDelta: Record<string, { hear?: number; say?: number }> = {};
  for (const key of dirtySplits) {
    const value = splits[key];
    if (value) splitsDelta[key] = value;
  }
  const namesDelta: Record<string, { hear?: BankMark; say?: BankMark }> = {};
  for (const [key, sides] of dirtyNames) {
    const current = nameMarks[key];
    const mark: { hear?: BankMark; say?: BankMark } = {};
    for (const side of sides) {
      const value = current?.[side];
      if (value) mark[side] = value;
    }
    if (Object.keys(mark).length > 0) namesDelta[key] = mark;
  }
  const nameCleared: Record<string, ('hear' | 'say')[]> = {};
  for (const [key, sides] of dirtyNameCleared) nameCleared[key] = [...sides];
  const nothing =
    Object.keys(marksDelta).length === 0 &&
    cleared.length === 0 &&
    Object.keys(splitsDelta).length === 0 &&
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
  dirtyMarks = new Set();
  dirtyCleared = new Set();
  dirtySplits = new Set();
  dirtyNames = new Map();
  dirtyNameCleared = new Map();
  let ok = true;
  try {
    if (Object.keys(marksDelta).length > 0 || cleared.length > 0) {
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
    if (ok && Object.keys(splitsDelta).length > 0) {
      const res = await window.selfos?.testsAdaptiveSplit({
        testId,
        resultId,
        splits: splitsDelta,
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
  for (const key of Object.keys(marksDelta)) dirtyMarks.add(key);
  for (const key of cleared) dirtyCleared.add(key);
  for (const key of Object.keys(splitsDelta)) dirtySplits.add(key);
  for (const [key, mark] of Object.entries(namesDelta)) {
    const sides = dirtyNames.get(key) ?? new Set<'hear' | 'say'>();
    for (const side of ['hear', 'say'] as const) if (mark[side]) sides.add(side);
    dirtyNames.set(key, sides);
  }
  for (const [key, sides] of Object.entries(nameCleared)) {
    dirtyNameCleared.set(key, new Set(sides));
  }
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
  marks: Record<string, BankMark>;
  splits: Record<string, { hear?: number; say?: number }>;
  /** 74 §3.6.8 — the pet-name phase: its registers + names, and two marks per name. */
  names: AdaptiveNamesView | null;
  nameMarks: Record<string, { hear?: BankMark; say?: BankMark }>;
  /** Which register is open. `null` ⇒ the grid, which is where the phase starts. */
  openRegister: string | null;
  lines: string[];
  lineReactions: Record<string, 'love' | 'meh' | 'no'>;
  probeQuestion: string | null;
  /** The ambiguity the current question resolves — stamped as the turn's item id so the engine knows it has
   *  been asked (without it the same ambiguity is returned forever). */
  probeAmbiguityId: string | null;
  probeAnswer: string;
  /** The probe has nothing left to ask — a real outcome, shown as one, not a silent hop to the next phase. */
  probeDone: boolean;
  scenario: { context: string; scene: string; options: string[] } | null;
  /**
   * 74 §3.6.9 — steps passed over in THIS sitting, so the rail and the profile can say so instead of quietly
   * filling the gap. Deliberately not persisted: a skip is a decision about this sitting, and on a later one the
   * step should simply be open again rather than carrying a stale refusal forward.
   */
  skipped: string[];

  load(testId: string): Promise<void>;
  start(testId: string): Promise<void>;
  mark(key: string, mark: BankMark | null): void;
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
  /** Remember the deck position so resuming lands where they stopped (74 §3.6.4). */
  rememberArea(area: number): Promise<void>;
  submitBank(testId: string): Promise<void>;
  setSplit(key: string, direction: 'hear' | 'say', value: number): void;
  submitSplit(testId: string): Promise<void>;
  loadLines(testId: string, round: number): Promise<void>;
  reactToLine(testId: string, line: string, reaction: 'love' | 'meh' | 'no'): Promise<void>;
  nextProbe(testId: string): Promise<void>;
  answerProbe(testId: string): Promise<void>;
  skipProbe(testId: string): Promise<void>;
  loadScenario(testId: string, context: string): Promise<void>;
  answerScenario(testId: string, option: string): Promise<void>;
  synthesize(testId: string): Promise<void>;
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
  splits: {},
  names: null,
  nameMarks: {},
  openRegister: null,
  lines: [],
  lineReactions: {},
  probeQuestion: null,
  probeAmbiguityId: null,
  probeAnswer: '',
  probeDone: false,
  scenario: null,
  skipped: [] as string[],
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
  if (seen.has('split')) return 'lines';
  if (seen.has('bank')) return 'split';
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
        // The scenario's scene and the probe's question belong to the visit that fetched them; leaving and
        // coming back must present the step's own "ask me" state rather than a stale paid answer.
        ...(id === 'scenario' ? { scenario: null } : {}),
      }));
    },

    skipStep: (id, next) =>
      set((prev) => ({
        skipped: prev.skipped.includes(id) ? prev.skipped : [...prev.skipped, id],
        // No next step left ⇒ back to the map, never a blank screen.
        phase: (next ?? 'map') as TakePhase,
        error: null,
      })),

    load: async (testId) => {
      set({ activeTestId: testId });
      const [bank, state] = await Promise.all([
        window.selfos?.testsBank({ testId }) ?? Promise.resolve(null),
        window.selfos?.testsAdaptiveState({ testId }) ?? Promise.resolve(null),
      ]);
      // Seed from what they have already said (74 §3.5/§8.2). Without this a retake presents every hard no
      // again, unmarked — the one thing the boundary rule promises will never happen — and "pick up where you
      // left off" drops back to an empty grid.
      const marks: Record<string, BankMark> = {};
      const splits: Record<string, { hear?: number; say?: number }> = {};
      for (const entry of state?.lexicon.entries ?? []) {
        if (entry.state === 'never') marks[entry.key] = 'never';
        else if (entry.state === 'okay') marks[entry.key] = 'okay';
        else if (entry.hear > 0 || entry.say > 0) marks[entry.key] = 'love';
        if (entry.hear > 0 || entry.say > 0)
          splits[entry.key] = { hear: entry.hear, say: entry.say };
      }
      set({ bank, state, loaded: true, marks, splits });
    },

    start: async (testId) => {
      set({ busy: true, error: null, activeTestId: testId });
      const state = await (window.selfos?.testsAdaptiveStart({ testId }) ?? Promise.resolve(null));
      // 74 §3.6.9 — the map, not a phase. Both a first take and a resumed one land here: the whole reason it
      // exists is that "pick up where you left off" used to drop into whichever AI phase had been reached, with
      // no route back to the person's own words.
      set({ state, busy: false, phase: 'map' });
      // Free (no AI), so the map can show the names step's real count without asking for anything.
      await get().loadNames(testId);
    },

    mark: (key, mark) => {
      set((prev) => {
        // A hard no from an EARLIER take is not re-markable here — it lifts only through the report's explicit
        // "changed my mind" (74 §3.2). One made in this sitting stays editable, or autosave would set it in
        // stone the instant it was tapped.
        const locked =
          !prev.touched.includes(key) &&
          prev.state?.lexicon.entries.some((entry) => entry.key === key && entry.state === 'never');
        if (locked) return prev;
        const marks = { ...prev.marks };
        if (mark === null) {
          delete marks[key];
          dirtyMarks.delete(key);
          dirtyCleared.add(key);
          clearedThisTake.add(key);
        } else {
          marks[key] = mark;
          dirtyCleared.delete(key);
          clearedThisTake.delete(key);
          dirtyMarks.add(key);
        }
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
      const nameMarks: Record<string, { hear?: BankMark; say?: BankMark }> = {};
      for (const entry of names.entries) {
        if (entry.hearState || entry.sayState) {
          nameMarks[entry.key] = {
            ...(entry.hearState ? { hear: entry.hearState } : {}),
            ...(entry.sayState ? { say: entry.sayState } : {}),
          };
        }
      }
      set({ names, nameMarks });
    },

    markName: (key, side, mark) => {
      set((prev) => {
        const entry = prev.names?.entries.find((item) => item.key === key);
        // A hard no from an EARLIER take is settled, per direction — same rule as the deck's rows.
        if (side === 'hear' ? entry?.settledHear : entry?.settledSay) return prev;
        const current = prev.nameMarks[key] ?? {};
        const next = { ...current };
        const cleared = current[side] === mark;
        if (cleared) delete next[side];
        else next[side] = mark;
        const nameMarks = { ...prev.nameMarks };
        if (Object.keys(next).length === 0) delete nameMarks[key];
        else nameMarks[key] = next;

        const sides = dirtyNames.get(key) ?? new Set<'hear' | 'say'>();
        const clearedSides = dirtyNameCleared.get(key) ?? new Set<'hear' | 'say'>();
        if (cleared) {
          sides.delete(side);
          clearedSides.add(side);
        } else {
          clearedSides.delete(side);
          sides.add(side);
        }
        if (sides.size > 0) dirtyNames.set(key, sides);
        else dirtyNames.delete(key);
        if (clearedSides.size > 0) dirtyNameCleared.set(key, clearedSides);
        else dirtyNameCleared.delete(key);
        return { nameMarks, saveState: 'saving' };
      });
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
      // drop A's delta — `recordBankPass` is read-modify-write over one file and IPC handlers are not serialized.
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
      // Straight into the words: these two taps are that step's prerequisite (74 §3.6.9), not a gate on the
      // whole take — they only ever governed which half of the deck is shown.
      set({ bank: bank ?? get().bank, busy: false, phase: 'bank' });
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
        cleared: [...clearedThisTake],
      }) ?? Promise.resolve(null));
      set({ state: next ?? state, busy: false, phase: 'split', saveState: 'saved' });
    },

    setSplit: (key, direction, value) => {
      set((prev) => ({
        splits: { ...prev.splits, [key]: { ...prev.splits[key], [direction]: value } },
        saveState: 'saving',
      }));
      dirtySplits.add(key);
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void get().flush(get().activeTestId), AUTOSAVE_DELAY_MS);
    },

    submitSplit: async (testId) => {
      const { state, splits } = get();
      const resultId = state?.draft?.id;
      if (!resultId) return;
      set({ busy: true });
      await get().flush(testId);
      const next = await (window.selfos?.testsAdaptiveSplit({ testId, resultId, splits }) ??
        Promise.resolve(null));
      set({ state: next ?? state, busy: false, phase: 'lines', saveState: 'saved' });
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
      set({ lines: out.lines ?? [], busy: false, progress: null });
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
        probeQuestion: out.question ?? null,
        probeAmbiguityId: out.ambiguityId ?? null,
        probeAnswer: '',
        busy: false,
        progress: null,
        // "Nothing left to ask" is an OUTCOME, not a reason to relocate them. It used to jump to the scenario,
        // which made it indistinguishable from the step never having run — and the bridge returns the same
        // `done` whether it exhausted the ambiguities or had nothing to work from at all.
        probeDone: out.done || out.degraded,
      });
    },

    answerProbe: async (testId) => {
      const { state, probeQuestion, probeAmbiguityId, probeAnswer } = get();
      const resultId = state?.draft?.id;
      if (!resultId || !probeQuestion) return;
      await window.selfos?.testsAdaptiveTurn({
        testId,
        resultId,
        phase: 'probe',
        // The ambiguity id, NOT the model's prose — this is what marks it answered.
        itemId: probeAmbiguityId ?? probeQuestion.slice(0, 60),
        text: probeQuestion,
        answer: probeAnswer,
      });
      await get().nextProbe(testId);
    },

    /** Skipping still RECORDS the ambiguity as asked — otherwise "skip this" hands back the same question. */
    skipProbe: async (testId) => {
      const { state, probeQuestion, probeAmbiguityId } = get();
      const resultId = state?.draft?.id;
      if (resultId && probeQuestion) {
        await window.selfos?.testsAdaptiveTurn({
          testId,
          resultId,
          phase: 'probe',
          itemId: probeAmbiguityId ?? probeQuestion.slice(0, 60),
          text: probeQuestion,
          answer: '',
        });
      }
      await get().nextProbe(testId);
    },

    loadScenario: async (testId, context) => {
      const resultId = get().state?.draft?.id;
      if (!resultId) return;
      set({ busy: true, progress: { phase: 'Setting a scene', startedAt: Date.now() } });
      const fallback: AdaptiveScenarioView = { ok: false, context, degraded: true };
      const out = await (window.selfos?.testsAdaptiveScenario({ testId, resultId, context }) ??
        Promise.resolve(fallback));
      set({
        scenario:
          out.scene && out.options
            ? { context: out.context, scene: out.scene, options: out.options }
            : null,
        busy: false,
        progress: null,
      });
    },

    answerScenario: async (testId, option) => {
      const { state, scenario } = get();
      const resultId = state?.draft?.id;
      if (!resultId || !scenario) return;
      await window.selfos?.testsAdaptiveTurn({
        testId,
        resultId,
        phase: 'scenario',
        itemId: scenario.context,
        text: scenario.scene,
        answer: option,
      });
      set({ scenario: null });
    },

    synthesize: async (testId) => {
      const resultId = get().state?.draft?.id;
      if (!resultId) return;
      set({ busy: true, progress: { phase: 'Writing your profile', startedAt: Date.now() } });
      const next = await (window.selfos?.testsAdaptiveSynthesize({ testId, resultId }) ??
        Promise.resolve(null));
      set({ state: next ?? get().state, busy: false, progress: null, phase: 'done' });
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

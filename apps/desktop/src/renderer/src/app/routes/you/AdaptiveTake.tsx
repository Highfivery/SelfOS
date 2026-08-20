import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Ban, Clock, Contrast, Flame, ListChecks, Lock } from 'lucide-react';

/**
 * 74 §3.6.1 #5 — the three marks, as lucide icons. `Ban` (a circle-slash) rather than a bare X because a
 * boundary is not a "close"; `Contrast` (a half-filled circle) reads as "partly", which is what "it's okay"
 * is. Each carries a text label + `aria-pressed`, so state is never conveyed by icon or colour alone (§9).
 */
/**
 * 74 §3.6.3 — who the two of you are. Two plain questions, because this is the screen that decides which half
 * of a 1,000-line bank a person ever sees, and it used to ask it sideways ("When someone talks to you like
 * this, you're…"), which reads as a riddle. It also used to set only the ADDRESS axis and lean on onboarding
 * for the body axis — and onboarding fails open, so someone who skipped it was shown everything in both
 * directions.
 */
const IDENTITY_OPTIONS: { value: 'man' | 'woman' | 'either'; label: string }[] = [
  { value: 'man', label: 'a man' },
  { value: 'woman', label: 'a woman' },
  { value: 'either', label: 'neither · both · it depends' },
];

/**
 * What the two answers actually CHANGE, shown as two example lines (74 §3.6.3). The answer's effect used to
 * be described in a sentence; a person picking "a man / a woman" had no way to see that it decides which half
 * of a thousand lines they'll be shown, or which of them count as things they'd HEAR.
 *
 * These are real bank lines, chosen by the SAME rule the resolver uses (a say line names the partner's body,
 * a hear line names their own), so the preview can never promise something the deck then withholds.
 */
function previewLines(
  self: 'man' | 'woman' | 'either' | null,
  partner: 'man' | 'woman' | 'either' | null,
): { side: 'hear' | 'say'; text: string }[] {
  // VERIFIED bank strings, not written here: `anatomy-him:your hard cock` and `anatomy-her:pussy` carry these
  // exact examples. The previous man-side line was invented — it appeared in no entry — so the screen promised
  // a line the deck would never show, under a comment claiming these came from the bank. Never assert content
  // from the bank without grepping it.
  const about = (who: 'man' | 'woman' | 'either' | null): string | null =>
    who === 'man'
      ? 'I can feel your hard cock through your jeans'
      : who === 'woman'
        ? 'your pussy is so wet for me'
        : null;
  const out: { side: 'hear' | 'say'; text: string }[] = [];
  const say = about(partner);
  const hear = about(self);
  if (say) out.push({ side: 'say', text: say });
  if (hear) out.push({ side: 'hear', text: hear });
  return out;
}

/** What someone of this identity is called by default. Overridable below — a man can want "good girl". */
function addressFor(identity: 'man' | 'woman' | 'either'): 'girl' | 'man' | 'either' {
  return identity === 'man' ? 'man' : identity === 'woman' ? 'girl' : 'either';
}

/** The two address answers in one line, for the always-present "change" affordance. */
function addressSummary(
  address: { self: 'girl' | 'man' | 'either'; partner: 'girl' | 'man' | 'either' } | undefined,
): string {
  // It used to print the raw stored values — "either · either", which is machine output, not language, and
  // says nothing about which of the two answers is which. This reads as a sentence about the two of you.
  const word = (v: 'girl' | 'man' | 'either' | undefined): string =>
    v === 'girl' ? 'their girl' : v === 'man' ? 'their man' : 'anything';
  if (!address || (address.self === 'either' && address.partner === 'either')) {
    return 'everything';
  }
  return `you as ${word(address.self)}, them as ${word(address.partner)}`;
}

/**
 * 74 §3.6.1 — WHAT you are rating, made visible.
 *
 * The bank is mixed, and the two kinds look identical unless the row says so:
 *
 * - **A word** (587 of ~1,033 entries carry no quote of their own — but 256 do): the mark goes on the WORD,
 *   and the quote is one illustration of it. "pussy" is loved in "I want to fuck your pussy" and hated in
 *   "I want to beat that pussy", so a row that presents the quote as the thing being rated invites the wrong
 *   answer. The word is bolded inside its quote and named as the thing being marked.
 * - **A whole line**: the entry IS the utterance, there is no separate quote, and the mark goes on the line.
 *
 * Splitting on the word is case-insensitive and returns null when the quote doesn't actually contain it — a
 * few examples paraphrase — so nothing is ever bolded that isn't there.
 */
function boldTermInQuote(
  quote: string,
  term: string,
): { before: string; hit: string; after: string } | null {
  const at = quote.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return null;
  return {
    before: quote.slice(0, at),
    hit: quote.slice(at, at + term.length),
    after: quote.slice(at + term.length),
  };
}

/** The pair, in two words, for the band's change affordance. Falls back to "them" whenever unknown. */
function pairShorthand(
  identity: { self: 'man' | 'woman' | 'either'; partner: 'man' | 'woman' | 'either' } | undefined,
): string {
  const them = identity?.partner === 'woman' ? 'her' : identity?.partner === 'man' ? 'him' : 'them';
  return `You & ${them}`;
}

/**
 * The direction, as a sentence, for a whole area.
 *
 * This was the single most confusing thing on the screen: "your pussy is so wet for me" with three marks and
 * NOTHING saying whether you're rating hearing it or saying it. The orientation already resolves it per entry
 * — most areas come out uniform (her body is say-only for a man who dates women) — but the answer lived in the
 * aria-label, where a sighted person never sees it. Rating the wrong direction silently poisons the whole
 * profile, so it is stated, not implied.
 */
function directionSentence(sides: readonly ('hear' | 'say')[] | null): string {
  // Mixed area: each row carries its own marker, so the band says that rather than picking a side.
  if (sides === null) {
    return 'This area mixes the two — each line says which way it goes.';
  }
  if (sides.length >= 2) {
    // It used to say "rate these BOTH ways at once … you split the two apart in the next step" — of a step
    // that had been folded away, so the promise pointed at nothing and the one mark it asked for stood in
    // for two different answers (74 §3.6.26).
    return 'Two answers per line — one for hearing it from them, one for saying it to them.';
  }
  return sides[0] === 'say'
    ? 'Things YOU SAY TO THEM — rate how much you want to say it.'
    : 'Things THEY SAY TO YOU — rate how much you want to hear it.';
}

/** The three marks in tap order, per direction — the same set, and the same order, as the pet names. */
const DECK_MARKS: { value: BankMark; label: string; Icon: typeof Flame }[] = [
  { value: 'love', label: 'love it', Icon: Flame },
  { value: 'okay', label: "it's okay", Icon: Contrast },
  { value: 'never', label: 'never', Icon: Ban },
];
import {
  Banner,
  Button,
  Card,
  Heading,
  Select,
  Stack,
  Text,
  Textarea,
} from '../../../design-system/components';
import { isAnsweredTurn } from '@selfos/core/schemas';
import { useAdaptiveTestStore, type BankMark } from '../../../stores/adaptiveTestStore';
import { AdaptiveHead } from './AdaptiveHead';
import { PracticeSheet } from './PracticeSheet';
import { MarkFilter } from './MarkFilter';
import { NamesPhase } from './NamesPhase';
import { TakeMap } from './TakeMap';
import { StepActions, StepEyebrow, TakeRail, Tally } from './TakeRail';
import { nextStepAfter, phaseForStep, stepStatuses, TAKE_STEPS, type StepId } from './takeSteps';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { AiUnavailableNotice } from '../../AiUnavailableNotice';
import styles from './You.module.css';
import take from './TestTake.module.css';
import adaptive from './Adaptive.module.css';

/**
 * The contexts the scenario phase walks, in the order a night actually runs — each saying what it MEANS. As
 * three bare labels they were the least explicable screen in the take (§3.6.9): three buttons, no question.
 */
/**
 * 74 §3.6.19 — the six moments, ALL of them.
 *
 * The engine has written six contexts for as long as `ADAPTIVE_CONTEXTS` has existed and this list offered
 * three, so `edge`, `sexting` and `phone` were accepted by the schema, generated by the engine, and reachable
 * from nowhere. Sexting and phone are arguably the most useful of the set: they are the moments where the
 * words are the whole thing, with no body language doing any of the work.
 *
 * Kept in the same order as `ADAPTIVE_CONTEXTS`, which is the order a night actually runs in.
 */
const CONTEXTS: { id: string; label: string; blurb: string }[] = [
  {
    id: 'buildUp',
    label: 'Build-up',
    blurb: 'Before anything has happened — texts, teasing, walking in.',
  },
  {
    id: 'during',
    label: 'During',
    blurb: 'Mid-act, when nobody is choosing their words carefully.',
  },
  {
    id: 'edge',
    label: 'Edge',
    blurb: 'Held right there and kept there — denied, made to wait.',
  },
  {
    id: 'after',
    label: 'After',
    blurb: 'The come-down — held, talked to, told what just happened.',
  },
  {
    id: 'sexting',
    label: 'Sexting',
    blurb: 'Typed, hours apart, with nothing but the words.',
  },
  {
    id: 'phone',
    label: 'Phone',
    blurb: 'His voice and nothing else — no touch to carry it.',
  },
];

/**
 * 74 §3.6.17 — the free-text half of a probe answer, collapsed until it is wanted.
 *
 * The taps are the fast path; this is for when a tap isn't the answer. It stays folded because a textarea
 * under each of six questions rebuilds the wall of prose the short questions were meant to remove — but it
 * opens by default when there is nothing to tap, or when the answer on record isn't one of the options
 * (typed, or given before options existed), since a collapsed box would make that answer look lost.
 */
function SayMore({
  value,
  startOpen,
  busy,
  dirty,
  label,
  saveLabel,
  onChange,
  onSave,
}: {
  value: string;
  startOpen: boolean;
  busy: boolean;
  dirty: boolean;
  label: string;
  saveLabel?: string;
  onChange: (next: string) => void;
  onSave: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(startOpen);
  if (!open) {
    return (
      <div className={adaptive.askRow}>
        <button type="button" className={adaptive.textLink} onClick={() => setOpen(true)}>
          + Say more
        </button>
      </div>
    );
  }
  return (
    <>
      <Textarea
        value={value}
        onChange={(e) => {
          // Read the value BEFORE the updater. A functional setState runs after the event has been handled
          // and `currentTarget` is null by then — reading it in there threw on the first keystroke and took
          // the whole renderer down.
          const next = e.currentTarget.value;
          onChange(next);
        }}
        rows={3}
        aria-label={`Your answer to: ${label}`}
      />
      <div className={adaptive.askRow}>
        <Button
          variant={saveLabel ? 'primary' : 'secondary'}
          disabled={busy || !dirty}
          onClick={onSave}
        >
          {saveLabel ?? 'Save this answer'}
        </Button>
      </div>
    </>
  );
}

/** A moment's own name, for the buttons that act on it. */
function momentLabel(id: string): string {
  return (CONTEXTS.find((c) => c.id === id)?.label ?? 'these').toLowerCase();
}

/**
 * 74 §3.6.9 — a generating step that does not have enough to work from, saying so with the shortfall and the
 * way to fix it. Running one on two or three marks gives the model nothing of the person's to draw on, so it
 * writes from its own defaults — the generic output this test exists to avoid, and charged for.
 */
function NotEnoughYet({ reason, onGo }: { reason: string; onGo: () => void }): JSX.Element {
  return (
    <>
      <Banner tone="info">
        <b>Not enough marked yet.</b> This step writes from your own words, so it needs {reason}{' '}
        before it can say anything that&rsquo;s actually yours. Nothing has been spent getting here.
      </Banner>
      <div className={adaptive.askRow}>
        <Button variant="primary" onClick={onGo}>
          Go mark some words →
        </Button>
      </div>
    </>
  );
}

/** Elapsed seconds, ticking — the realtime-progress rule (CLAUDE.md §12: never a bare spinner). */
function useElapsed(startedAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === undefined) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return startedAt === undefined ? 0 : Math.max(0, Math.round((now - startedAt) / 1000));
}

function Progress({ phase, startedAt }: { phase: string; startedAt: number }): JSX.Element {
  const elapsed = useElapsed(startedAt);
  return (
    <div className={adaptive.progress} role="status" aria-live="polite">
      <div className={adaptive.progressBar} aria-hidden="true">
        <span />
      </div>
      <Text size="sm" tone="secondary">
        {phase}… · {elapsed}s elapsed · usually under a minute
      </Text>
    </div>
  );
}

/**
 * The autosave's only visible trace. Deliberately quiet and never blocking — a tap stays instant, and this
 * catches up behind it. It is the affordance that makes "close it whenever" believable, so it says "Saved",
 * not a spinner.
 */
function SaveState({
  state,
}: {
  state: 'idle' | 'saving' | 'saved' | 'unsaved';
}): JSX.Element | null {
  if (state === 'idle') return null;
  const label =
    state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Not saved yet — retrying';
  return (
    <span role="status" aria-live="polite">
      <Text as="span" size="sm" tone={state === 'unsaved' ? 'secondary' : 'tertiary'}>
        {label}
      </Text>
    </span>
  );
}

/**
 * 74 §3.2 — taking the Dirty Talk test.
 *
 * The bank is walked ONE AREA AT A TIME (74 §3.6.4), oriented to who is speaking to whom, with a
 * hand-written example under every fragment. Marking is three lucide marks — love it / it's okay / never. Then the AI phases chase what the bank left
 * ambiguous, and every one of them degrades rather than failing — a take that never reaches them still
 * completes with an honest, thinner profile.
 */
export function AdaptiveTake(): JSX.Element {
  const { testId = 'dirty-talk' } = useParams();
  const navigate = useNavigate();
  const store = useAdaptiveTestStore();
  const [round, setRound] = useState(1);

  const load = useAdaptiveTestStore((s) => s.load);
  const reset = useAdaptiveTestStore((s) => s.reset);
  useEffect(() => {
    void load(testId);
    return () => {
      // Navigating away inside the debounce window would otherwise drop the last few taps — the one moment
      // the person is most likely to be leaving mid-pass.
      void useAdaptiveTestStore.getState().flush(testId);
      reset();
    };
  }, [load, reset, testId]);

  /**
   * 74 §3.6.9 — arriving from the profile's "edit the names"/"edit the words" link. Consumed once, after the
   * take has started, so the deep link lands on the step rather than the map.
   */
  const routeState = useLocation().state as { step?: string; retake?: boolean } | null;
  const routeStep = routeState?.step;
  const tookRouteStep = useRef(false);
  useEffect(() => {
    if (tookRouteStep.current || !routeStep || !store.state?.draft) return;
    tookRouteStep.current = true;
    void useAdaptiveTestStore
      .getState()
      .start(testId)
      .then(() => useAdaptiveTestStore.getState().goToStep(routeStep));
  }, [routeStep, store.state, testId]);

  /**
   * 74 §3.6.30 — the intro is for a take nobody has touched. Anything with prior work opens on the MAP.
   *
   * Reported as "Keep marking goes to the intro", and the cause was that the card and this screen disagreed
   * about what "started" means. `cardStateOf` calls a test taken as soon as ANY result exists, and
   * `listAdaptiveResults` includes the draft — so a take opened once and left mid-way reads as "Keep
   * marking" on the card. This screen asked a stricter question: the old effect required `store.state.latest`,
   * which `coreBridge` defines as the first result whose status is NOT draft. A draft-only take therefore had
   * `latest === null`, the effect returned early, `start()` was never called, and the phase stayed on its
   * `intro` initial value — an explanation of a test they were already part-way through.
   *
   * Keying on prior work rather than on the retake FLAG is what removes the disagreement instead of patching
   * one route into it: a deep link, a resumed session and the card all land in the same place, and only a
   * genuinely untouched take still gets the intro.
   *
   * The step deep-link owns its own `start()`, so this stands aside for it rather than racing a second one.
   */
  const hasPriorWork = Boolean(store.state?.draft ?? store.state?.latest);
  const tookResume = useRef(false);
  useEffect(() => {
    if (tookResume.current || routeStep !== undefined || !store.state || !hasPriorWork) return;
    tookResume.current = true;
    void useAdaptiveTestStore.getState().start(testId);
  }, [routeStep, store.state, hasPriorWork, testId]);

  // Quitting or backgrounding the app inside the 700ms debounce would otherwise drop the last taps. The
  // unmount cleanup does not fire on a window close, so this is the only thing covering that path.
  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') void useAdaptiveTestStore.getState().flush(testId);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [testId]);

  const bank = store.bank;
  const marked = useMemo(() => Object.keys(store.marks), [store.marks]);

  // 74 §3.6.4 — the deck. One area per screen, in the bank's own (broad-first) family order.
  // Where they were in the deck, remembered across sittings. Without this, "it picks up on this area" is a
  // lie the second time they open it: someone who stopped at area 22 comes back to area 1 with 21 areas of
  // already-marked terms to page through (the §3.4 argument, one level down).
  const [areaIndex, setAreaIndex] = useState(0);
  const areaHeadingRef = useRef<HTMLDivElement>(null);
  const registerHeadingRef = useRef<HTMLDivElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  /**
   * 74 §3.6.1 — whether the two-tap practice is still owed.
   *
   * Resolved ONCE, when the bank phase is first reached: a take with nothing marked has not done it. Because the
   * practice taps are real marks, the condition can never become true again — so "shown once per take" needs no
   * new persistence, and a resumed take with marks in it goes straight to the deck.
   */
  const [practice, setPractice] = useState<'unknown' | 'needed' | 'done'>('unknown');
  /**
   * 74 §3.6.9 — whether an AI step has been ASKED in this sitting. It distinguishes "you haven't asked yet"
   * (offer the trigger, state the cost) from "it was asked and came back with nothing" (an honest notice), which
   * arrival-fires-the-call made impossible to tell apart.
   */
  const [askedFor, setAskedFor] = useState<{ lines: boolean }>({ lines: false });
  /**
   * 74 §3.6.10 — whether the retake choice has been made in this sitting. A retake is any take opened when a
   * finished profile already exists: it silently loaded every previous answer, and the only route to a clean
   * run was a destructive button at the bottom of a screen nobody scrolls to.
   */
  const [retakeChoice, setRetakeChoice] = useState(false);
  /** In-flight edits to an already-answered question, until saved. */
  const [editedAnswers, setEditedAnswers] = useState<Record<string, string>>({});
  /**
   * 74 §3.6.19 — which moment category is open. Null is the strip on its own, before one is chosen.
   *
   * This is a VIEW selection and nothing more: switching categories no longer discards anything, because the
   * moments themselves are read back from the take's own turns rather than living only in a store slot that
   * a restart emptied.
   */
  const [openMoment, setOpenMoment] = useState<string | null>(null);
  useEffect(() => {
    if (practice !== 'unknown' || store.phase !== 'bank' || !bank) return;
    setPractice(Object.keys(store.marks).length === 0 ? 'needed' : 'done');
  }, [practice, store.phase, bank, store.marks]);
  // Adopt the saved position once the bank arrives (it is device-local, so it comes with the bank read).
  const adopted = useRef(false);
  useEffect(() => {
    if (adopted.current || !store.bank) return;
    adopted.current = true;
    // Clamp: the saved index is only meaningful against the bank it was saved from. If a family is ever
    // retired the stale index lands past the end, `families[i]` is undefined, and the deck renders a blank
    // screen with no way forward — so a position we can't honour degrades to the start, not to nothing.
    const last = Math.max(0, store.bank.families.length - 1);
    if (store.bank.resumeArea > 0) setAreaIndex(Math.min(store.bank.resumeArea, last));
  }, [store.bank]);
  const [selfIdentity, setSelfIdentity] = useState<'man' | 'woman' | 'either' | null>(null);
  const [partnerIdentity, setPartnerIdentity] = useState<'man' | 'woman' | 'either' | null>(null);
  // Seed from what they already answered, or re-opening the screen shows an empty form with Start disabled
  // and no way to see the current answer.
  const seededAddress = useRef(false);
  useEffect(() => {
    if (seededAddress.current || !store.bank?.identity) return;
    seededAddress.current = true;
    setSelfIdentity(store.bank.identity.self);
    setPartnerIdentity(store.bank.identity.partner);
  }, [store.bank]);
  const area = bank?.families[areaIndex];
  const areaEntries = useMemo(
    () => (bank && area ? bank.entries.filter((entry) => entry.family === area.id) : []),
    [bank, area],
  );
  /*
   * 74 §3.6.34 — "still unmarked", on BOTH marking steps.
   *
   * The hard thing on a second visit is not choosing an area, it is finding the rows inside it you have not
   * answered — 36 areas of up to 47 rows here, a 123-row register there. The filter is per-step state rather
   * than a store field: it is a way of LOOKING at the current screen, and it should not follow you to the
   * next area or survive a reload as a half-hidden list.
   */
  const [showOnly, setShowOnly] = useState<'all' | 'new'>('all');
  const visibleAreaEntries = useMemo(
    () => (showOnly === 'all' ? areaEntries : areaEntries.filter((e) => !store.marks[e.key])),
    [areaEntries, showOnly, store.marks],
  );
  const withheld = area ? (bank?.withheldByFamily[area.id] ?? 0) : 0;
  /**
   * The direction this area is actually being rated in. Orientation resolves it per entry, and in practice an
   * area comes out uniform — so when it is, the whole area gets ONE clear sentence; when it isn't, each row
   * carries its own visible marker. Either way the person is never left guessing.
   */
  const areaSides = useMemo(() => {
    const shapes = new Set(areaEntries.map((entry) => [...entry.sides].sort().join('+')));
    if (shapes.size !== 1) return null;
    return areaEntries[0]?.sides ?? null;
  }, [areaEntries]);
  /**
   * 74 §3.6.9 — the step model, and the one place the rail, the map and every frame read their state from.
   *
   * The AI phases used to fire themselves on arrival (`started.current[phase]` → `loadLines`/`nextProbe`). With a
   * rail you can reach any step from anywhere, so that turned a mis-tap into a billed call — and both
   * `testsAdaptiveLines` and `testsAdaptiveScenario` will happily write from an empty lexicon. Every AI step now
   * presents itself and waits to be asked.
   */
  const closed = useMemo(
    () => new Set((store.state?.draft?.turns ?? []).map((turn) => turn.phase)),
    [store.state],
  );
  /*
   * 74 §3.6.19 — every moment ever written for this take, per category.
   *
   * The generated moments used to live ONLY in `store.scenarios`, which one tap on "pick a different moment"
   * emptied and any restart lost. With the options now persisted on the turn, an answered moment is a
   * complete record — the scene, the choices it offered, and the pick — so a category can be re-opened and
   * re-picked for free instead of costing another five moments that are not the ones you answered.
   *
   * Fresh moments from this sitting are merged in on top, deduped by scene: an unanswered one has no turn to
   * be read back from, so without that merge a pass would vanish the moment you looked at another category.
   */
  const momentsByContext = new Map<
    string,
    { context: string; scene: string; options: string[]; picked: string | null }[]
  >();
  const addMoment = (m: {
    context: string;
    scene: string;
    options: string[];
    picked: string | null;
  }): void => {
    const list = momentsByContext.get(m.context) ?? [];
    if (list.some((prior) => prior.scene === m.scene)) return;
    list.push(m);
    momentsByContext.set(m.context, list);
  };
  for (const turn of store.state?.draft?.turns ?? []) {
    if (turn.phase !== 'scenario') continue;
    addMoment({
      context: turn.item.id.split('#')[0] ?? '',
      scene: turn.item.text,
      options: turn.item.options ?? [],
      picked: typeof turn.answer === 'string' ? turn.answer : null,
    });
  }
  for (const fresh of store.scenarios) addMoment({ ...fresh, picked: null });
  // A moment answered before options were persisted has a scene and a pick but nothing to re-pick among;
  // it still shows what was chosen, which is better than pretending the moment never happened.
  /**
   * 74 §3.6.21 — the take's running spend, for the rail.
   *
   * Admin-only by construction: the bridge strips `costUsd` for anyone without `budgets.manage` (the durable
   * 06 rule — the $ boundary is the bridge, never the UI), so its presence is the gate and no check is needed
   * here. Every AI phase accrues onto the draft, so this is the whole take, not the last call.
   */
  const takeSpend = store.state?.draft?.costUsd;

  const openMoments = openMoment ? (momentsByContext.get(openMoment) ?? []) : [];
  const answeredIn = (context: string): number =>
    (momentsByContext.get(context) ?? []).filter((m) => m.picked).length;

  const statuses = useMemo(
    () =>
      stepStatuses({
        phase: store.phase,
        closed,
        skipped: store.skipped as StepId[],
        nameMarks: Object.keys(store.nameMarks).length,
        bankMarks: marked.length,
        lineReactions: Object.keys(store.lineReactions).length,
        probesAnswered: (store.state?.draft?.turns ?? []).filter((turn) => turn.phase === 'probe')
          .length,
        // 74 §3.6.19 — CATEGORIES worked, not raw picks: "8" told a person nothing about how far through
        // the six moments they were, and the rail sat it beside 132 marks as though the two compared.
        scenariosAnswered: CONTEXTS.filter((c) => answeredIn(c.id) > 0).length,
        momentCategories: CONTEXTS.length,
        seeded: store.seeded,
        identityAnswered: store.bank?.address !== undefined,
        // Per direction on both steps now — a term loved to hear but ruled out to say is one loved answer,
        // and before §3.6.26 the deck could only ever contribute a whole-entry one.
        loved: [...Object.values(store.marks), ...Object.values(store.nameMarks)].filter(
          (mark) => mark.hear === 'love' || mark.say === 'love',
        ).length,
      }),
    [
      store.phase,
      closed,
      store.skipped,
      store.nameMarks,
      marked.length,
      store.marks,
      store.lineReactions,
      store.state,
      store.seeded,
      store.bank,
    ],
  );
  /** The two marking steps' tallies, so both render the same card from one place. */
  const bankTally = useMemo(() => {
    const out = { love: 0, okay: 0, never: 0 };
    // Counted per DIRECTION since §3.6.26, exactly like the names — a term can be loved one way and ruled
    // out the other, and a single number for the row could only ever tell half of that.
    for (const mark of Object.values(store.marks)) {
      if (mark.hear) out[mark.hear] += 1;
      if (mark.say) out[mark.say] += 1;
    }
    return out;
  }, [store.marks]);
  const nameTally = useMemo(() => {
    const out = { love: 0, okay: 0, never: 0 };
    for (const mark of Object.values(store.nameMarks)) {
      if (mark.hear) out[mark.hear] += 1;
      if (mark.say) out[mark.say] += 1;
    }
    return out;
  }, [store.nameMarks]);

  /**
   * The names step needs its (free, AI-less) view before it can render anything. Entering it from the rail or the
   * map may arrive before that read has happened — and `loadNames` is also what moves a bank with no name
   * families past this step rather than stranding someone on an empty screen.
   */
  const { phase: livePhase, busy: liveBusy, names: liveNames } = store;
  const hasAddress = store.bank?.address !== undefined;
  useEffect(() => {
    if (livePhase === 'names' && liveNames === null && !liveBusy) {
      void useAdaptiveTestStore.getState().loadNames(testId);
      return;
    }
    // The words step's prerequisite, enforced wherever the step is entered from — the rail, the map, a submit,
    // or the names phase bouncing through a bank with no name families. Without the two taps the deck fails
    // OPEN and shows everything in both directions (§3.6.3), so one route in must not be able to skip them.
    if (livePhase === 'bank' && !hasAddress && !liveBusy) {
      useAdaptiveTestStore.getState().setPhase('address');
    }
  }, [livePhase, liveNames, liveBusy, hasAddress, testId]);

  const stepIndex = statuses.findIndex((status) => status.state === 'now');
  const identityStep = statuses.find((status) => status.step.id === 'identity') ?? null;
  const current = stepIndex >= 0 ? statuses[stepIndex] : null;
  const upNext = current ? nextStepAfter(statuses, current.step.id) : null;

  /**
   * Going to a step never spends — except the profile, which IS the synthesis.
   *
   * It FLUSHES first. The readiness gate and every AI phase read the LEXICON, not the store, so marks still
   * sitting in the 700ms debounce are marks the next step cannot see: mark fifteen names, tap into "Lines for
   * you", and it refuses with "mark a few more" over work you just did. Measured, not guessed — waiting for the
   * save to land is what made a live run produce lines instead of that refusal. Same class as the synthesize
   * bug one level up: leaving a step is a save point, and only finishing was treating it as one.
   */
  const goTo = (id: StepId): void => {
    void store.flush(testId).then(() => {
      // NOT `synthesize`. Every other AI step presents itself and waits to be asked (§3.6.9); this one ran
      // the moment you navigated to it, so the most expensive step was the only one you could not look at
      // without paying for it.
      store.goToStep(phaseForStep(id));
      return undefined;
    });
  };
  /**
   * 74 §3.6.30 — back to the map from any step.
   *
   * Flushes first for the same reason `goTo` does: the marking steps autosave on a 700ms debounce, and
   * leaving the step inside that window would drop the last few taps — the moment a person is most likely
   * to be navigating away.
   */
  const goToMap = (): void => {
    void store.flush(testId).then(() => {
      store.setPhase('map');
      return undefined;
    });
  };
  const skipCurrent = (): void => {
    if (!current) return;
    // Skipping the last step before the profile lands on the MAP, never on a synthesis: a skip is passing
    // something over, and it must never be the thing that spends. Finishing is its own explicit verb.
    const next = upNext && upNext.step.id !== 'profile' ? phaseForStep(upNext.step.id) : null;
    void store.flush(testId).then(() => store.skipStep(current.step.id, next));
  };
  const stepActions = (nextLabel?: string, onNext?: () => void): JSX.Element => (
    <StepActions
      next={upNext}
      busy={store.busy}
      {...(nextLabel !== undefined ? { nextLabel } : {})}
      onNext={() => {
        if (onNext) onNext();
        else if (upNext) goTo(upNext.step.id);
      }}
      onSkip={skipCurrent}
      onFinish={() => void store.synthesize(testId)}
    />
  );
  const goToArea = (next: number): void => {
    const last = (bank?.families.length ?? 1) - 1;
    const index = next < 0 ? 0 : next > last ? last : next;
    setAreaIndex(index);
    setShowOnly('all');
    void store.rememberArea(index);
    // A new area starts at the top; otherwise you land mid-list on a screen you have never seen. Scoped to
    // the app's own scroll container rather than every element in the document.
    const scroller = document.querySelector('[data-app-scroll]') ?? document.scrollingElement;
    if (scroller) scroller.scrollTop = 0;
    // …and move FOCUS to the new area's name. Everything below the button changed, and a keyboard or screen
    // reader user was left focused on Next with 36 silent screen changes and no idea what they were looking
    // at. The Together wrap-up precedent: on a transition this large, focus the thing that changed.
    requestAnimationFrame(() => areaHeadingRef.current?.focus());
  };
  const nextArea = (): void => goToArea(areaIndex + 1);

  /*
   * 74 §3.6.34 — the names step navigates like the words step, because they are two screens of one test.
   *
   * The words step has had an in-place area picker and Previous/Next in the rail since §3.6.22; the names
   * step still made you leave the register, land back on a grid and choose again. Same shape now: the
   * register list is a stable order (the bank's, never the card sort — an index that moves when you re-sort
   * is worse than no index), and the verbs live in the rail rather than in a card of their own.
   */
  const registers = store.names?.registers ?? [];
  const openRegisterIndex = registers.findIndex((r) => r.id === store.openRegister);
  const goToRegister = (next: number): void => {
    const last = registers.length - 1;
    const target = registers[next < 0 ? 0 : next > last ? last : next];
    if (!target) return;
    store.setOpenRegister(target.id);
    const scroller = document.querySelector('[data-app-scroll]') ?? document.scrollingElement;
    if (scroller) scroller.scrollTop = 0;
    requestAnimationFrame(() => registerHeadingRef.current?.focus());
  };

  // Withheld in the bridge until the 18+ ack — the hub is where that ack lives.
  if (store.loaded && !bank) {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <Stack gap={4}>
            <Banner tone="warning">
              <Lock size={14} aria-hidden="true" /> This one is 18+. Acknowledge on the Tests page
              to open it.
            </Banner>
            <Button variant="secondary" onClick={() => navigate('/tests')}>
              ← Back to Tests
            </Button>
          </Stack>
        </div>
      </div>
    );
  }

  if (!bank || !store.state) {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <Text tone="secondary">Loading…</Text>
        </div>
      </div>
    );
  }

  /*
   * `done` is not a phase you can sit on. Arriving with retake intent, it is still `done` from the last
   * synthesis, and the effect that moves it runs AFTER the first paint — so the screen rendered nothing at
   * all (no branch handles `done`) and the redirect was suppressed. A blank page with a back link.
   * Deriving it means the very first render is already the map.
   */
  const phase =
    store.phase === 'done' && routeState?.retake
      ? 'map'
      : // …and the same for the way IN: `start()` above is two awaits deep, so without deriving it the intro
        // renders for the whole round trip — the very screen the report was about. Deliberately NOT applied to
        // `done`, which is handled above and only under retake intent: `hasPriorWork` is true for the whole of
        // every take, so mapping `done` on it would land someone on the map at the end of the take they just
        // finished instead of on the profile they finished it for.
        store.phase === 'intro' && hasPriorWork
        ? 'map'
        : store.phase;

  /**
   * Every line already reacted to in this take, so returning to the step shows the set rather than an empty
   * screen. A new round used to replace `store.lines` and the previous round's reactions were unreachable —
   * recorded, and invisible. Reacting again replaces the turn in place.
   */
  const reactedLines = (store.state?.draft?.turns ?? [])
    .filter((turn) => turn.phase === 'lines' && typeof turn.answer === 'string')
    .map((turn) => turn.item.text);
  const shownLines = [...new Set([...store.lines, ...reactedLines])];

  /**
   * Every question already put to them in this take, with what they said — the reviewable, editable set.
   *
   * A SKIPPED question is not an answered one (74 §3.6.17). It used to be recorded as `''`, which is a
   * string, so this counted it and rendered it under an "Answered" label with an empty box.
   */
  const askedQuestions = (store.state?.draft?.turns ?? [])
    .filter((turn) => turn.phase === 'probe' && isAnsweredTurn(turn.answer))
    .map((turn) => ({
      id: turn.item.id,
      question: turn.item.text,
      answer: String(turn.answer),
      options: turn.item.options ?? [],
    }));

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Stack gap={4}>
          <button type="button" className={take.back} onClick={() => navigate('/tests')}>
            ← Tests
          </button>

          {store.progress ? (
            <Progress phase={store.progress.phase} startedAt={store.progress.startedAt} />
          ) : null}

          {/* A failed bridge call. Rendered at the top of every phase because the guard that sets it
              wraps every action — an unrendered error field would be the same silent freeze it exists to
              fix. The phase is left where it was, so the button that failed is right there to try again. */}
          {store.error ? <Banner tone="warning">{store.error}</Banner> : null}

          {/*
           * The invitation. It used to be a stack of left-aligned paragraphs and two info banners floating on
           * an otherwise empty canvas, with the estimate on its own line and the buttons hanging off the
           * right — no hierarchy, no shape, nothing that reads as an invitation to something intimate.
           * Now: a bounded card with the promise as three plain facts, the privacy line where it belongs
           * (attached to the promise, not shouted in a banner), and one clear action.
           */}
          {phase === 'intro' ? (
            <div className={adaptive.introWrap}>
              <AdaptiveHead
                title={store.state.title}
                lead={store.state.blurb}
                framing={store.state.framing}
              />

              <Card className={adaptive.introCard}>
                <ul className={adaptive.introFacts}>
                  <li>
                    <ListChecks size={17} aria-hidden="true" />
                    <span>
                      <b>You mark words, not answers.</b> Tap what lands, skip the rest — most of it
                      won&rsquo;t be yours, and that&rsquo;s the point.
                    </span>
                  </li>
                  <li>
                    <Clock size={17} aria-hidden="true" />
                    <span>
                      <b>About {store.state.estimatedMinutes} minutes,</b> and it saves every tap.
                      Stop anywhere and come back — it picks up where you were.
                    </span>
                  </li>
                  <li>
                    <Lock size={17} aria-hidden="true" />
                    <span>
                      <b>Nobody reads this.</b> It shapes how SelfOS talks to you, and it can
                      quietly shape what a partner&rsquo;s coach suggests to them — never telling
                      them what you said.
                    </span>
                  </li>
                </ul>

                {store.state.draft ? (
                  <div className={adaptive.introResume}>
                    <Text size="sm" tone="secondary">
                      You have a take in progress — the next screen shows where you got to and lets
                      you pick up anywhere in it.
                    </Text>
                  </div>
                ) : null}

                <div className={adaptive.introActions}>
                  <Button variant="primary" onClick={() => void store.start(testId)}>
                    {store.state.draft ? 'Pick up where you left off' : 'Begin'}
                  </Button>
                </div>
              </Card>
            </div>
          ) : null}

          {/* 74 §3.6.9 — every step, before the first one and reachable from all of them. */}
          {phase === 'map' ? (
            <TakeMap
              statuses={statuses}
              resuming={statuses.some((status) => status.count > 0)}
              busy={store.busy}
              onGo={goTo}
              onStart={() => {
                const target =
                  statuses.find((status) => status.state === 'open' && status.count === 0) ??
                  statuses.find((status) => status.state === 'open') ??
                  statuses[0];
                if (target) goTo(target.step.id);
              }}
              onAbandon={
                store.state.draft
                  ? () =>
                      void store.abandon(testId).then(() => {
                        setPractice('unknown');
                        return store.start(testId);
                      })
                  : null
              }
              retake={
                !retakeChoice && store.state.latest
                  ? {
                      onKeep: () => setRetakeChoice(true),
                      onFresh: () => {
                        setRetakeChoice(true);
                        setPractice('unknown');
                        void store.abandon(testId).then(() => store.start(testId));
                      },
                    }
                  : null
              }
            />
          ) : null}

          {phase === 'address' && identityStep ? (
            <div className={adaptive.stepFrame}>
              <div className={adaptive.stepMain}>
                <StepEyebrow status={identityStep} index={0} total={TAKE_STEPS.length} />
                <Heading level={2}>Who are the two of you?</Heading>
                <Text tone="secondary">
                  Two questions, so the words you&rsquo;re shown are ones that could actually be
                  said between the two of you — and so &ldquo;what you like to hear&rdquo; means
                  lines about your body, not theirs.
                </Text>
                <div className={adaptive.idPair}>
                  <Card className={adaptive.identityCard}>
                    <span className={adaptive.identityLabel} id="adaptive-self-identity-label">
                      You are a:
                    </span>
                    <div
                      className={adaptive.pills}
                      role="group"
                      aria-labelledby="adaptive-self-identity-label"
                    >
                      {IDENTITY_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={adaptive.pill}
                          aria-pressed={selfIdentity === option.value}
                          onClick={() => {
                            setSelfIdentity(option.value);
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </Card>
                  <Card className={adaptive.identityCard}>
                    <span className={adaptive.identityLabel} id="adaptive-partner-identity-label">
                      Your partner is a:
                    </span>
                    <div
                      className={adaptive.pills}
                      role="group"
                      aria-labelledby="adaptive-partner-identity-label"
                    >
                      {IDENTITY_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={adaptive.pill}
                          aria-pressed={partnerIdentity === option.value}
                          onClick={() => {
                            setPartnerIdentity(option.value);
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </Card>
                </div>

                {/* The consequence, visible rather than described — it updates as they pick. */}
                {previewLines(selfIdentity, partnerIdentity).length > 0 ? (
                  <div className={adaptive.preview}>
                    <div className={adaptive.railHead}>So you&rsquo;ll be asked things like</div>
                    {previewLines(selfIdentity, partnerIdentity).map((line) => (
                      <div key={line.side} className={adaptive.previewRow}>
                        <span
                          className={`${adaptive.dirTag} ${line.side === 'say' ? adaptive.tagSay : adaptive.tagHear}`}
                        >
                          {line.side === 'say' ? 'YOU SAY' : 'YOU HEAR'}
                        </span>
                        <em>&ldquo;{line.text}&rdquo;</em>
                      </div>
                    ))}
                    <Text size="sm" tone="tertiary">
                      {/* This said "nothing is ruled out, and no mark is lost" — true while orientation
                          was only a display filter, and false since it started pruning (§3.6.3): a mark on
                          a direction this hides is cleared on the tap itself. Saying so costs one line and
                          is cheaper than the surprise. */}
                      Change this any time. It decides what you&rsquo;re shown — and clears any
                      marks on a direction it hides.
                    </Text>
                  </div>
                ) : (
                  <Text size="sm" tone="tertiary">
                    Change this any time. It decides what you&rsquo;re shown — and clears any marks
                    on a direction it hides.
                  </Text>
                )}
              </div>
              <TakeRail
                statuses={statuses}
                onGo={goTo}
                onMap={goToMap}
                spendUsd={takeSpend}
                actions={
                  <>
                    <Button
                      variant="primary"
                      disabled={store.busy || !selfIdentity || !partnerIdentity}
                      onClick={() => {
                        if (!selfIdentity || !partnerIdentity) return;
                        void store.setAddress(
                          testId,
                          // The address axis is DERIVED from identity now. It only orients four anatomy/praise
                          // families, and the vocative question it used to ask ("do you like being called
                          // girl?") is answered far better one step over, by marking 2,215 real names in both
                          // directions — so asking it here was the wrong axis doing a body job, twice.
                          addressFor(selfIdentity),
                          addressFor(partnerIdentity),
                          { self: selfIdentity, partner: partnerIdentity },
                        );
                      }}
                    >
                      Next: what you call each other →
                    </Button>
                    <Button variant="ghost" onClick={() => store.setPhase('map')}>
                      Back to the steps
                    </Button>
                  </>
                }
              />
            </div>
          ) : null}

          {/* 74 §3.6.8 — the pet-name phase runs first: what the two of you call each other. */}
          {phase === 'names' ? (
            <NamesPhase
              headingRef={registerHeadingRef}
              onGoToRegister={goToRegister}
              rail={
                <TakeRail
                  statuses={statuses}
                  onGo={goTo}
                  onMap={goToMap}
                  spendUsd={takeSpend}
                  saveState={<SaveState state={store.saveState} />}
                  extra={
                    <Tally
                      counts={nameTally}
                      label="Names marked"
                      testIdPrefix="name-tally"
                      note={`${Object.keys(store.nameMarks).length} ${
                        Object.keys(store.nameMarks).length === 1 ? 'name' : 'names'
                      } · both directions counted`}
                    />
                  }
                  actions={
                    <>
                      {/* Inside a register the primary moves you ON rather than out, exactly as the words
                          step's does — walking straight out from here would step past every register you
                          have not opened (the §3.6.9 walk, finding 3). */}
                      {store.openRegister && openRegisterIndex + 1 < registers.length ? (
                        <Button
                          variant="primary"
                          disabled={store.busy}
                          onClick={() => goToRegister(openRegisterIndex + 1)}
                        >
                          Next register →
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          disabled={store.busy}
                          onClick={() => void store.finishNames(testId)}
                        >
                          Done with names →
                        </Button>
                      )}
                      {store.openRegister && openRegisterIndex > 0 ? (
                        <Button
                          variant="secondary"
                          className={adaptive.railBack}
                          disabled={store.busy}
                          onClick={() => goToRegister(openRegisterIndex - 1)}
                        >
                          {/* ONE flex child — `Button` is a flex container with a gap (§3.6.13). */}
                          <span>
                            ←<span className={adaptive.tail}> Previous register</span>
                          </span>
                        </Button>
                      ) : null}
                      {store.openRegister ? (
                        <Button
                          variant="ghost"
                          disabled={store.busy}
                          onClick={() => store.setOpenRegister(null)}
                        >
                          All registers
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        className={adaptive.railDone}
                        disabled={store.busy}
                        onClick={() => void store.synthesize(testId)}
                      >
                        Finish — show me my profile
                      </Button>
                    </>
                  }
                />
              }
            />
          ) : null}

          {/*
           * The practice sits OUTSIDE the deck: `.deck` clips to its own radius, and a fixed-position scrim
           * nested inside a clipped box is a bug waiting to happen. It still covers the rows — its scrim is
           * the viewport.
           */}
          {phase === 'bank' && area && practice === 'needed' ? (
            <PracticeSheet
              entries={bank.entries}
              onMark={(key, side, mark) => store.mark(key, side, mark)}
              onDone={() => setPractice('done')}
              onLeave={() => store.setPhase('map')}
            />
          ) : null}

          {phase === 'bank' && area ? (
            <div className={adaptive.deck}>
              {/*
               * 74 §3.6.3 — DIRECTION, as a graphic. It used to be a sentence in body copy, which is how a
               * screen of lines about her body read as ambiguous: rating "you say" as though it were "you
               * hear" silently poisons the profile, so it has to be legible before anything is read. The
               * whole band changes colour with the direction, and the two pills show the flow.
               */}
              <div
                className={`${adaptive.band} ${areaSides?.length === 1 && areaSides[0] === 'hear' ? adaptive.bandHear : ''}`}
              >
                <span className={adaptive.flow}>
                  {areaSides?.length === 1 && areaSides[0] === 'hear' ? (
                    <>
                      <span className={`${adaptive.who} ${adaptive.them}`}>Them</span>
                      <ArrowRight size={16} aria-hidden="true" className={adaptive.arrow} />
                      <span className={`${adaptive.who} ${adaptive.me}`}>You</span>
                    </>
                  ) : (
                    <>
                      <span className={`${adaptive.who} ${adaptive.me}`}>You</span>
                      <ArrowRight size={16} aria-hidden="true" className={adaptive.arrow} />
                      <span className={`${adaptive.who} ${adaptive.them}`}>Them</span>
                    </>
                  )}
                </span>
                <span className={adaptive.bandText}>
                  {directionSentence(areaSides)}
                  {/* WHAT is being marked, said once. A word is loved in one line and hated in another
                      ("fuck your pussy" vs "beat that pussy"), so the mark has to be unmistakably on the
                      bolded word, with the quote as context. */}
                  <span className={adaptive.bandSub}>
                    You&rsquo;re marking the <b>bold word</b> — the quote just shows it in use.
                  </span>
                </span>
                <span className={adaptive.bandSpacer} />
                {/* SHORT, or it wraps the band's own sentence onto three lines. The full answer is the
                    tooltip and the screen it opens. */}
                <button
                  type="button"
                  className={adaptive.change}
                  title={`Shown for ${addressSummary(bank.address)}`}
                  onClick={() => store.setPhase('address')}
                >
                  {pairShorthand(bank.identity)} — change
                </button>
              </div>

              <div className={adaptive.deckHead}>
                <div className={adaptive.headTop}>
                  {/* Focus target for an area change (see `goToArea`). `tabIndex={-1}` makes it
                      programmatically focusable without adding a tab stop. */}
                  <div ref={areaHeadingRef} tabIndex={-1} className={adaptive.deckHeadTitle}>
                    <Heading level={2}>{area.label}</Heading>
                  </div>
                  <Text size="sm" tone="tertiary">
                    Area {areaIndex + 1} of {bank.families.length} · {areaEntries.length} here
                  </Text>
                  <span className={adaptive.headSpacer} />
                  {/*
                   * 74 §3.6.22 — go straight to an area.
                   *
                   * There were 36 of them and only prev/next, so revisiting one the profile had just told
                   * you something about meant tapping "Next area" twenty times. A full-width `Select`, not a
                   * row of chips: 36 labels of any length would wrap into a pile or scroll sideways, and §12
                   * says a control that doesn't fit gets a space-filling component rather than a wrap.
                   */}
                  <Select
                    aria-label="Go to an area"
                    className={adaptive.areaJump}
                    value={String(areaIndex)}
                    onChange={(e) => goToArea(Number(e.currentTarget.value))}
                  >
                    {bank.families.map((family, index) => {
                      const done = bank.entries.filter(
                        (entry) => entry.family === family.id && store.marks[entry.key],
                      ).length;
                      return (
                        <option key={family.id} value={index}>
                          {index + 1}. {family.label}
                          {done > 0 ? ` · ${done} marked` : ''}
                        </option>
                      );
                    })}
                  </Select>
                </div>
                {/*
                 * 74 §3.6.34 — the bar is gone; "Area N of M" stays.
                 *
                 * It filled toward 100% as you moved through the areas, which is a meter filling toward a
                 * full width — the thing §3.6.29's durable rule names — and it reached full on the last area
                 * whether you had marked everything or nothing. §3.6.29 removed exactly this from the name
                 * register cards and left it here, which is also why the two steps read differently. The
                 * COUNT survives: the rule's line is the denominator paired with a meter, not the count.
                 */}
                {area.note ? (
                  <Text tone="secondary" className={adaptive.areaNote}>
                    {area.note}
                  </Text>
                ) : null}
                <Text size="sm" tone="tertiary" className={adaptive.deckNote}>
                  Every tap saves itself. Stop anywhere.{' '}
                  <button
                    type="button"
                    className={adaptive.textLink}
                    onClick={() => setHelpOpen((open) => !open)}
                    aria-expanded={helpOpen}
                  >
                    How marking works
                  </button>
                </Text>
                {/* Four stacked paragraphs used to sit above every area. They are one link now. */}
                {helpOpen ? (
                  <Text size="sm" tone="secondary" className={adaptive.deckHelp}>
                    Only tap what actually does something for you — skip the rest.{' '}
                    <Flame size={13} aria-hidden="true" /> if you love it,{' '}
                    <Contrast size={13} aria-hidden="true" /> if it&rsquo;s okay,{' '}
                    <Ban size={13} aria-hidden="true" /> if it&rsquo;s a no. A <em>never</em> is a
                    boundary: nothing in SelfOS will suggest it again. Moving on skips whatever you
                    left alone, and everything saves as you go.
                  </Text>
                ) : null}
              </div>

              <div className={adaptive.deckBody}>
                <div className={adaptive.rows}>
                  {areaEntries.length > 0 ? (
                    <MarkFilter
                      value={showOnly}
                      onChange={setShowOnly}
                      total={areaEntries.length}
                      shown={visibleAreaEntries.length}
                      noun="here"
                    />
                  ) : null}
                  {areaEntries.length === 0 ? (
                    /* Every term here is aimed at a body or a role that is neither of theirs (common on a
                       same-sex configuration, where whole areas resolve to one side). */
                    <Text tone="secondary">
                      Nothing in this area is aimed at either of you, so there&rsquo;s nothing to
                      mark here.
                    </Text>
                  ) : visibleAreaEntries.length === 0 ? (
                    <Text tone="secondary">
                      Every line in this area is marked. Switch to <b>Everything</b> to change one.
                    </Text>
                  ) : (
                    visibleAreaEntries.map((entry) => {
                      // Nothing is settled: a no is a preference, changeable in any sitting
                      // (74 §3.2, amended 2026-08-19). A row used to freeze once the take that set it
                      // closed, which stranded a mis-tap noticed the next day.
                      const mark = store.marks[entry.key] ?? {};
                      const shownSides = (['hear', 'say'] as const).filter((side) =>
                        entry.sides.includes(side),
                      );
                      const answered = shownSides.some((side) => mark[side] !== undefined);
                      /*
                       * The row greys out only when EVERY side they were shown is explicitly a no.
                       *
                       * It first read `(mark.hear ?? 'never') === 'never'`, which counts an UNANSWERED side
                       * as a refusal — so ruling out one direction greyed the whole row while the other was
                       * still blank, or worse, loved. The two directions are separate answers (§3.6.26);
                       * only the row where both are a no is a row with nothing in it.
                       */
                      const allNo = answered && shownSides.every((side) => mark[side] === 'never');
                      return (
                        <div
                          key={entry.key}
                          className={`${adaptive.row} ${adaptive.nameRow} ${
                            answered && !allNo ? adaptive.rowOn : ''
                          } ${allNo ? adaptive.rowNo : ''}`}
                        >
                          <div className={adaptive.line}>
                            {/*
                             * 74 §3.6.1 — the HIERARCHY is the explanation. This row made the quote the
                             * visual hero and the word a tiny uppercase label, which reads as "rate this
                             * sentence" — the opposite of what the mark does. A sentence of prose saying
                             * otherwise gets skimmed; making the thing you're rating the biggest thing in
                             * the row can't be. So the word leads at reading size and its quote sits
                             * underneath, prefixed, as context.
                             *
                             * It also separates the two kinds of row without a word of explanation: a word
                             * row is a big word over a small "as in …"; a whole-line row is just the line.
                             */}
                            <div className={adaptive.rated}>
                              {entry.example ? entry.text : `“${entry.text}”`}
                              {/* Trailing the word, not on a line of its own — it read as an orphaned
                                  fragment between the word and its quote. */}
                              <span className={adaptive.termInline}>
                                {/* Intensity as a 3-bar meter with a text equivalent (§9) — it was a bare
                                  5px dot with no legend and nothing a screen reader could read. */}
                                <span
                                  className={`${adaptive.heat} ${entry.tier >= 4 ? adaptive.heatHi : ''}`}
                                  title={entry.tier >= 4 ? 'more intense' : 'gentler'}
                                >
                                  {[1, 2, 3].map((step) => (
                                    <i
                                      key={step}
                                      className={
                                        step <= Math.ceil(entry.tier / 2) ? adaptive.lit : ''
                                      }
                                    />
                                  ))}
                                  <span className={adaptive.srOnly}>
                                    {entry.tier >= 4 ? 'more intense' : 'gentler'}
                                  </span>
                                </span>
                              </span>
                            </div>
                            {/* The line you react to is the hero of the row — with the word you're actually
                                marking bolded inside it, so the quote reads as context, not as the thing
                                being rated. */}
                            {/* Context UNDER the word, prefixed so it can never read as the thing being
                                marked. The word stays bolded inside it, so the eye connects the two with no
                                label at all. */}
                            <div className={adaptive.said}>
                              {entry.example ? (
                                <>
                                  <span className={adaptive.asIn}>as in</span>{' '}
                                  {(() => {
                                    const split = boldTermInQuote(entry.example, entry.text);
                                    if (!split) return `“${entry.example}”`;
                                    return (
                                      <>
                                        “{split.before}
                                        <b className={adaptive.saidWord}>{split.hit}</b>
                                        {split.after}”
                                      </>
                                    );
                                  })()}
                                </>
                              ) : (
                                <span className={adaptive.asIn}>
                                  the whole line — marked as it is
                                </span>
                              )}
                            </div>
                          </div>
                          {/*
                           * 74 §3.6.26 — TWO marks, one per direction, both on the row.
                           *
                           * The deck used to take one mark for the whole term and then ask the hear/say
                           * question separately: first as its own step, then (§3.6.13) folded into the row as
                           * a 0–4 pair that appeared only AFTER a `love`, showed nothing selected over a
                           * value that was already set, and sat under a band still promising "the next step".
                           * So the two directions came out equal for most terms, and the gap between them —
                           * the goal list, the practice sheet, the "wants to say but freezes" material —
                           * could only fill from the pet names, which had asked both ways all along.
                           *
                           * This is the names' own layout, reused: both pills are `flex: 1 1 auto`, so where
                           * orientation offers only one direction the survivor stretches across the row on
                           * its own — no gap, and nothing to explain.
                           */}
                          <div className={adaptive.nameMarksRow}>
                            {(['hear', 'say'] as const)
                              .filter((side) => entry.sides.includes(side))
                              .map((side) => {
                                const current = mark[side];
                                const who = side === 'hear' ? 'Them → You' : 'You → Them';
                                return (
                                  <span
                                    key={side}
                                    className={side === 'hear' ? adaptive.colMe : adaptive.colThem}
                                  >
                                    <span className={adaptive.colWho}>
                                      {who}
                                      <small>
                                        {side === 'hear' ? 'I like hearing it' : 'I like saying it'}
                                      </small>
                                    </span>
                                    <span className={adaptive.marks}>
                                      {DECK_MARKS.map(({ value, label, Icon }, i) => (
                                        <span key={value} className={adaptive.markSlot}>
                                          {/* The no is set apart, so it is never a mis-tap neighbour — a
                                              preference you can change any time, not a door that locks. */}
                                          {i === 2 ? (
                                            <span className={adaptive.markGap} aria-hidden="true" />
                                          ) : null}
                                          <button
                                            type="button"
                                            className={`${adaptive.mark} ${adaptive[value]} ${
                                              current === value ? adaptive.markOn : ''
                                            }`}
                                            aria-pressed={current === value}
                                            aria-label={`${entry.text} — ${who} — ${label}`}
                                            onClick={() => store.mark(entry.key, side, value)}
                                          >
                                            <Icon size={17} aria-hidden="true" />
                                          </button>
                                        </span>
                                      ))}
                                    </span>
                                  </span>
                                );
                              })}
                          </div>
                        </div>
                      );
                    })
                  )}

                  {withheld > 0 ? (
                    <div className={adaptive.withheld}>
                      <Text size="sm" tone="tertiary">
                        {withheld} {withheld === 1 ? 'term is' : 'terms are'} hidden here —
                        they&rsquo;re aimed at a body or a role that isn&rsquo;t yours or theirs.
                        Change that in{' '}
                        <button
                          type="button"
                          className={adaptive.textLink}
                          onClick={() => store.setPhase('address')}
                        >
                          Before we start
                        </button>
                        .
                      </Text>
                    </div>
                  ) : null}
                </div>

                {/*
                 * The rail. Next / Previous / Done used to sit under 47 rows, so finishing meant scrolling
                 * an entire area you had already decided about; and the running tally makes a partial pass
                 * visibly worth something, which §3.6.1 #3 says it is.
                 */}
                <TakeRail
                  statuses={statuses}
                  onGo={goTo}
                  onMap={goToMap}
                  spendUsd={takeSpend}
                  saveState={<SaveState state={store.saveState} />}
                  extra={
                    <Tally
                      counts={bankTally}
                      label="Marked so far"
                      testIdPrefix="tally"
                      note={`${marked.length} of ${bank.entries.length} shown here`}
                    />
                  }
                  actions={
                    <>
                      {areaIndex + 1 < bank.families.length ? (
                        <Button variant="primary" disabled={store.busy} onClick={() => nextArea()}>
                          Next area →
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          disabled={store.busy}
                          onClick={() => void store.submitBank(testId)}
                        >
                          Done with the words →
                        </Button>
                      )}
                      {areaIndex > 0 ? (
                        <Button
                          variant="secondary"
                          className={adaptive.railBack}
                          disabled={store.busy}
                          onClick={() => goToArea(areaIndex - 1)}
                        >
                          {/* ONE flex child. `Button` is a flex container with a gap, so a bare text node
                              beside a span got the gap AND the JSX space — which is the odd double gap.
                              The label is hidden, not dropped, in the narrow bar (see `.railBack`). */}
                          <span>
                            ←<span className={adaptive.tail}> Previous area</span>
                          </span>
                        </Button>
                      ) : null}
                      {/* A partial pass is designed to be worth something, so finishing must never require
                          clicking through all 36 areas. */}
                      <Button
                        variant="ghost"
                        className={adaptive.railDone}
                        disabled={store.busy}
                        onClick={() => void store.submitBank(testId)}
                      >
                        {/* One flex child — see the Previous button above for why. */}
                        <span>
                          Done<span className={adaptive.tail}> with the words for now</span>
                        </span>
                      </Button>
                      {/* Three verbs on every step (74 §3.6.9). "Done for now" is not a skip — it closes the
                          pass and stamps it; passing over the words entirely is a different thing. */}
                      <Button variant="ghost" disabled={store.busy} onClick={skipCurrent}>
                        Skip this step
                      </Button>
                    </>
                  }
                />
              </div>
            </div>
          ) : null}

          {phase === 'lines' && current ? (
            <div className={adaptive.stepFrame}>
              <div className={adaptive.stepMain}>
                <StepEyebrow status={current} index={stepIndex} total={TAKE_STEPS.length} />
                <Heading level={2}>Does this land?</Heading>
                <Text tone="secondary">
                  Real lines in your own register, written from the names and words you&rsquo;ve
                  marked — never anything you&rsquo;ve ruled out. React honestly; this is where the
                  pattern shows.
                </Text>
                {/*
                 * 74 §3.6.9 — it waits to be ASKED. This phase used to fire on arrival, which with a rail
                 * turns any mis-tap into a billed call; and `testsAdaptiveLines` writes from an empty lexicon
                 * if you let it, so an unasked step also says what it will draw on before spending anything.
                 */}
                {current.state === 'now' && current.reason ? (
                  <NotEnoughYet reason={current.reason} onGo={() => goTo('bank')} />
                ) : null}
                {!current.reason && shownLines.length === 0 && !store.busy && !askedFor.lines ? (
                  <div className={adaptive.askRow}>
                    <Button
                      variant="primary"
                      onClick={() => {
                        setAskedFor((prev) => ({ ...prev, lines: true }));
                        void store.loadLines(testId, round);
                      }}
                    >
                      Write them for me →
                    </Button>
                    <Text size="sm" tone="tertiary">
                      a little of your AI allowance
                    </Text>
                  </div>
                ) : null}
                {/* Gated on the SHOWN set, not on a message: a degraded pass does not always carry one, and
                    gating on the message meant a failure with no reason rendered nothing at all. */}
                {shownLines.length === 0 && !store.busy && askedFor.lines ? (
                  <Stack gap={3}>
                    {/* The phase's OWN account of what happened. It used to fall through to the generic
                        "AI isn't set up yet — set up Claude in Settings", which is a lie whenever a key is
                        present and the call simply failed, and sends the person to fix something that isn't
                        broken (74 §3.6.12). */}
                    {store.linesMessage ? (
                      <Banner tone="warning">{store.linesMessage}</Banner>
                    ) : (
                      <AiUnavailableNotice />
                    )}
                    <div>
                      <Button
                        variant="secondary"
                        onClick={() => void store.loadLines(testId, round)}
                      >
                        Try again
                      </Button>
                    </div>
                  </Stack>
                ) : null}
                {shownLines.map((line) => (
                  <div key={line} className={adaptive.lineRow}>
                    <span className={adaptive.lineText}>
                      &ldquo;{line}&rdquo;
                      {/*
                       * 74 §3.6.2 — the "not like that" escape, and the ONLY place a line becomes a boundary.
                       *
                       * A word is loved in one line and hated in another ("fuck your pussy" vs "beat that
                       * pussy"), and this is the phase built to catch that. But a plain "no" here means "this
                       * line doesn't land" — it must NOT silently mint a boundary, because a boundary is
                       * permanent and lifts only by an explicit act (§3.2). So the soft reaction keeps steering
                       * register, and turning it into a limit takes this second, deliberate tap.
                       */}
                      {store.lineReactions[line] === 'no' ? (
                        <button
                          type="button"
                          className={adaptive.textLink}
                          onClick={() => void store.banLine(line)}
                          disabled={store.busy}
                        >
                          Never anything like this again
                        </button>
                      ) : null}
                    </span>
                    <span className={adaptive.marks}>
                      {(['love', 'meh', 'no'] as const).map((reaction) => (
                        <button
                          key={reaction}
                          type="button"
                          className={adaptive.markButton}
                          aria-pressed={store.lineReactions[line] === reaction}
                          aria-label={`${line} — ${reaction}`}
                          onClick={() => void store.reactToLine(testId, line, reaction)}
                        >
                          {reaction === 'love' ? (
                            <Flame size={16} aria-hidden="true" />
                          ) : reaction === 'meh' ? (
                            <Contrast size={16} aria-hidden="true" />
                          ) : (
                            <Ban size={16} aria-hidden="true" />
                          )}
                        </button>
                      ))}
                    </span>
                  </div>
                ))}
                {shownLines.length > 0 ? (
                  <div className={take.footer}>
                    <Button
                      variant="secondary"
                      disabled={store.busy}
                      onClick={() => {
                        setRound(round + 1);
                        void store.loadLines(testId, round + 1);
                      }}
                    >
                      Write me more lines
                    </Button>
                  </div>
                ) : null}
              </div>
              <TakeRail
                statuses={statuses}
                onGo={goTo}
                onMap={goToMap}
                actions={stepActions()}
                spendUsd={takeSpend}
              />
            </div>
          ) : null}

          {phase === 'probe' && current ? (
            <div className={adaptive.stepFrame}>
              <div className={adaptive.stepMain}>
                <StepEyebrow status={current} index={stepIndex} total={TAKE_STEPS.length} />
                <Heading level={2}>The questions it still has</Heading>
                {current.state === 'now' && current.reason ? (
                  <NotEnoughYet reason={current.reason} onGo={() => goTo('bank')} />
                ) : store.probeQuestion || askedQuestions.length > 0 ? (
                  <>
                    <Text tone="secondary">
                      Short ones, about the words themselves. Tap an answer or say more — nothing
                      you write here is shown to anyone. Everything you&rsquo;ve answered stays
                      below and can be changed.
                    </Text>
                    {/*
                     * The WHOLE set, with what you said, editable. It used to show one question and nothing
                     * else: no sense of how many there were, no way back to one you had answered, and a
                     * changed mind meant retaking. A pass writes several now, so the set is the screen.
                     */}
                    <Stack gap={3}>
                      {askedQuestions.map((asked) => (
                        <Card key={asked.id} className={adaptive.probeCard}>
                          <Text className={adaptive.probeAsk}>{asked.question}</Text>
                          {asked.options.length > 0 ? (
                            <Stack gap={2}>
                              {asked.options.map((option) => (
                                <Button
                                  key={option}
                                  variant={option === asked.answer ? 'primary' : 'secondary'}
                                  className={adaptive.optionButton}
                                  disabled={store.busy}
                                  onClick={() =>
                                    void store.reviseProbeAnswer(
                                      testId,
                                      asked.id,
                                      asked.question,
                                      option,
                                      asked.options,
                                    )
                                  }
                                >
                                  {option}
                                </Button>
                              ))}
                            </Stack>
                          ) : null}
                          {/*
                           * "Say more" — collapsed, because the taps are the fast path and a textarea under
                           * every one of six questions is the wall this step was trying to stop being. An
                           * answer that ISN'T one of the options (typed, or given before options existed) is
                           * shown expanded, or it would look like it had been lost.
                           */}
                          <SayMore
                            value={editedAnswers[asked.id] ?? asked.answer}
                            startOpen={
                              asked.options.length === 0 || !asked.options.includes(asked.answer)
                            }
                            busy={store.busy}
                            dirty={(editedAnswers[asked.id] ?? asked.answer) !== asked.answer}
                            label={asked.question}
                            onChange={(next) =>
                              setEditedAnswers((prev) => ({ ...prev, [asked.id]: next }))
                            }
                            onSave={() =>
                              void store.reviseProbeAnswer(
                                testId,
                                asked.id,
                                asked.question,
                                editedAnswers[asked.id] ?? asked.answer,
                                asked.options,
                              )
                            }
                          />
                        </Card>
                      ))}
                      {store.probeQuestion ? (
                        <Card className={adaptive.probeCard}>
                          <Text className={adaptive.probeAsk}>{store.probeQuestion}</Text>
                          {store.probeOptions.length > 0 ? (
                            <Stack gap={2}>
                              {store.probeOptions.map((option) => (
                                <Button
                                  key={option}
                                  variant="secondary"
                                  className={adaptive.optionButton}
                                  disabled={store.busy}
                                  onClick={() => void store.answerProbe(testId, option)}
                                >
                                  {option}
                                </Button>
                              ))}
                            </Stack>
                          ) : null}
                          <SayMore
                            value={store.probeAnswer}
                            // With no options there is nothing to tap, so the box IS the answer.
                            startOpen={store.probeOptions.length === 0}
                            busy={store.busy}
                            dirty={store.probeAnswer.trim() !== ''}
                            label={store.probeQuestion}
                            saveLabel="Answer →"
                            onChange={(next) =>
                              useAdaptiveTestStore.setState({ probeAnswer: next })
                            }
                            onSave={() => void store.answerProbe(testId)}
                          />
                          <div className={adaptive.askRow}>
                            <Button variant="ghost" onClick={() => void store.skipProbe(testId)}>
                              Skip this one
                            </Button>
                            {store.probeQueue.length > 0 ? (
                              <Text size="sm" tone="tertiary">
                                {store.probeQueue.length} more in this set
                              </Text>
                            ) : null}
                          </div>
                        </Card>
                      ) : (
                        <div className={adaptive.askRow}>
                          <Button
                            variant="secondary"
                            disabled={store.busy}
                            onClick={() => void store.nextProbe(testId)}
                          >
                            Ask me more
                          </Button>
                          {/* Honest about what a further set IS. Once the derived contradictions are used
                              up it keeps going from open ground, so a tap is a choice rather than an
                              endless loop that never says it has covered the specifics. */}
                          <Text size="sm" tone="tertiary">
                            {askedQuestions.length > 0
                              ? 'a little of your AI allowance · it moves on to open ground once the contradictions are used up'
                              : 'a little of your AI allowance'}
                          </Text>
                        </div>
                      )}
                    </Stack>
                  </>
                ) : store.probeMessage ? (
                  /* It FAILED. This used to be folded into `probeDone` below, so a failed call was reported
                     in the words of a success — "everything you marked was clear enough that it has no
                     question to ask" — and the only honest reading of the screen was that the step worked. */
                  <Card className={adaptive.probeCard}>
                    <Banner tone="warning">{store.probeMessage}</Banner>
                    <div className={adaptive.askRow}>
                      <Button
                        variant="secondary"
                        disabled={store.busy}
                        onClick={() => void store.nextProbe(testId)}
                      >
                        Try again
                      </Button>
                      <Button variant="ghost" onClick={() => goTo('bank')}>
                        Back to the words
                      </Button>
                    </div>
                  </Card>
                ) : store.probeDone ? (
                  /* Asked, and it had nothing left — which is a real outcome, not a failure. It used to
                     return the same `done` whether it had exhausted the ambiguities or had nothing to work
                     from at all, so the screen flashed past either way and never said which. */
                  <Card className={adaptive.probeCard}>
                    {/* Finished is a real outcome, but a screen that only ANNOUNCES one is a dead end — this
                        had 117px of content and not a single control on it. */}
                    <Text>
                      <b>Nothing left it can&rsquo;t work out.</b> Everything you marked was clear
                      enough that it has no question to ask — that&rsquo;s this step finished.
                    </Text>
                    <Text size="sm" tone="secondary">
                      Mark more and it may find something new to ask; otherwise carry on.
                    </Text>
                    <div className={adaptive.askRow}>
                      <Button
                        variant="primary"
                        disabled={store.busy}
                        onClick={() =>
                          upNext ? goTo(upNext.step.id) : void store.synthesize(testId)
                        }
                      >
                        {upNext
                          ? `Next: ${upNext.step.label.toLowerCase()} →`
                          : 'Show me my profile →'}
                      </Button>
                      <Button variant="ghost" onClick={() => goTo('bank')}>
                        Back to the words
                      </Button>
                    </div>
                  </Card>
                ) : (
                  <>
                    <Text tone="secondary">
                      It looks for places your marks could mean two things, and asks about those —
                      in words, not buttons.
                    </Text>
                    <div className={adaptive.askRow}>
                      <Button
                        variant="primary"
                        disabled={store.busy}
                        onClick={() => void store.nextProbe(testId)}
                      >
                        Ask me →
                      </Button>
                      <Text size="sm" tone="tertiary">
                        a little of your AI allowance
                      </Text>
                    </div>
                  </>
                )}
              </div>
              <TakeRail
                statuses={statuses}
                onGo={goTo}
                onMap={goToMap}
                actions={stepActions()}
                spendUsd={takeSpend}
              />
            </div>
          ) : null}

          {phase === 'scenario' && current ? (
            <div className={adaptive.stepFrame}>
              <div className={adaptive.stepMain}>
                <StepEyebrow status={current} index={stepIndex} total={TAKE_STEPS.length} />
                <Heading level={2}>In the moment</Heading>
                {current.state === 'now' && current.reason ? (
                  <NotEnoughYet reason={current.reason} onGo={() => goTo('bank')} />
                ) : (
                  <>
                    <Text tone="secondary">
                      The same words land differently depending on when they arrive. Pick a moment —
                      ones you&rsquo;ve already answered open straight back up, and cost nothing.
                    </Text>
                    {/*
                     * 74 §3.6.19 — the STRIP is the navigation, and it never leaves the screen.
                     *
                     * This used to be a grid that vanished the moment you picked one, leaving a single ghost
                     * button below five long cards as the only way back — and that button DISCARDED the set,
                     * so a category's answers could never be reviewed or changed again. Switching here is a
                     * view change: nothing is thrown away and nothing is spent.
                     */}
                    <div className={adaptive.momentGrid} role="group" aria-label="The moments">
                      {CONTEXTS.map((context) => {
                        const written = momentsByContext.get(context.id)?.length ?? 0;
                        const answered = answeredIn(context.id);
                        return (
                          <button
                            key={context.id}
                            type="button"
                            className={`${adaptive.moment} ${
                              openMoment === context.id ? adaptive.momentOpen : ''
                            } ${answered > 0 ? adaptive.momentDone : ''}`}
                            aria-pressed={openMoment === context.id}
                            onClick={() => setOpenMoment(context.id)}
                          >
                            <span className={adaptive.momentTop}>
                              <b>{context.label}</b>
                              <span className={adaptive.momentState}>
                                {written === 0 ? 'not started' : `${answered} of ${written}`}
                              </span>
                            </span>
                            <span className={adaptive.momentBlurb}>{context.blurb}</span>
                          </button>
                        );
                      })}
                    </div>

                    {store.scenarioMessage ? (
                      <Banner tone="warning">{store.scenarioMessage}</Banner>
                    ) : null}

                    {openMoment ? (
                      <>
                        {openMoments.length > 0 ? (
                          <Stack gap={3}>
                            {openMoments.map((moment) => (
                              <Card key={moment.scene} className={adaptive.probeCard}>
                                <Text className={adaptive.probeAsk}>{moment.scene}</Text>
                                {moment.options.length > 0 ? (
                                  <Stack gap={2}>
                                    {moment.options.map((option) => (
                                      <Button
                                        key={option}
                                        variant={option === moment.picked ? 'primary' : 'secondary'}
                                        // A scenario option is a whole spoken line, not a label. `Button` is
                                        // `white-space: nowrap` at a fixed height, so a real one from the
                                        // live model ran straight out of its own box.
                                        className={adaptive.optionButton}
                                        disabled={store.busy}
                                        onClick={() =>
                                          void store.answerScenario(testId, option, moment)
                                        }
                                      >
                                        {option}
                                      </Button>
                                    ))}
                                  </Stack>
                                ) : (
                                  /* Answered before the options were persisted (74 §3.6.19) — the pick
                                     survives, the choices it was made among do not. */
                                  <Text size="sm" tone="secondary">
                                    You chose: <b>{moment.picked}</b>
                                  </Text>
                                )}
                                {moment.picked && moment.options.length > 0 ? (
                                  <Text size="sm" tone="tertiary">
                                    Answered — tap another to change it.
                                  </Text>
                                ) : null}
                              </Card>
                            ))}
                          </Stack>
                        ) : null}
                        <div className={adaptive.askRow}>
                          <Button
                            variant={openMoments.length > 0 ? 'secondary' : 'primary'}
                            disabled={store.busy}
                            onClick={() => void store.loadScenario(testId, openMoment)}
                          >
                            {openMoments.length > 0
                              ? `Write more ${momentLabel(openMoment)} moments`
                              : `Write ${momentLabel(openMoment)} moments →`}
                          </Button>
                          <Text size="sm" tone="tertiary">
                            {openMoments.length > 0
                              ? 'a little of your AI allowance · the ones above stay'
                              : 'a little of your AI allowance'}
                          </Text>
                        </div>
                      </>
                    ) : (
                      <Text size="sm" tone="tertiary">
                        Do one, do all six, or none — each is a little of your AI allowance.
                      </Text>
                    )}
                  </>
                )}
              </div>
              <TakeRail
                statuses={statuses}
                onGo={goTo}
                onMap={goToMap}
                actions={stepActions()}
                spendUsd={takeSpend}
              />
            </div>
          ) : null}

          {/*
           * `done` is not a screen. It used to render a banner saying the profile was ready and a button to
           * go and read it — an entire screen whose only content was an instruction to leave it. The
           * synthesis has already finished by the time this renders, so this goes straight to the report.
           */}
          {/*
           * …but NOT when they arrived here asking to take it again. `phase` is still `done` from the last
           * synthesis, and this redirect runs on the first render — before the retake effect can move it — so
           * tapping "Take it again" on the report bounced straight back to the report. Once. Then `phase` had
           * moved on and it worked, which is exactly the "only the first time" the owner saw.
           */}
          {phase === 'profile' && current ? (
            <div className={adaptive.stepFrame}>
              <div className={adaptive.stepMain}>
                <StepEyebrow status={current} index={stepIndex} total={TAKE_STEPS.length} />
                <Heading level={2}>Your profile</Heading>
                {/*
                 * 74 §3.6.18 — the failure STAYS HERE and says which one it was.
                 *
                 * It used to complete the take regardless and redirect to a report with no profile in it and
                 * one generic sentence about it — the same words whether the model refused, the reply was cut
                 * off, or our own boundary filter took every paragraph. So each repeat report of "the analysis
                 * doesn't work" carried no more information than the last.
                 */}
                {store.synthesisMessage ? (
                  <Banner tone="warning">
                    <Stack gap={2}>
                      <span>{store.synthesisMessage}</span>
                      <Text size="sm" tone="secondary">
                        Nothing was lost — everything you marked is saved. This step is the only one
                        that hasn&rsquo;t run.
                      </Text>
                      <div className={adaptive.askRow}>
                        <Button
                          variant="primary"
                          disabled={store.busy}
                          onClick={() => void store.synthesize(testId)}
                        >
                          Try the analysis again
                        </Button>
                        <Button variant="secondary" onClick={() => goTo('bank')}>
                          Back to the words
                        </Button>
                      </div>
                      {/*
                       * The deliberate way out. "Never complete on a failure" alone is a trap — over budget,
                       * or a model that keeps declining, and the take could never be finished at all. The
                       * rest of the profile is computed from the lexicon with no model involved, so this is
                       * a real outcome; it is never the default, and it is never taken silently.
                       */}
                      <div className={adaptive.askRow}>
                        <Button
                          variant="ghost"
                          disabled={store.busy}
                          onClick={() => void store.synthesize(testId, undefined, true)}
                        >
                          Finish without the written analysis
                        </Button>
                        <Text size="sm" tone="tertiary">
                          your words, scores and trends — everything except the written read
                        </Text>
                      </div>
                    </Stack>
                  </Banner>
                ) : (
                  <>
                    <Text tone="secondary">
                      This reads everything you&rsquo;ve marked and answered and writes it back to
                      you — what lands, what it says about you, where it stops, and what to try.
                      It&rsquo;s the longest thing the test does, so it waits until you ask.
                    </Text>
                    <div className={adaptive.askRow}>
                      <Button
                        variant="primary"
                        disabled={store.busy}
                        onClick={() => void store.synthesize(testId)}
                      >
                        Write my profile →
                      </Button>
                      <Text size="sm" tone="tertiary">
                        a little of your AI allowance
                      </Text>
                    </div>
                  </>
                )}
                {store.state?.latest?.narrative ? (
                  <div className={adaptive.askRow}>
                    <Button variant="secondary" onClick={() => navigate(`/tests/${testId}`)}>
                      Read the one you already have
                    </Button>
                  </div>
                ) : null}
              </div>
              <TakeRail
                statuses={statuses}
                onGo={goTo}
                onMap={goToMap}
                actions={stepActions()}
                spendUsd={takeSpend}
              />
            </div>
          ) : null}

          {phase === 'done' ? <Navigate to={`/tests/${testId}`} replace /> : null}

          {/*
           * ONE footer for every phase, not one per phase. It used to be rendered inside the intro, address
           * and bank branches only — so it disappeared exactly where a disclosure happens: the probe and
           * scenario phases are the free-text ones (`readsAsDistress` runs on a probe answer), and `done` is
           * where someone lands after a heavy take. The Together lesson, one level down: a crisis affordance
           * belongs OUTSIDE the pane that changes, or a restructure silently drops it from most views.
           */}
          <CrisisFooter />
        </Stack>
      </div>
    </div>
  );
}

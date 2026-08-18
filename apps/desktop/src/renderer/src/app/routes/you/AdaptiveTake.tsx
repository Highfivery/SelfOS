import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
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

/** What a row is rating, in the person's terms. Both sides shown ⇒ nothing to disambiguate. */
function sideLabel(sides: readonly ('hear' | 'say')[]): string {
  if (sides.length >= 2) return 'hear & say';
  return sides[0] === 'say' ? 'you say' : 'you hear';
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
    return 'Rate these BOTH ways at once — hearing it from them and saying it to them. You split the two apart in the next step.';
  }
  return sides[0] === 'say'
    ? 'Things YOU SAY TO THEM — rate how much you want to say it.'
    : 'Things THEY SAY TO YOU — rate how much you want to hear it.';
}

const MARK_META: Record<BankMark, { label: string; Icon: typeof Flame }> = {
  love: { label: 'love it', Icon: Flame },
  okay: { label: "it's okay", Icon: Contrast },
  never: { label: 'never', Icon: Ban },
};
import {
  Banner,
  Button,
  Card,
  Heading,
  Stack,
  Text,
  Textarea,
} from '../../../design-system/components';
import { useAdaptiveTestStore, type BankMark } from '../../../stores/adaptiveTestStore';
import { AdaptiveHead } from './AdaptiveHead';
import { PracticeSheet } from './PracticeSheet';
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
    id: 'after',
    label: 'After',
    blurb: 'The come-down — held, talked to, told what just happened.',
  },
];

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
  const routeStep = (useLocation().state as { step?: string } | null)?.step;
  const tookRouteStep = useRef(false);
  useEffect(() => {
    if (tookRouteStep.current || !routeStep || !store.state?.draft) return;
    tookRouteStep.current = true;
    void useAdaptiveTestStore
      .getState()
      .start(testId)
      .then(() => useAdaptiveTestStore.getState().goToStep(routeStep));
  }, [routeStep, store.state, testId]);

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
   * 74 §3.6.4 — what still needs the hear/say question after the collapse: only entries this person was
   * offered on BOTH sides. Everything oriented to one side already knows its direction.
   */
  const splitNeeded = useMemo(
    () =>
      Object.keys(store.marks).filter((key) => {
        if (store.marks[key] === 'never') return false;
        const entry = bank?.entries.find((e) => e.key === key);
        return (entry?.sides.length ?? 0) >= 2;
      }),
    [store.marks, bank],
  );

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
  const statuses = useMemo(
    () =>
      stepStatuses({
        phase: store.phase,
        closed,
        skipped: store.skipped as StepId[],
        nameMarks: Object.keys(store.nameMarks).length,
        bankMarks: marked.length,
        splitNeeded: splitNeeded.length,
        splitAnswered: splitNeeded.filter((key) => {
          const split = store.splits[key];
          return split?.hear !== undefined || split?.say !== undefined;
        }).length,
        lineReactions: Object.keys(store.lineReactions).length,
        probesAnswered: (store.state?.draft?.turns ?? []).filter((turn) => turn.phase === 'probe')
          .length,
        scenariosAnswered: (store.state?.draft?.turns ?? []).filter(
          (turn) => turn.phase === 'scenario',
        ).length,
        seeded: store.seeded,
        identityAnswered: store.bank?.address !== undefined,
        loved:
          Object.values(store.marks).filter((mark) => mark === 'love').length +
          Object.values(store.nameMarks).filter(
            (mark) => mark.hear === 'love' || mark.say === 'love',
          ).length,
      }),
    [
      store.phase,
      closed,
      store.skipped,
      store.nameMarks,
      marked.length,
      splitNeeded,
      store.splits,
      store.lineReactions,
      store.state,
      store.seeded,
      store.bank,
    ],
  );
  /** The two marking steps' tallies, so both render the same card from one place. */
  const bankTally = useMemo(() => {
    const out = { love: 0, okay: 0, never: 0 };
    for (const mark of Object.values(store.marks)) out[mark] += 1;
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

  /** Going to a step never spends — except the profile, which IS the synthesis. */
  const goTo = (id: StepId): void => {
    if (id === 'profile') void store.synthesize(testId);
    else store.goToStep(phaseForStep(id));
  };
  const skipCurrent = (): void => {
    if (!current) return;
    // Skipping the last step before the profile lands on the MAP, never on a synthesis: a skip is passing
    // something over, and it must never be the thing that spends. Finishing is its own explicit verb.
    const next = upNext && upNext.step.id !== 'profile' ? phaseForStep(upNext.step.id) : null;
    store.skipStep(current.step.id, next);
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

  const phase = store.phase;

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
                  ? () => void store.abandon(testId).then(() => setPractice('unknown'))
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
                      Change this any time. It only decides what you&rsquo;re shown — nothing is
                      ruled out, and no mark is lost.
                    </Text>
                  </div>
                ) : (
                  <Text size="sm" tone="tertiary">
                    Change this any time. It only decides what you&rsquo;re shown — nothing is ruled
                    out, and no mark is lost.
                  </Text>
                )}
              </div>
              <TakeRail
                statuses={statuses}
                onGo={goTo}
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
              rail={
                <TakeRail
                  statuses={statuses}
                  onGo={goTo}
                  saveState={<SaveState state={store.saveState} />}
                  extra={
                    <Tally
                      counts={nameTally}
                      label="Names marked"
                      testIdPrefix="name-tally"
                      note={`${Object.keys(store.nameMarks).length} names · both directions counted`}
                    />
                  }
                  actions={
                    <>
                      <Button
                        variant="primary"
                        disabled={store.busy}
                        onClick={() => void store.finishNames(testId)}
                      >
                        Done with names →
                      </Button>
                      <Button
                        variant="ghost"
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
              onMark={(key, mark) => store.mark(key, mark)}
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
                </div>
                {/* One slim bar, not 36 dashes. */}
                <div
                  className={adaptive.track}
                  role="progressbar"
                  aria-valuenow={areaIndex + 1}
                  aria-valuemin={1}
                  aria-valuemax={bank.families.length}
                  aria-label={`Area ${areaIndex + 1} of ${bank.families.length}`}
                >
                  <i
                    style={{ width: `${((areaIndex + 1) / bank.families.length) * 100}%` }}
                    aria-hidden="true"
                  />
                </div>
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
                  {areaEntries.length === 0 ? (
                    /* Every term here is aimed at a body or a role that is neither of theirs (common on a
                       same-sex configuration, where whole areas resolve to one side). */
                    <Text tone="secondary">
                      Nothing in this area is aimed at either of you, so there&rsquo;s nothing to
                      mark here.
                    </Text>
                  ) : (
                    areaEntries.map((entry) => {
                      // Settled = a boundary from an EARLIER take. One made in THIS take stays editable,
                      // whether it was tapped a minute ago (`touched`) or in a previous sitting of the
                      // same take — a stricter UI would strand a mis-tap noticed tomorrow.
                      const mark = store.marks[entry.key];
                      const mineThisTake =
                        store.touched.includes(entry.key) ||
                        store.state?.lexicon.entries.some(
                          (e) =>
                            e.key === entry.key && e.source === `test:${store.state?.draft?.id}`,
                        );
                      const locked =
                        !mineThisTake &&
                        store.state?.lexicon.entries.some(
                          (e) => e.key === entry.key && e.state === 'never',
                        );
                      return (
                        <div
                          key={entry.key}
                          className={`${adaptive.row} ${mark && mark !== 'never' ? adaptive.rowOn : ''} ${
                            mark === 'never' || locked ? adaptive.rowNo : ''
                          }`}
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
                                {/* Only when the area MIXES the two — the band carries it otherwise. */}
                                {areaSides === null ? (
                                  <span className={adaptive.sideChip}>
                                    {sideLabel(entry.sides)}
                                  </span>
                                ) : null}
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
                          {locked ? (
                            <span className={adaptive.lockedMark}>
                              <Ban size={13} aria-hidden="true" /> off the table
                            </span>
                          ) : (
                            <span className={adaptive.marks}>
                              {(['love', 'okay'] as BankMark[]).map((option) => {
                                const { label, Icon } = MARK_META[option];
                                return (
                                  <button
                                    key={option}
                                    type="button"
                                    className={`${adaptive.mark} ${adaptive[option]} ${
                                      mark === option ? adaptive.markOn : ''
                                    }`}
                                    aria-pressed={mark === option}
                                    aria-label={`${entry.text} — ${sideLabel(entry.sides)} — ${label}`}
                                    onClick={() =>
                                      store.mark(entry.key, mark === option ? null : option)
                                    }
                                  >
                                    <Icon size={18} aria-hidden="true" />
                                  </button>
                                );
                              })}
                              {/* A hard no is set apart, so it can never be a mis-tap neighbour. */}
                              <span className={adaptive.markGap} aria-hidden="true" />
                              <button
                                type="button"
                                className={`${adaptive.mark} ${adaptive.never} ${
                                  mark === 'never' ? adaptive.markOn : ''
                                }`}
                                aria-pressed={mark === 'never'}
                                aria-label={`${entry.text} — ${sideLabel(entry.sides)} — ${MARK_META.never.label}`}
                                onClick={() =>
                                  store.mark(entry.key, mark === 'never' ? null : 'never')
                                }
                              >
                                <Ban size={18} aria-hidden="true" />
                              </button>
                            </span>
                          )}
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
                          {/* The label is hidden (not dropped) in the narrow action bar — see `.railBack`. */}
                          ←<span> Previous</span>
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
                        {/* The tail is hidden, not dropped, in the narrow action bar — see `.railDone`. */}
                        Done
                        <span>with the words for now</span>
                      </Button>
                    </>
                  }
                />
              </div>
            </div>
          ) : null}

          {phase === 'split' && current ? (
            <div className={adaptive.stepFrame}>
              <div className={adaptive.stepMain}>
                <StepEyebrow status={current} index={stepIndex} total={TAKE_STEPS.length} />
                <Heading level={2}>Hearing it, or saying it?</Heading>
                <Text tone="secondary">
                  Only the ones you marked. What you love to <em>hear</em> and what you can get out
                  of your own mouth are usually different — that gap is the most useful thing here.
                </Text>
                {splitNeeded.length === 0 ? (
                  <Banner tone="info">
                    Nothing to split here — everything you marked was only ever offered one way
                    round, so its direction is already known.
                  </Banner>
                ) : null}
                <Text size="sm" tone="tertiary">
                  Saved as you go — leave any of these blank and come back to them.
                </Text>
                {marked.map((key) => {
                  const entry = bank.entries.find((e) => e.key === key);
                  if (!entry || store.marks[key] === 'never') return null;
                  // 74 §3.6.4 — the collapse. An oriented entry was only ever offered on ONE side, so its
                  // direction is already known and there is nothing to split; only an entry that reaches both
                  // still needs the question. Rating the unshown side would invent an answer (§3.6.6).
                  if (entry.sides.length < 2) return null;
                  return (
                    <div key={key} className={adaptive.splitRow}>
                      <span className={adaptive.entryText}>{entry.text}</span>
                      {(['hear', 'say'] as const).map((direction) => (
                        <span key={direction} className={adaptive.marks}>
                          <span className={adaptive.dirLabel}>{direction}</span>
                          {[0, 1, 2, 3, 4].map((value) => (
                            <button
                              key={value}
                              type="button"
                              className={adaptive.markButton}
                              aria-pressed={store.splits[key]?.[direction] === value}
                              aria-label={`${entry.text} — ${direction} ${value} of 4`}
                              onClick={() => store.setSplit(key, direction, value)}
                            >
                              {value}
                            </button>
                          ))}
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
              <TakeRail
                statuses={statuses}
                onGo={goTo}
                saveState={<SaveState state={store.saveState} />}
                actions={stepActions('Save and continue →', () => void store.submitSplit(testId))}
              />
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
                {!current.reason && store.lines.length === 0 && !store.busy && !askedFor.lines ? (
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
                {store.lines.length === 0 && !store.busy && askedFor.lines ? (
                  <Stack gap={3}>
                    <AiUnavailableNotice />
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
                {store.lines.map((line) => (
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
                {store.lines.length > 0 ? (
                  <div className={take.footer}>
                    <Button
                      variant="secondary"
                      disabled={store.busy}
                      onClick={() => {
                        setRound(round + 1);
                        void store.loadLines(testId, round + 1);
                      }}
                    >
                      Write me three more
                    </Button>
                  </div>
                ) : null}
              </div>
              <TakeRail statuses={statuses} onGo={goTo} actions={stepActions()} />
            </div>
          ) : null}

          {phase === 'probe' && current ? (
            <div className={adaptive.stepFrame}>
              <div className={adaptive.stepMain}>
                <StepEyebrow status={current} index={stepIndex} total={TAKE_STEPS.length} />
                <Heading level={2}>The questions it still has</Heading>
                {current.state === 'now' && current.reason ? (
                  <NotEnoughYet reason={current.reason} onGo={() => goTo('bank')} />
                ) : store.probeQuestion ? (
                  <>
                    <Text tone="secondary">
                      Somewhere your marks could mean two different things. Answer in your own
                      words, or skip it — nothing you write here is shown to anyone.
                    </Text>
                    <Card className={adaptive.probeCard}>
                      <Text className={adaptive.probeAsk}>{store.probeQuestion}</Text>
                      <Textarea
                        value={store.probeAnswer}
                        onChange={(e) =>
                          useAdaptiveTestStore.setState({ probeAnswer: e.currentTarget.value })
                        }
                        rows={3}
                        aria-label="Your answer"
                      />
                      <div className={adaptive.askRow}>
                        <Button
                          variant="primary"
                          disabled={store.busy}
                          onClick={() => void store.answerProbe(testId)}
                        >
                          Answer →
                        </Button>
                        <Button variant="ghost" onClick={() => void store.skipProbe(testId)}>
                          Skip this one
                        </Button>
                      </div>
                    </Card>
                  </>
                ) : store.probeDone ? (
                  /* Asked, and it had nothing left — which is a real outcome, not a failure. It used to
                     return the same `done` whether it had exhausted the ambiguities or had nothing to work
                     from at all, so the screen flashed past either way and never said which. */
                  <Banner tone="info">
                    Nothing left it can&rsquo;t work out from what you marked. That&rsquo;s this
                    step finished.
                  </Banner>
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
              <TakeRail statuses={statuses} onGo={goTo} actions={stepActions()} />
            </div>
          ) : null}

          {phase === 'scenario' && current ? (
            <div className={adaptive.stepFrame}>
              <div className={adaptive.stepMain}>
                <StepEyebrow status={current} index={stepIndex} total={TAKE_STEPS.length} />
                <Heading level={2}>In the moment</Heading>
                {current.state === 'now' && current.reason ? (
                  <NotEnoughYet reason={current.reason} onGo={() => goTo('bank')} />
                ) : store.scenario ? (
                  <>
                    <Text tone="secondary">
                      {CONTEXTS.find((c) => c.id === store.scenario?.context)?.label ??
                        'This moment'}{' '}
                      — pick the one closest to what you&rsquo;d want.
                    </Text>
                    <Card className={adaptive.probeCard}>
                      <Text className={adaptive.probeAsk}>{store.scenario.scene}</Text>
                      <Stack gap={2}>
                        {store.scenario.options.map((option) => (
                          <Button
                            key={option}
                            variant="secondary"
                            disabled={store.busy}
                            onClick={() => void store.answerScenario(testId, option)}
                          >
                            {option}
                          </Button>
                        ))}
                      </Stack>
                    </Card>
                  </>
                ) : (
                  <>
                    {/*
                     * 74 §3.6.9 — this used to be three bare buttons labelled Build-up / During / After, with
                     * no statement of what they were, what tapping one would do, or that it would spend. The
                     * three moments are the QUESTION here, so they say what they mean, and picking one is
                     * plainly the thing that writes a scene.
                     */}
                    <Text tone="secondary">
                      The same words land differently depending on when they arrive. Pick a moment
                      and it writes one short scene from your own register, with a few ways it could
                      go.
                    </Text>
                    <div className={adaptive.momentGrid}>
                      {CONTEXTS.map((context) => {
                        const answered = (store.state?.draft?.turns ?? []).some(
                          (turn) => turn.phase === 'scenario' && turn.item.id === context.id,
                        );
                        return (
                          <button
                            key={context.id}
                            type="button"
                            className={`${adaptive.moment} ${answered ? adaptive.momentDone : ''}`}
                            disabled={store.busy}
                            onClick={() => void store.loadScenario(testId, context.id)}
                          >
                            <span className={adaptive.momentTop}>
                              <b>{context.label}</b>
                              {answered ? <span className={adaptive.momentState}>done</span> : null}
                            </span>
                            <span className={adaptive.momentBlurb}>{context.blurb}</span>
                          </button>
                        );
                      })}
                    </div>
                    <Text size="sm" tone="tertiary">
                      Each one is a little of your AI allowance. Do one, all three, or none.
                    </Text>
                  </>
                )}
              </div>
              <TakeRail statuses={statuses} onGo={goTo} actions={stepActions()} />
            </div>
          ) : null}

          {phase === 'done' ? (
            <Stack gap={4}>
              <Banner tone="info">Your profile is ready.</Banner>
              <div>
                <Button variant="primary" onClick={() => navigate(`/tests/${testId}`)}>
                  Read it
                </Button>
              </div>
            </Stack>
          ) : null}

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

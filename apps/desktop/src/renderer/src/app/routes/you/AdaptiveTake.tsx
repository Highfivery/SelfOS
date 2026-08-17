import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Ban, Contrast, Flame, Lock } from 'lucide-react';

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

/** What someone of this identity is called by default. Overridable below — a man can want "good girl". */
function addressFor(identity: 'man' | 'woman' | 'either'): 'girl' | 'man' | 'either' {
  return identity === 'man' ? 'man' : identity === 'woman' ? 'girl' : 'either';
}

const ADDRESS_OPTIONS: { value: 'girl' | 'man' | 'either'; self: string; partner: string }[] = [
  { value: 'girl', self: 'their girl', partner: 'his girl' },
  { value: 'man', self: 'their man', partner: 'her man' },
  { value: 'either', self: 'neither · both · depends', partner: 'neither · both · depends' },
];

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
function directionSentence(sides: readonly ('hear' | 'say')[]): string {
  if (sides.length >= 2) {
    return 'Rate these BOTH ways at once — hearing it from them and saying it to them. You split the two apart in the next step.';
  }
  return sides[0] === 'say'
    ? 'These are things YOU SAY TO THEM. Rate how much you want to say it.'
    : 'These are things THEY SAY TO YOU. Rate how much you want to hear it.';
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
import { CrisisFooter } from '../sessions/CrisisFooter';
import { AiUnavailableNotice } from '../../AiUnavailableNotice';
import styles from './You.module.css';
import take from './TestTake.module.css';
import adaptive from './Adaptive.module.css';

/** The contexts the scenario phase walks, in the order a night actually runs. */
const CONTEXTS: { id: string; label: string }[] = [
  { id: 'buildUp', label: 'Build-up' },
  { id: 'during', label: 'During' },
  { id: 'after', label: 'After' },
];

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
  const areaHeadingRef = useRef<HTMLHeadingElement>(null);
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
  const [selfAddress, setSelfAddress] = useState<'girl' | 'man' | 'either' | null>(null);
  const [partnerAddress, setPartnerAddress] = useState<'girl' | 'man' | 'either' | null>(null);
  const [selfIdentity, setSelfIdentity] = useState<'man' | 'woman' | 'either' | null>(null);
  const [partnerIdentity, setPartnerIdentity] = useState<'man' | 'woman' | 'either' | null>(null);
  // The address pair is DERIVED from identity by default and only revealed when someone says it doesn't fit.
  // Keeping the two separable is what lets a man ask to be called "good girl" (§3.6.3) — collapsing them into
  // one identity question would have deleted that, which is the same conflation #62 was about.
  const [addressDiffers, setAddressDiffers] = useState(false);
  // Seed from what they already answered, or re-opening the screen shows an empty form with Start disabled
  // and no way to see the current answer.
  const seededAddress = useRef(false);
  useEffect(() => {
    if (seededAddress.current || !store.bank) return;
    const { address, identity } = store.bank;
    if (!address && !identity) return;
    seededAddress.current = true;
    if (identity) {
      setSelfIdentity(identity.self);
      setPartnerIdentity(identity.partner);
    }
    if (address) {
      setSelfAddress(address.self);
      setPartnerAddress(address.partner);
      // Only open the override when what they're called actually diverges from who they are.
      if (
        identity &&
        (address.self !== addressFor(identity.self) ||
          address.partner !== addressFor(identity.partner))
      ) {
        setAddressDiffers(true);
      }
    }
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

  // Each AI phase starts itself once on entry — otherwise the person lands on an empty screen and has to ask
  // for the thing they just said yes to. Guarded per phase, so a degraded phase (which moves the take on)
  // can never loop back into itself.
  const started = useRef<Record<string, boolean>>({});
  const { phase: currentPhase, busy } = store;
  useEffect(() => {
    if (busy || started.current[currentPhase]) return;
    // The split screen has nothing to ask when every marked entry is oriented to one side — don't show an
    // empty screen and make them press Next on it (74 §3.6.4).
    if (currentPhase === 'split' && splitNeeded.length === 0) {
      started.current['split'] = true;
      void useAdaptiveTestStore.getState().submitSplit(testId);
    } else if (currentPhase === 'lines') {
      started.current['lines'] = true;
      void useAdaptiveTestStore.getState().loadLines(testId, 1);
    } else if (currentPhase === 'probe') {
      started.current['probe'] = true;
      void useAdaptiveTestStore.getState().nextProbe(testId);
    }
  }, [currentPhase, busy, testId, splitNeeded.length]);
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

          {phase === 'intro' ? (
            <Stack gap={4}>
              <div>
                <span className={styles.eyebrow}>SelfOS</span>
                <Heading level={1}>{store.state.title}</Heading>
              </div>
              <Text tone="secondary">{store.state.blurb}</Text>
              <Text size="sm" tone="tertiary" className={styles.framing}>
                {store.state.framing}
              </Text>
              <Banner tone="info">
                This stays yours. It shapes how SelfOS talks to you — and, if you have a partner
                here, it can quietly shape what their coach suggests to them. It never tells them
                what you said.
              </Banner>
              <Text size="sm" tone="secondary">
                About {store.state.estimatedMinutes} min · adapts as you go · uses a little of your
                AI allowance
              </Text>
              {store.state.draft ? (
                <Banner tone="info">
                  You have a take in progress — this picks it up exactly where you stopped, with
                  everything you already marked.
                </Banner>
              ) : (
                <Text size="sm" tone="tertiary">
                  It saves as you go, so you can stop anywhere and come back.
                </Text>
              )}
              <div className={take.footer}>
                <Button variant="primary" onClick={() => void store.start(testId)}>
                  {store.state.draft ? 'Pick up where you left off' : 'Begin'}
                </Button>
                {/* The one route back to the top of a long deck. It clears THIS take's record and its place
                    in the deck — never the marks, which are their answers and live in the lexicon. Without
                    it, "resume where you stopped" was a one-way door: nothing could take you back to area 1. */}
                {store.state.draft ? (
                  <Button variant="ghost" onClick={() => void store.abandon(testId)}>
                    Start over from the top
                  </Button>
                ) : null}
              </div>
              {store.state.draft ? (
                <Text size="sm" tone="tertiary">
                  Starting over keeps everything you marked — it just puts you back at the first
                  area.
                </Text>
              ) : null}
            </Stack>
          ) : null}

          {phase === 'address' ? (
            <Stack gap={4}>
              <Heading level={2}>Before we start</Heading>
              <Text tone="secondary">
                Two questions, so the words you&rsquo;re shown are ones that could actually be said
                between the two of you — and so &ldquo;what you like to hear&rdquo; means lines
                about your body, not theirs.
              </Text>
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
                        if (!addressDiffers) setSelfAddress(addressFor(option.value));
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
                        if (!addressDiffers) setPartnerAddress(addressFor(option.value));
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </Card>

              {/* The escape hatch. Identity sets what you're CALLED by default, but the two are genuinely
                  different questions — a man can want "good girl" — so the override stays reachable instead
                  of being collapsed away. Hidden until asked for, because for most people it never applies. */}
              {addressDiffers ? (
                <Card className={adaptive.identityCard}>
                  <span className={adaptive.identityLabel} id="adaptive-self-address-label">
                    What you like being called:
                  </span>
                  <div
                    className={adaptive.pills}
                    role="group"
                    aria-labelledby="adaptive-self-address-label"
                  >
                    {ADDRESS_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={adaptive.pill}
                        aria-pressed={selfAddress === option.value}
                        onClick={() => setSelfAddress(option.value)}
                      >
                        {option.self}
                      </button>
                    ))}
                  </div>
                  <span className={adaptive.identityLabel} id="adaptive-partner-address-label">
                    What they like being called:
                  </span>
                  <div
                    className={adaptive.pills}
                    role="group"
                    aria-labelledby="adaptive-partner-address-label"
                  >
                    {ADDRESS_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={adaptive.pill}
                        aria-pressed={partnerAddress === option.value}
                        onClick={() => setPartnerAddress(option.value)}
                      >
                        {option.partner}
                      </button>
                    ))}
                  </div>
                </Card>
              ) : (
                <div>
                  <button
                    type="button"
                    className={adaptive.textLink}
                    onClick={() => setAddressDiffers(true)}
                  >
                    One of you likes being called something else
                  </button>
                </div>
              )}

              <Text size="sm" tone="tertiary">
                Change this any time. It only decides what you&rsquo;re shown — nothing is ruled
                out, and no mark is lost.
              </Text>
              <div className={take.footer}>
                <Button
                  variant="primary"
                  disabled={store.busy || !selfIdentity || !partnerIdentity}
                  onClick={() => {
                    if (!selfIdentity || !partnerIdentity) return;
                    void store.setAddress(
                      testId,
                      selfAddress ?? addressFor(selfIdentity),
                      partnerAddress ?? addressFor(partnerIdentity),
                      { self: selfIdentity, partner: partnerIdentity },
                    );
                  }}
                >
                  Start
                </Button>
              </div>
            </Stack>
          ) : null}

          {phase === 'bank' && area ? (
            <Stack gap={4}>
              <div className={adaptive.deckHead}>
                <Text size="sm" tone="tertiary">
                  Area {areaIndex + 1} of {bank.families.length}
                </Text>
                <span
                  className={adaptive.dots}
                  role="img"
                  aria-label={`Area ${areaIndex + 1} of ${bank.families.length}`}
                >
                  {bank.families.map((family, index) => (
                    <i
                      key={family.id}
                      className={
                        index === areaIndex
                          ? adaptive.now
                          : index < areaIndex
                            ? adaptive.done
                            : undefined
                      }
                    />
                  ))}
                </span>
                <SaveState state={store.saveState} />
              </div>

              <div className={adaptive.deckHead}>
                {/* Focus target for an area change (see `goToArea`). `tabIndex={-1}` makes it programmatically
                    focusable without adding a tab stop, and the ref lives here rather than on `Heading`
                    because that primitive doesn't forward one. */}
                <div ref={areaHeadingRef} tabIndex={-1} className={adaptive.deckHeadTitle}>
                  <Heading level={2}>{area.label}</Heading>
                </div>
                {/* §3.6.5 promises a route back. Burying it in the withheld note made it unreachable, since
                    that note usually doesn't render — so it lives here, always, beside the area title. */}
                <button
                  type="button"
                  className={take.back}
                  onClick={() => store.setPhase('address')}
                >
                  Shown for: {addressSummary(bank.address)} — change
                </button>
              </div>
              {areaSides ? (
                <Text tone="secondary" className={adaptive.direction}>
                  {directionSentence(areaSides)}
                </Text>
              ) : (
                <Text tone="secondary" className={adaptive.direction}>
                  These are mixed — each line says whether it&rsquo;s one you&rsquo;d hear or one
                  you&rsquo;d say.
                </Text>
              )}
              {area.note ? (
                <Text tone="secondary" className={styles.framing}>
                  {area.note}
                </Text>
              ) : null}
              {areaEntries.length === 0 ? (
                /* Every term here is aimed at a body or a role that is neither of theirs (common on a
                   same-sex configuration, where whole areas resolve to one side). Rendering the marking
                   instructions and an empty card over "0 here" reads as a broken screen — say what
                   happened instead, and leave the withheld note below to carry the route back. */
                <Text tone="secondary">
                  Nothing in this area is aimed at either of you, so there&rsquo;s nothing to mark
                  here.
                </Text>
              ) : (
                <>
                  {/* 74 §3.6.4 — standing instructions, shown ONCE. They were repeating on all 36 areas,
                      pushing the first markable row most of the way down the viewport every single time; by
                      area 6 the person has scrolled past the same two paragraphs six times. The marks keep a
                      permanent one-line legend below, which is the part you actually need again. */}
                  {areaIndex === 0 ? (
                    <>
                      <Text tone="secondary">
                        Only tap what actually does something for you — skip the rest.{' '}
                        <Flame size={14} aria-hidden="true" /> if you love it,{' '}
                        <Contrast size={14} aria-hidden="true" /> if it&rsquo;s okay,{' '}
                        <Ban size={14} aria-hidden="true" /> if it&rsquo;s a no. A <em>never</em> is
                        a boundary: nothing in SelfOS will suggest it again.
                      </Text>
                      <Banner tone="info" role="none">
                        <strong>Every tap saves itself.</strong> Mark what you feel like marking and
                        close it whenever — it picks up on this area, with everything you already
                        marked. Moving on skips whatever you left alone.
                      </Banner>
                    </>
                  ) : null}
                  {/* The legend stays on every area — it is the part you need again, and it costs one line
                      where the two paragraphs above cost most of a viewport. */}
                  <Text size="sm" tone="tertiary">
                    {areaEntries.length} here · {marked.length} marked so far ·{' '}
                    <Flame size={13} aria-hidden="true" /> love ·{' '}
                    <Contrast size={13} aria-hidden="true" /> okay ·{' '}
                    <Ban size={13} aria-hidden="true" /> never
                  </Text>

                  <Card className={adaptive.family}>
                    <ul className={adaptive.grid} style={{ display: 'block' }}>
                      {areaEntries.map((entry) => {
                        // Settled = a boundary from an EARLIER take. One made in THIS take stays editable,
                        // whether it was tapped a minute ago (`touched`) or in a previous sitting of the same
                        // take (its lexicon entry carries this take's `source`) — core allows both, and a
                        // stricter UI would strand a mis-tap noticed tomorrow with no way to fix it.
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
                          <li key={entry.key} className={adaptive.entryRow}>
                            <span className={adaptive.entryText}>
                              {entry.text}
                              {/* Intensity was a bare coloured dot: no legend, no text, nothing a screen
                                  reader or a colourblind eye could read (§9). It still reads as a pip; it
                                  just says what it means now. */}
                              <span
                                className={`${adaptive.tierPip} ${entry.tier >= 4 ? adaptive.hot : ''}`}
                                title={entry.tier >= 4 ? 'more intense' : 'gentler'}
                              >
                                <span className={adaptive.srOnly}>
                                  {entry.tier >= 4 ? 'more intense' : 'gentler'}
                                </span>
                              </span>
                            </span>
                            <span className={adaptive.example}>
                              {entry.example ? `“${entry.example}”` : ''}
                              {/* Only when the area is mixed — repeating "you say" on 47 uniform rows is
                                  noise, and the area sentence above already carries it. */}
                              {areaSides === null ? (
                                <span className={adaptive.sideChip}>{sideLabel(entry.sides)}</span>
                              ) : null}
                            </span>
                            {locked ? (
                              <span className={adaptive.lockedMark}>
                                <Ban size={13} aria-hidden="true" /> off the table
                              </span>
                            ) : (
                              <span className={adaptive.marks}>
                                {(['love', 'okay', 'never'] as BankMark[]).map((option) => {
                                  const { label, Icon } = MARK_META[option];
                                  return (
                                    <button
                                      key={option}
                                      type="button"
                                      className={`${adaptive.markButton} ${
                                        option === 'never' ? adaptive.markNo : ''
                                      }`}
                                      aria-pressed={mark === option}
                                      aria-label={`${entry.text} — ${sideLabel(entry.sides)} — ${label}`}
                                      onClick={() =>
                                        store.mark(entry.key, mark === option ? null : option)
                                      }
                                    >
                                      <Icon size={17} aria-hidden="true" />
                                    </button>
                                  );
                                })}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </Card>
                </>
              )}

              {withheld > 0 ? (
                <div className={adaptive.withheld}>
                  <Text size="sm" tone="tertiary">
                    {withheld} {withheld === 1 ? 'term is' : 'terms are'} hidden here —
                    they&rsquo;re aimed at a body or a role that isn&rsquo;t yours or theirs. Change
                    that in{' '}
                    <button
                      type="button"
                      className={take.back}
                      onClick={() => store.setPhase('address')}
                    >
                      Before we start
                    </button>
                    .
                  </Text>
                </div>
              ) : null}

              <div className={adaptive.deckFoot}>
                <span style={{ display: 'inline-flex', gap: 'var(--space-3)' }}>
                  {areaIndex > 0 ? (
                    <Button
                      variant="secondary"
                      disabled={store.busy}
                      onClick={() => goToArea(areaIndex - 1)}
                    >
                      ← Previous
                    </Button>
                  ) : null}
                  {/* A partial pass is explicitly designed to be worth something (§3.6.1 #3), so finishing
                      must NOT require clicking through all 36 areas. Without this, someone who marked the
                      three areas they cared about had to press Skip 33 more times to see their profile. */}
                  <Button
                    variant="secondary"
                    disabled={store.busy}
                    onClick={() => void store.submitBank(testId)}
                  >
                    Done for now — show me
                  </Button>
                </span>
                <span style={{ display: 'inline-flex', gap: 'var(--space-3)' }}>
                  {areaIndex + 1 < bank.families.length ? (
                    // "Skip this area" sat beside this calling the SAME function — two labels, one
                    // behaviour, side by side. A reader has to assume Skip means something extra (never
                    // show me this again?) and it never did. Nothing here is required, so moving on IS
                    // skipping, and the banner above now says so.
                    <Button variant="primary" disabled={store.busy} onClick={() => nextArea()}>
                      Next area →
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      disabled={store.busy}
                      onClick={() => void store.submitBank(testId)}
                    >
                      Done — show me
                    </Button>
                  )}
                </span>
              </div>
            </Stack>
          ) : null}

          {phase === 'split' ? (
            <Stack gap={4}>
              <Heading level={2}>Hearing it, or saying it?</Heading>
              <Text tone="secondary">
                Only the ones you marked. What you love to <em>hear</em> and what you can get out of
                your own mouth are usually different — that gap is the most useful thing here.
              </Text>
              <div className={take.statusRow}>
                <Text size="sm" tone="tertiary">
                  Saved as you go — leave any of these blank and come back to them.
                </Text>
                <SaveState state={store.saveState} />
              </div>
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
              <div className={take.footer}>
                <Button
                  variant="primary"
                  disabled={store.busy}
                  onClick={() => void store.submitSplit(testId)}
                >
                  Next
                </Button>
              </div>
            </Stack>
          ) : null}

          {phase === 'lines' ? (
            <Stack gap={4}>
              <Heading level={2}>Does this land?</Heading>
              <Text tone="secondary">
                Written for you, from what you just marked. React honestly — this is where the
                pattern shows.
              </Text>
              {store.lines.length === 0 && !store.busy ? (
                <Stack gap={3}>
                  <AiUnavailableNotice />
                  <div>
                    <Button variant="secondary" onClick={() => void store.loadLines(testId, round)}>
                      Try again
                    </Button>
                  </div>
                </Stack>
              ) : null}
              {store.lines.map((line) => (
                <div key={line} className={adaptive.lineRow}>
                  <span className={adaptive.lineText}>&ldquo;{line}&rdquo;</span>
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
              <div className={take.footer}>
                <Button
                  variant="secondary"
                  disabled={store.busy}
                  onClick={() => {
                    setRound(round + 1);
                    void store.loadLines(testId, round + 1);
                  }}
                >
                  More like this
                </Button>
                <Button variant="primary" onClick={() => void store.nextProbe(testId)}>
                  Next
                </Button>
              </div>
            </Stack>
          ) : null}

          {phase === 'probe' ? (
            <Stack gap={4}>
              <Heading level={2}>One thing I want to get right</Heading>
              {store.probeQuestion ? (
                <>
                  <Text>{store.probeQuestion}</Text>
                  <Textarea
                    value={store.probeAnswer}
                    onChange={(e) =>
                      useAdaptiveTestStore.setState({ probeAnswer: e.currentTarget.value })
                    }
                    rows={3}
                    aria-label="Your answer"
                  />
                  <div className={take.footer}>
                    <Button
                      variant="primary"
                      disabled={store.busy}
                      onClick={() => void store.answerProbe(testId)}
                    >
                      Answer
                    </Button>
                    <Button variant="ghost" onClick={() => void store.skipProbe(testId)}>
                      Skip this
                    </Button>
                  </div>
                </>
              ) : (
                <div className={take.footer}>
                  <Button variant="primary" onClick={() => void store.nextProbe(testId)}>
                    Continue
                  </Button>
                </div>
              )}
            </Stack>
          ) : null}

          {phase === 'scenario' ? (
            <Stack gap={4}>
              <Heading level={2}>In the moment</Heading>
              <Text tone="secondary">
                What lands mid-act is wrong at 2pm — so this asks per moment, not in general.
              </Text>
              {store.scenario ? (
                <Card>
                  <Stack gap={3}>
                    <Text>{store.scenario.scene}</Text>
                    {store.scenario.options.map((option) => (
                      <Button
                        key={option}
                        variant="secondary"
                        onClick={() => void store.answerScenario(testId, option)}
                      >
                        {option}
                      </Button>
                    ))}
                  </Stack>
                </Card>
              ) : (
                <Stack gap={3}>
                  {CONTEXTS.map((context) => (
                    <Button
                      key={context.id}
                      variant="secondary"
                      disabled={store.busy}
                      onClick={() => void store.loadScenario(testId, context.id)}
                    >
                      {context.label}
                    </Button>
                  ))}
                </Stack>
              )}
              <div className={take.footer}>
                <Button
                  variant="primary"
                  disabled={store.busy}
                  onClick={() => void store.synthesize(testId)}
                >
                  I&rsquo;m done — show me my profile
                </Button>
              </div>
            </Stack>
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

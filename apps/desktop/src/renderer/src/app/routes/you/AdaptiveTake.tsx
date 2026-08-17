import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  const about = (who: 'man' | 'woman' | 'either' | null): string | null =>
    who === 'man'
      ? 'I love how hard your cock gets for me'
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
  const areaHeadingRef = useRef<HTMLDivElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
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
                      You have a take in progress. Picking up keeps everything you already marked;
                      starting over just puts you back at the first area.
                    </Text>
                  </div>
                ) : null}

                <div className={adaptive.introActions}>
                  <Button variant="primary" onClick={() => void store.start(testId)}>
                    {store.state.draft ? 'Pick up where you left off' : 'Begin'}
                  </Button>
                  {/* The one route back to the top of a long deck — it clears this take's record and its
                      place in the deck, never the marks, which are their answers. */}
                  {store.state.draft ? (
                    <Button variant="ghost" onClick={() => void store.abandon(testId)}>
                      Start over from the top
                    </Button>
                  ) : null}
                </div>
              </Card>
            </div>
          ) : null}

          {phase === 'address' ? (
            <Stack gap={4}>
              <Heading level={2}>Before we start</Heading>
              <Text tone="secondary">
                Two questions, so the words you&rsquo;re shown are ones that could actually be said
                between the two of you — and so &ldquo;what you like to hear&rdquo; means lines
                about your body, not theirs.
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
              </div>

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
                    Change this any time. It only decides what you&rsquo;re shown — nothing is ruled
                    out, and no mark is lost.
                  </Text>
                </div>
              ) : (
                <Text size="sm" tone="tertiary">
                  Change this any time. It only decides what you&rsquo;re shown — nothing is ruled
                  out, and no mark is lost.
                </Text>
              )}
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
                  <SaveState state={store.saveState} />
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
                <aside className={adaptive.rail} aria-label="Your marks and where to go next">
                  <Card className={adaptive.railCard}>
                    <div className={adaptive.railHead}>Marked so far</div>
                    <div className={adaptive.tally}>
                      {(['love', 'okay', 'never'] as BankMark[]).map((option) => (
                        <div
                          key={option}
                          className={adaptive.tallyRow}
                          data-testid={`tally-${option}`}
                        >
                          <span
                            className={`${adaptive.dot} ${adaptive[option]}`}
                            aria-hidden="true"
                          />
                          {MARK_META[option].label}
                          <b>{Object.values(store.marks).filter((m) => m === option).length}</b>
                        </div>
                      ))}
                    </div>
                  </Card>
                  <Card className={adaptive.railCard}>
                    <div className={adaptive.railActions}>
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
                          Done — show me
                        </Button>
                      )}
                      {areaIndex > 0 ? (
                        <Button
                          variant="secondary"
                          disabled={store.busy}
                          onClick={() => goToArea(areaIndex - 1)}
                        >
                          ← Previous
                        </Button>
                      ) : null}
                      {/* A partial pass is designed to be worth something, so finishing must never require
                          clicking through all 36 areas. */}
                      <Button
                        variant="ghost"
                        disabled={store.busy}
                        onClick={() => void store.submitBank(testId)}
                      >
                        Done for now — show me
                      </Button>
                    </div>
                  </Card>
                  <Text size="sm" tone="tertiary">
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
                    <Card className={adaptive.railCard}>
                      <Text size="sm" tone="secondary">
                        Only tap what actually does something for you — skip the rest.{' '}
                        <Flame size={13} aria-hidden="true" /> if you love it,{' '}
                        <Contrast size={13} aria-hidden="true" /> if it&rsquo;s okay,{' '}
                        <Ban size={13} aria-hidden="true" /> if it&rsquo;s a no. A <em>never</em> is
                        a boundary: nothing in SelfOS will suggest it again. Moving on skips
                        whatever you left alone, and everything saves as you go.
                      </Text>
                    </Card>
                  ) : null}
                </aside>
              </div>
            </div>
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

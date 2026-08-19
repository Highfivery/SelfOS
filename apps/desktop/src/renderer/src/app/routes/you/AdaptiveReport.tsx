import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Lock } from 'lucide-react';
import { NO_SIGNAL_BAND, type AdaptiveReading, type LexiconEntry } from '@shared/schemas';
import { isAnsweredTurn } from '@selfos/core/schemas';

import {
  AdminOnlyBadge,
  Banner,
  Button,
  Card,
  Heading,
  Markdown,
  Stack,
  Text,
  TrendLine,
} from '../../../design-system/components';
import { useAdaptiveTestStore } from '../../../stores/adaptiveTestStore';
import { AdaptiveHead } from './AdaptiveHead';
import { CrisisFooter } from '../sessions/CrisisFooter';
import styles from './You.module.css';
import take from './TestTake.module.css';
import { bothSidesAnswered, DIRTY_TALK_SPINE } from '@selfos/core/adaptive-spine';
import adaptive from './Adaptive.module.css';

/**
 * The synthesis returns machine keys (`buildUp`, `praise`). Nothing had ever rendered them, so nothing had
 * ever needed labels — an unmapped key falls back to itself rather than being hidden, so a new register or
 * context the model returns still shows up instead of silently vanishing.
 */
const REGISTER_LABELS: Record<string, string> = {
  praise: 'Praise',
  claiming: 'Claiming',
  command: 'Command',
  narration: 'Narration',
  degradation: 'Degradation',
  begging: 'Begging',
  filth: 'Filth',
};

const CONTEXT_LABELS: Record<string, string> = {
  buildUp: 'Build-up',
  during: 'During',
  edge: 'At the edge',
  after: 'After',
  sexting: 'Sexting',
  phone: 'On the phone',
};

/**
 * The dimension labels, taken from the spine ITSELF rather than copied here.
 *
 * This used to be a hand-maintained second list, and adding "Names & address" to the spine without also adding
 * it here put the raw key `dirtytalk.names` on screen in the person's own profile. Two lists of the same thing
 * drift the moment one of them is edited — so there is one list now, and an unmapped key still falls back to
 * itself rather than being hidden.
 */
const SPINE_LABELS: Record<string, string> = Object.fromEntries(
  DIRTY_TALK_SPINE.map((dimension) => [dimension.key, dimension.label]),
);

function Chips({
  entries,
  never,
}: {
  entries: LexiconEntry[];
  never?: boolean;
}): JSX.Element | null {
  if (entries.length === 0) return null;
  return (
    <ul className={adaptive.lexiconList}>
      {entries.map((entry) => (
        <li key={entry.key} className={`${adaptive.chip} ${never ? adaptive.chipNever : ''}`}>
          {entry.text}
        </li>
      ))}
    </ul>
  );
}

/** A row of the ranked strip. Muted below the midpoint, so "mostly doesn't land" reads without a legend. */
function DimRow({
  label,
  value,
  display,
}: {
  label: string;
  value: number;
  display?: string;
}): JSX.Element {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  // A floor, or a real-but-small reading paints nothing and reads as "not measured" — which is the one thing
  // this bar must never say, since a dimension with no signal is deliberately not charted at all. A genuine
  // zero keeps an empty track: that IS the honest picture, and the number beside it says so.
  const width = pct === 0 ? 0 : Math.max(pct, 3);
  return (
    <div className={`${adaptive.dimRow} ${value < 0.5 ? adaptive.muted : ''}`}>
      <span>{label}</span>
      {/* The bar is decoration; the number beside it is the text equivalent (§9), so no aria is needed. */}
      <span className={adaptive.dimTrack} aria-hidden="true">
        <i style={{ width: `${width}%` }} />
      </span>
      <span className={adaptive.dimValue}>{display ?? `${pct}%`}</span>
    </div>
  );
}

/**
 * A list that folds. The report's whole problem was length: every list here can run to dozens of entries,
 * and a person scrolling past 60 chips to reach the next section learns nothing from chips 13–60. The first
 * few are the signal; the rest are on record and one tap away.
 */
const FOLD_AFTER = 12;

function FoldedChips({
  entries,
  never,
  label,
  tone,
}: {
  entries: LexiconEntry[];
  never?: boolean;
  label: string;
  /** Which band this is. The three used to be identical grey chips in three loose rows — the same words in
   *  the same style under three quiet labels, so nothing about the shape said which mattered. */
  tone?: 'love' | 'say';
}): JSX.Element | null {
  if (entries.length === 0) return null;
  const head = entries.slice(0, FOLD_AFTER);
  const rest = entries.slice(FOLD_AFTER);
  const band = tone === 'love' ? adaptive.bandLove : tone === 'say' ? adaptive.bandSay : '';
  return (
    <div className={`${adaptive.wordBand} ${band}`}>
      <div className={adaptive.bandHead}>
        <Text size="sm" tone="secondary">
          {label}
        </Text>
        <span className={adaptive.bandCount}>{entries.length}</span>
      </div>
      <Chips entries={head} {...(never ? { never: true } : {})} />
      {rest.length > 0 ? (
        <details className={adaptive.fold}>
          <summary>See the other {rest.length}</summary>
          <Chips entries={rest} {...(never ? { never: true } : {})} />
        </details>
      ) : null}
    </div>
  );
}

const READING_LABELS: Record<AdaptiveReading['kind'], string> = {
  pattern: 'Pattern',
  gap: 'Gap',
  suggestion: 'Try',
};

/**
 * Where the profile is used. On the page because the profile is not a document — it changes what the rest of
 * the app says to them, and a person who cannot see that reads this screen as a long record of what they
 * tapped. Each line states something that is actually true of the wiring, not an aspiration.
 */
const USED_IN: { where: string; what: string }[] = [
  { where: 'Sessions', what: 'Your coach uses your register, and never what you ruled out.' },
  { where: 'Questionnaires', what: "Stops asking about ground you've already settled here." },
  { where: 'Together', what: "Quietly steers your partner's coach toward what lands for you." },
  { where: 'Practice', what: 'The things you want to say become a session you can run.' },
  { where: 'Everywhere', what: 'A hard no is suppressed app-wide, with or without a partner.' },
];

/**
 * 74 §3.3 — the report. Written to them, in their register, with the machine-usable lexicon underneath it.
 *
 * Everything here is editable (§3.4): it is THEIR vocabulary, and an AI reading of it is a draft. A hard no is
 * the one thing only they can lift, which is why clearing it is an explicit button rather than a re-rate.
 */
export function AdaptiveReport(): JSX.Element {
  const { testId = 'dirty-talk' } = useParams();
  const navigate = useNavigate();
  const state = useAdaptiveTestStore((s) => s.state);
  const loaded = useAdaptiveTestStore((s) => s.loaded);
  const load = useAdaptiveTestStore((s) => s.load);
  const editLexicon = useAdaptiveTestStore((s) => s.editLexicon);
  const synthesize = useAdaptiveTestStore((s) => s.synthesize);
  const busy = useAdaptiveTestStore((s) => s.busy);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const onDelete = async (): Promise<void> => {
    const next = await window.selfos?.testsAdaptiveDeleteAll({ testId });
    setConfirmingDelete(false);
    if (next) useAdaptiveTestStore.setState({ state: next });
  };

  useEffect(() => {
    void load(testId);
  }, [load, testId]);

  if (loaded && !state) {
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
  if (!state) {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <Text tone="secondary">Loading…</Text>
        </div>
      </div>
    );
  }

  const latest = state.latest;
  const lexicon = state.lexicon;
  // Both lists are restricted to the side the person was actually ASKED about (74 §3.6.6). Without this an
  // oriented entry — seeded on one side only — still shows up in the other list, and the report tells someone
  // they love saying a line the deck never offered them on the say side.
  const askedHear = (e: (typeof lexicon.entries)[number]): boolean =>
    e.sides === undefined || e.sides.includes('hear');
  const askedSay = (e: (typeof lexicon.entries)[number]): boolean =>
    e.sides === undefined || e.sides.includes('say');
  // 74 §3.6.8 — pet names, per direction. A name is answered twice, so it belongs in its own section rather
  // than folded into the loved-lines list where the direction would be lost.
  const nameEntries = lexicon.entries.filter((e) => e.family.startsWith('names-'));
  const pickNames = (side: 'hearState' | 'sayState', mark: 'love' | 'okay' | 'never'): string[] =>
    nameEntries.filter((e) => e[side] === mark).map((e) => e.text);
  const names = {
    callMe: pickNames('hearState', 'love'),
    okayCalled: pickNames('hearState', 'okay'),
    neverCalled: pickNames('hearState', 'never'),
    iCall: pickNames('sayState', 'love'),
    okaySaying: pickNames('sayState', 'okay'),
    neverSaying: pickNames('sayState', 'never'),
  };
  const loves = lexicon.entries.filter((e) => e.state === undefined && e.hear >= 3 && askedHear(e));
  const says = lexicon.entries.filter((e) => e.state === undefined && e.say >= 3 && askedSay(e));
  // 74 §3.6.2/§3.6.6 — sourced from the hear/say GAP, not the middle mark (which is a mild yes now), and only
  // where BOTH sides were actually asked: a side the orientation never offered is not a thing they freeze on.
  // 74 §3.6.11 — ANSWERED, not merely offered. This had its own inlined copy of the rule and so its own copy
  // of the bug: every pet-name row offers both directions, so leaving one blank read as a rated zero and put
  // "want to, and freeze" in front of someone who had simply not answered that side.
  const notYet = lexicon.entries.filter(
    (e) => e.state === undefined && e.hear >= 3 && e.say <= 1 && bothSidesAnswered(e),
  );
  const never = lexicon.entries.filter((e) => e.state === 'never');
  // The middle mark. It used to appear nowhere: recorded, restored in the deck, then absent from the report
  // AND from every prompt — so hundreds of taps bought the person nothing, and their own profile silently
  // omitted their own answers. Shown last, plainly second-tier, so it can't be read as a favourite.
  // Two ways to land here, and both were invisible before. `state === 'okay'` is the middle mark. The other
  // is an entry marked LOVE in the deck and then dialled DOWN to 1–2 in the split — which is a normal thing
  // to do ("I like it a little"), and it fell out of every bucket: below the >= 3 bar for loved, not a
  // boundary, not the middle mark. Recorded, and shown nowhere. It reads exactly as "fine, not a favourite",
  // so it belongs here. Prompts still take only >= 3 — a 1 should not lead.
  const okay = lexicon.entries.filter(
    (e) =>
      e.state === 'okay' ||
      (e.state === undefined && Math.max(e.hear, e.say) > 0 && Math.max(e.hear, e.say) < 3),
  );

  // Oldest → newest, so the chart reads left-to-right like time does. `history` arrives newest-first.
  const takes = [...state.history].reverse();
  // One series per spine dimension that has a real reading in at least two takes. A dimension with no signal
  // is EXCLUDED rather than plotted at 0 — the same rule the bars follow, for the same reason: a flat zero
  // line would tell them something about themselves they never said (74 §3.3).
  const trendSeries =
    takes.length >= 2
      ? Object.entries(
          takes.reduce<Record<string, { x: number; y: number }[]>>((acc, result, i) => {
            for (const score of result.scores) {
              if (score.band === NO_SIGNAL_BAND) continue;
              (acc[score.key] ??= []).push({ x: i, y: score.normalized });
            }
            return acc;
          }, {}),
        )
          .filter(([, points]) => points.length >= 2)
          .map(([key, points]) => ({ label: SPINE_LABELS[key] ?? key, points }))
      : [];

  /**
   * The claim the report leads with, and the rest of the prose under it.
   *
   * `lede` is its own field for a reason (74 §3.3): pulling the first paragraph out of the narrative works
   * until the model opens with a throat-clear, and then the loudest line on the page is filler. A take from
   * BEFORE the field existed has no lede, so the first paragraph is the fallback rather than nothing —
   * that take's report still opens on a sentence instead of a heading.
   */
  const paragraphs = (latest?.narrative ?? '').split(/\n{2,}/).filter((p) => p.trim() !== '');

  /**
   * 74 §3.6.20 — the answers, grouped by which step asked for them. Read from the take's own turns, so a
   * question answered in an earlier sitting reads back the same as one answered a minute ago.
   */
  const told = (
    [
      { label: 'The questions it asked', phase: 'probe' },
      { label: 'In the moment', phase: 'scenario' },
    ] as const
  )
    .map((group) => ({
      label: group.label,
      items: (latest?.turns ?? [])
        .filter((turn) => turn.phase === group.phase && isAnsweredTurn(turn.answer))
        .map((turn) => ({ id: turn.item.id, asked: turn.item.text, said: String(turn.answer) })),
    }))
    .filter((group) => group.items.length > 0);
  const lede = latest?.lede ?? paragraphs[0] ?? '';
  const rest = (latest?.lede ? paragraphs : paragraphs.slice(1)).join('\n\n');
  const readings = latest?.readings ?? [];

  // Strongest first, and only what was actually scored — the no-signal ones are listed, never charted.
  const scored = latest?.scores ?? [];
  const ranked = scored
    .filter((score) => score.band !== NO_SIGNAL_BAND)
    .slice()
    .sort((a, b) => b.normalized - a.normalized);
  const unscored = scored.filter((score) => score.band === NO_SIGNAL_BAND);
  // The two hear/say bars are counts, not scores, so they share a scale rather than each filling its track —
  // two full bars reading "41" and "9" would say the opposite of what the numbers say.
  const sideMax = Math.max(loves.length, says.length);

  // The synthesis scores these on every take. Strongest first, and only what it actually returned.
  const registers = Object.entries(lexicon.registers)
    .filter(([, value]) => Number.isFinite(value))
    .sort((a, b) => b[1] - a[1]);
  const contexts = Object.entries(lexicon.contexts).filter(([, ctx]) => Number.isFinite(ctx?.heat));

  return (
    <div className={styles.page}>
      <div className={`${styles.inner} ${adaptive.reportBody}`}>
        <Stack gap={5}>
          <button type="button" className={take.back} onClick={() => navigate('/tests')}>
            ← Tests
          </button>

          {/* ONE head for both screens (`AdaptiveHead`). This one had drifted into its own typography —
              a bare eyebrow, a small full-width lead, the framing line above the content instead of under
              it — so the same test looked like two different features one screen apart. The disclosure is
              the LEAD here because the report is the screen they come back to: it must not quietly
              contradict what the take's intro promised (74 §8.4). */}
          <AdaptiveHead
            title={state.title}
            lead="Nobody else reads this. It shapes how SelfOS talks to you — and, if you have a partner here, it quietly shapes what their coach suggests to them, without ever telling them what you said."
            framing={state.framing}
            yours
          />

          {/* §8.3 — a take that carried a disclosure leads with support, before anything erotic. */}
          {latest?.crisisFlag ? (
            <Banner tone="warning" role="alert">
              Something you wrote here sounds like it was hard, and bigger than a preference. Please
              reach out to someone who can help — the resources below are there for you, and this
              profile can wait.
            </Banner>
          ) : null}

          {/*
           * Nothing taken yet. This used to render a "you haven't taken this" banner + a Take it button, and
           * then carry on into the rest of the report — an empty "Your words" section with "Love to hear" and
           * "Comfortable saying" headings and nothing under either, and a SECOND Take it button in the footer.
           * One invitation, and everything downstream of a take stops here.
           */}
          {!latest ? (
            /* Bare text and a button on an empty canvas. It is the first thing anyone sees of this test, so
               it gets the same shape as the invitation: what it will hold, then the one action. */
            <div className={adaptive.introWrap}>
              <Card className={adaptive.introCard}>
                <Text tone="secondary">
                  Nothing here yet. Once you&rsquo;ve taken it, this page holds your words — what
                  you love to hear, what you can say out loud, what you&rsquo;re working up to, and
                  what you&rsquo;d rather it never used.
                </Text>
                <div className={adaptive.introActions}>
                  <Button variant="primary" onClick={() => navigate(`/tests/${testId}/take`)}>
                    Take it
                  </Button>
                </div>
              </Card>
              <CrisisFooter />
            </div>
          ) : (
            <>
              {/*
               * The hero. The report used to open on a Markdown wall, so the first thing a person met after
               * hundreds of marks was more reading. It opens on ONE claim now, set at reading size: the
               * model's `lede` when it wrote one, otherwise the narrative's own opening paragraph so a take
               * from before this existed still leads with something rather than a heading.
               */}
              {lede ? (
                <Card className={adaptive.hero}>
                  <Heading level={2} className={adaptive.heroTitle}>
                    What your words say
                  </Heading>
                  <div className={adaptive.lede}>
                    <Markdown>{lede}</Markdown>
                  </div>
                </Card>
              ) : null}

              {!latest.narrative ? (
                <Banner tone="info">
                  <Stack gap={2}>
                    <span>
                      The psychological analysis didn&rsquo;t come through this time — everything
                      below is from your own answers, and it&rsquo;s all still yours.
                    </span>
                    {/* It used to say this and stop, which left the one part that needs a model with no way
                        to try again short of retaking the whole thing. Re-running is idempotent — the take
                        keeps its insight id — so this is safe to offer. */}
                    <span>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void synthesize(testId, latest.id)}
                      >
                        {busy ? 'Analysing…' : 'Run the analysis again'}
                      </Button>
                    </span>
                  </Stack>
                </Banner>
              ) : null}

              {/*
               * "Why this, probably" — the keyed readings. Each names its own kind before it makes its
               * claim, and cites where else in SelfOS the pattern shows when the synthesis had a real
               * source for it. Hedged on purpose: this is an inference about a person, not a verdict.
               */}
              {readings.length > 0 ? (
                <section>
                  <Heading level={2}>Why this, probably</Heading>
                  <Text size="sm" tone="tertiary">
                    Read against the rest of what SelfOS knows about you. Offered, not asserted.
                  </Text>
                  <div>
                    {readings.map((reading, i) => (
                      <div key={`${reading.kind}-${i}`} className={adaptive.whyRow}>
                        <span className={adaptive.whyKey}>{READING_LABELS[reading.kind]}</span>
                        <div>
                          <Text>{reading.text}</Text>
                          {reading.source ? (
                            <Text size="sm" tone="tertiary" className={adaptive.whySource}>
                              {reading.source}
                            </Text>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* The full read, after the claim rather than instead of it. */}
              {rest ? (
                <section>
                  {/* "The read" / "the written read" said nothing about what it IS. This is an analysis of
                      what their answers say about them — name it that. */}
                  <Heading level={2}>Psychological analysis</Heading>
                  <Card className={adaptive.reportSection}>
                    <Markdown>{rest}</Markdown>
                  </Card>
                </section>
              ) : null}

              <div className={adaptive.reportGrid}>
                {/* The shape of it — the strongest few, the rest folded. Twelve stacked bars WAS the wall. */}
                <Card>
                  <Heading level={3}>The shape of it</Heading>
                  <Text size="sm" tone="tertiary">
                    Only what you gave a real signal on. The rest is listed, not charted.
                  </Text>
                  {ranked.length === 0 ? (
                    <Text tone="secondary">
                      Nothing scored yet — this fills in as you mark things.
                    </Text>
                  ) : null}
                  {ranked.slice(0, 5).map((score) => (
                    <DimRow
                      key={score.key}
                      label={SPINE_LABELS[score.key] ?? score.key}
                      value={score.normalized}
                    />
                  ))}
                  {ranked.length > 5 ? (
                    <details className={adaptive.fold}>
                      <summary>See the other {ranked.length - 5}</summary>
                      {ranked.slice(5).map((score) => (
                        <DimRow
                          key={score.key}
                          label={SPINE_LABELS[score.key] ?? score.key}
                          value={score.normalized}
                        />
                      ))}
                    </details>
                  ) : null}
                  {/* A dimension with no signal is LISTED, never charted: a 0% bar next to "not their thing"
                      would tell them something about themselves they never actually said (74 §3.3). */}
                  {unscored.length > 0 ? (
                    <details className={adaptive.fold}>
                      <summary>{unscored.length} with nothing to go on yet</summary>
                      <Text size="sm" tone="tertiary">
                        {unscored.map((score) => SPINE_LABELS[score.key] ?? score.key).join(' · ')}{' '}
                        — these had no marks this time, so there is nothing to say about them. They
                        are not zero.
                      </Text>
                    </details>
                  ) : null}
                </Card>

                {/* The hear/say gap: the thing the test exists to find, and it was buried in a chip list. */}
                <Card>
                  <Heading level={3}>Hearing vs saying</Heading>
                  <Text size="sm" tone="tertiary">
                    The gap the test exists to find.
                  </Text>
                  <DimRow
                    label="Love to hear"
                    value={sideMax === 0 ? 0 : loves.length / sideMax}
                    display={String(loves.length)}
                  />
                  <DimRow
                    label="Would say"
                    value={sideMax === 0 ? 0 : says.length / sideMax}
                    display={String(says.length)}
                  />
                  {notYet.length > 0 ? (
                    <>
                      <Text size="sm" tone="tertiary" className={adaptive.whySource}>
                        {notYet.length} you want said to you that you wouldn&rsquo;t say back —
                        worth practising, not a flaw.
                      </Text>
                      <details className={adaptive.fold}>
                        <summary>See the {notYet.length}</summary>
                        <Chips entries={notYet} />
                      </details>
                      <div className={take.footer}>
                        <Button
                          variant="secondary"
                          onClick={() =>
                            // Straight into the guided practice session with the goal already loaded — the
                            // whole point of deriving `wantsToSay` is that it stops asking what they want
                            // to say (§3.5).
                            navigate('/sessions', {
                              state: {
                                startGuideId: 'dirty-talk-practice',
                                seedText: `I want to be able to say: ${notYet
                                  .map((e) => e.text)
                                  .join(', ')}.`,
                              },
                            })
                          }
                        >
                          Practise this
                        </Button>
                      </div>
                    </>
                  ) : (
                    <Text size="sm" tone="tertiary" className={adaptive.whySource}>
                      Nothing sitting in the gap right now — what you like hearing, you&rsquo;d say.
                    </Text>
                  )}
                </Card>
              </div>

              {/*
               * 74 §3.6.8 — the most directly usable thing the test produces, and it produced none of it
               * before: what the two of you want to be called. Loved names lead; the middle mark is a plain
               * second-tier line; the hard nos are ONE line with a disclosure rather than a field of
               * struck-through chips — a boundary is a boundary, not a result to display at length.
               */}
              {names.callMe.length + names.iCall.length + names.neverCalled.length > 0 ? (
                <Card>
                  <div className={adaptive.sectionHead}>
                    <Heading level={2}>What to call each other</Heading>
                    <button
                      type="button"
                      className={adaptive.textLink}
                      onClick={() =>
                        navigate(`/tests/${testId}/take`, { state: { step: 'names' } })
                      }
                    >
                      Edit the names
                    </button>
                  </div>
                  <div className={adaptive.nameCols}>
                    {(
                      [
                        {
                          head: 'Call me',
                          love: names.callMe,
                          okay: names.okayCalled,
                          no: names.neverCalled,
                        },
                        {
                          head: 'What you call them',
                          love: names.iCall,
                          okay: names.okaySaying,
                          no: names.neverSaying,
                        },
                      ] as const
                    ).map((col) => (
                      <div key={col.head}>
                        <Text size="sm" tone="secondary">
                          {col.head}
                        </Text>
                        {/* A column heading with nothing under it reads as a broken screen — and it is
                            entirely normal to answer one direction and not the other. */}
                        {col.love.length + col.okay.length + col.no.length === 0 ? (
                          <Text size="sm" tone="tertiary">
                            Nothing marked this way yet.
                          </Text>
                        ) : null}
                        {/* Folded like every other list here. The bank holds thousands of names, so a
                            person who marked freely had the same wall of chips this redesign exists to
                            remove — just in a nicer colour. */}
                        <div className={adaptive.chipRow}>
                          {col.love.slice(0, FOLD_AFTER).map((text) => (
                            <span
                              key={text}
                              className={`${adaptive.nameChip} ${adaptive.chipLove}`}
                            >
                              {text}
                            </span>
                          ))}
                        </div>
                        {col.love.length > FOLD_AFTER ? (
                          <details className={adaptive.fold}>
                            <summary>See the other {col.love.length - FOLD_AFTER}</summary>
                            <div className={adaptive.chipRow}>
                              {col.love.slice(FOLD_AFTER).map((text) => (
                                <span
                                  key={text}
                                  className={`${adaptive.nameChip} ${adaptive.chipLove}`}
                                >
                                  {text}
                                </span>
                              ))}
                            </div>
                          </details>
                        ) : null}
                        {col.okay.length > 0 ? (
                          <Text size="sm" tone="tertiary" className={adaptive.tier2}>
                            Fine either way: {col.okay.join(' · ')}
                          </Text>
                        ) : null}
                        {col.no.length > 0 ? (
                          <div className={adaptive.noBox}>
                            <strong>{col.no.length} not for you.</strong> Never suggested anywhere
                            in SelfOS while they&rsquo;re marked &mdash; change any of them whenever
                            you like.
                            <details className={adaptive.fold}>
                              <summary>See them</summary>
                              <div className={adaptive.chipRow}>
                                {col.no.map((text) => (
                                  <span
                                    key={text}
                                    className={`${adaptive.nameChip} ${adaptive.chipNo}`}
                                  >
                                    {text}
                                  </span>
                                ))}
                              </div>
                            </details>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}

              {/*
               * 74 §3.6.20 — what you TOLD it, given back to you.
               *
               * The report showed readings, prose, names, words, scores and trends — and nothing you had
               * actually said. The probe answers and moment picks fed the synthesis as transcript and were
               * then invisible: reachable only by navigating back into the take's own steps. That is the
               * same write-only pattern the middle mark had, where hundreds of taps bought nothing the
               * person could see.
               *
               * Folded, because the report was rightly called a long useless page once already. It costs
               * one row until it is opened.
               */}
              {told.length > 0 ? (
                <Card>
                  <details className={adaptive.fold}>
                    {/*
                     * The native `<details>` marker is a list-item bullet at the START of the summary box,
                     * so a summary whose children are BLOCKS (a heading and a line under it) pushes it onto
                     * its own line above them — which is the misalignment. Every other fold in this report
                     * has a one-line text summary, so this is the only one that needed a row of its own.
                     * Lucide, not a glyph (§12).
                     */}
                    <summary className={adaptive.foldHead}>
                      <ChevronRight size={16} className={adaptive.foldChevron} aria-hidden="true" />
                      <span>
                        <Heading level={2}>What you told it</Heading>
                        <Text size="sm" tone="tertiary">
                          {told.length} answered — the questions it asked and the moments you picked
                        </Text>
                      </span>
                    </summary>
                    <Stack gap={4}>
                      {told.map((group) => (
                        <div key={group.label}>
                          <Text size="sm" tone="tertiary">
                            {group.label}
                          </Text>
                          <Stack gap={2}>
                            {group.items.map((item) => (
                              <div key={item.id} className={adaptive.toldRow}>
                                <Text size="sm" tone="secondary">
                                  {item.asked}
                                </Text>
                                <Text>
                                  <b>{item.said}</b>
                                </Text>
                              </div>
                            ))}
                          </Stack>
                        </div>
                      ))}
                    </Stack>
                    <button
                      type="button"
                      className={adaptive.textLink}
                      onClick={() =>
                        navigate(`/tests/${testId}/take`, { state: { step: 'probe' } })
                      }
                    >
                      Change any of these
                    </button>
                  </details>
                </Card>
              ) : null}

              <Card>
                <div className={adaptive.sectionHead}>
                  <Heading level={2}>Your words</Heading>
                  <button
                    type="button"
                    className={adaptive.textLink}
                    onClick={() => navigate(`/tests/${testId}/take`, { state: { step: 'bank' } })}
                  >
                    Edit the words
                  </button>
                </div>
                <Stack gap={4}>
                  {/* A heading with nothing under it is the empty-report defect one level down: it reads as
                      a broken screen, and it says "we have nothing" in the voice of "here is your answer".
                      Each band appears only when it holds something, and if none of them do it says so. */}
                  <FoldedChips entries={loves} label="Love to hear" tone="love" />
                  <FoldedChips entries={says} label="Comfortable saying" tone="say" />
                  {loves.length + says.length + notYet.length + never.length + okay.length === 0 ? (
                    <Text tone="secondary">
                      Nothing from the words yet — this fills in as you mark them.
                    </Text>
                  ) : null}
                  <FoldedChips entries={okay} label="Fine either way — usable, not favourites" />
                  {never.length > 0 ? (
                    <div className={adaptive.noBox}>
                      <strong>{never.length} not for you.</strong> Nothing in SelfOS will suggest
                      these for as long as they&rsquo;re marked &mdash; and changing your mind about
                      one is yours alone to do, any time.
                      <details className={adaptive.fold}>
                        <summary>See them, and change your mind</summary>
                        <Chips entries={never} never />
                        <Stack gap={2}>
                          {never.map((entry) => (
                            <Button
                              key={entry.key}
                              variant="ghost"
                              onClick={() =>
                                void editLexicon({ kind: 'setState', key: entry.key, state: null })
                              }
                            >
                              Changed my mind about &ldquo;{entry.text}&rdquo;
                            </Button>
                          ))}
                        </Stack>
                      </details>
                    </div>
                  ) : null}
                </Stack>
              </Card>

              {/*
               * What the synthesis actually said about REGISTER and TIMING. It has been scoring both on every
               * take and nothing read them — generated, stored, discarded. The timing read is the most usable
               * thing in it.
               */}
              {registers.length > 0 || contexts.length > 0 ? (
                <section>
                  <div className={adaptive.sectionHead}>
                    <Heading level={2}>Register &amp; timing</Heading>
                    <button
                      type="button"
                      className={adaptive.textLink}
                      onClick={() =>
                        navigate(`/tests/${testId}/take`, { state: { step: 'scenario' } })
                      }
                    >
                      Redo “in the moment”
                    </button>
                  </div>
                  <div className={adaptive.reportGrid}>
                    {registers.length > 0 ? (
                      <Card>
                        <Text size="sm" tone="secondary">
                          Which register lands
                        </Text>
                        {registers.map(([key, value]) => (
                          <DimRow key={key} label={REGISTER_LABELS[key] ?? key} value={value} />
                        ))}
                      </Card>
                    ) : null}
                    {contexts.length > 0 ? (
                      <Card>
                        <Text size="sm" tone="secondary">
                          When it lands
                        </Text>
                        {contexts.map(([key, ctx]) => (
                          <div key={key}>
                            <DimRow label={CONTEXT_LABELS[key] ?? key} value={ctx.heat} />
                            {ctx.note ? (
                              <Text size="sm" tone="tertiary">
                                {ctx.note}
                              </Text>
                            ) : null}
                          </div>
                        ))}
                      </Card>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {/*
               * Across takes. The whole reason the spine is FIXED (74 §4.2) is that a retake stays comparable
               * — the report was throwing that away and showing only the newest take, so nothing in the app
               * ever answered "has this moved?". The chart's text equivalents come from `LineChart` (§9).
               */}
              {trendSeries.length > 0 ? (
                <Card>
                  <Heading level={2}>Across your takes</Heading>
                  <Text size="sm" tone="tertiary">
                    The spine is fixed, so a retake is comparable. {takes.length} takes so far.
                  </Text>
                  {/*
                   * One labelled row per dimension, not four overlapping lines in a small box with a colour
                   * legend underneath. The old chart was capped at 440px inside a full-width section, so most
                   * of the row was empty; nothing could be read without matching a colour to a legend; and
                   * four near-flat lines on one axis is the least legible way to show four separate trends.
                   * A row per dimension is scannable, fills the width, needs no legend, and says the change
                   * in words — which is also the §9 text equivalent.
                   */}
                  <div className={adaptive.trendRows}>
                    {trendSeries.map((series) => {
                      const first = series.points[0]?.y ?? 0;
                      const last = series.points[series.points.length - 1]?.y ?? 0;
                      const delta = Math.round((last - first) * 100);
                      return (
                        <div key={series.label} className={adaptive.trendRow}>
                          <span className={adaptive.trendLabel}>{series.label}</span>
                          <TrendLine
                            points={series.points.map((point) => ({
                              date: String(point.x),
                              value: point.y,
                            }))}
                            min={0}
                            max={1}
                            aria-label={`${series.label} across your takes`}
                          />
                          <span
                            className={`${adaptive.trendDelta} ${
                              delta > 0 ? adaptive.up : delta < 0 ? adaptive.down : ''
                            }`}
                          >
                            {delta === 0 ? 'unchanged' : `${delta > 0 ? '+' : ''}${delta}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ) : null}

              {/* The profile is not a page you visit — say so, on the page. */}
              <Card>
                <Heading level={2}>Where this gets used</Heading>
                <Text size="sm" tone="tertiary">
                  This changes what the rest of SelfOS says to you. Nobody is shown your answers.
                </Text>
                <div className={adaptive.useGrid}>
                  {USED_IN.map((row) => (
                    <div key={row.where} className={adaptive.useTile}>
                      <b>{row.where}</b>
                      <Text size="sm" tone="secondary">
                        {row.what}
                      </Text>
                    </div>
                  ))}
                </div>
              </Card>

              {/* The take's own cost — accrued across every AI phase, not just the synthesis. The bridge already
              redacts it for anyone without `budgets.manage` (the durable §06 rule: the $ boundary is the
              bridge, not the UI), so its presence IS the permission — no second check here. */}
              {latest?.costUsd !== undefined ? (
                <Text size="sm" tone="tertiary">
                  <AdminOnlyBadge /> This take cost ${latest.costUsd.toFixed(3)}
                </Text>
              ) : null}

              {state.staleForRetake ? (
                <Banner tone="info">
                  It&rsquo;s been a while — worth a fresh look? What you want changes.
                </Banner>
              ) : null}

              <div className={take.footer}>
                <Button
                  variant="secondary"
                  // Same as the card's Retake: the choice, not the intro (74 §3.6.15).
                  onClick={() => navigate(`/tests/${testId}/take`, { state: { retake: true } })}
                >
                  Take it again
                </Button>
                {latest ? (
                  confirmingDelete ? (
                    <>
                      <Button variant="danger" onClick={() => void onDelete()}>
                        Delete it all
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
                        Keep it
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" onClick={() => setConfirmingDelete(true)}>
                      Delete this profile
                    </Button>
                  )
                ) : null}
              </div>
              {confirmingDelete ? (
                <Text size="sm" tone="secondary">
                  This removes every take, the profile, and the words you rated — everywhere in
                  SelfOS, including the ones you marked <strong>not for you</strong>. Nothing is
                  kept back, so SelfOS stops steering clear of those words too.
                </Text>
              ) : null}

              <CrisisFooter />
            </>
          )}
        </Stack>
      </div>
    </div>
  );
}

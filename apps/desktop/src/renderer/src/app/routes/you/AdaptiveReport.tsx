import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { NO_SIGNAL_BAND, type LexiconEntry } from '@shared/schemas';

import {
  AdminOnlyBadge,
  Banner,
  Button,
  Card,
  Heading,
  LineChart,
  Markdown,
  Stack,
  SubscaleBar,
  Text,
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
                  what is off the table for good.
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
              {latest?.narrative ? (
                <Card className={adaptive.reportSection}>
                  <Markdown>{latest.narrative}</Markdown>
                </Card>
              ) : latest ? (
                <Banner tone="info">
                  The written read didn&rsquo;t come through this time — everything below is from
                  your own answers, and it&rsquo;s all still yours.
                </Banner>
              ) : null}

              {latest ? (
                <section>
                  <Heading level={2}>The shape of it</Heading>
                  <Stack gap={2}>
                    {/* A dimension with no signal is LISTED, not charted: a 0% bar next to "not their thing"
                    would tell them something about themselves they never actually said (74 §3.3). */}
                    {latest.scores
                      .filter((score) => score.band !== NO_SIGNAL_BAND)
                      .map((score) => (
                        <SubscaleBar
                          key={score.key}
                          label={SPINE_LABELS[score.key] ?? score.key}
                          normalized={score.normalized}
                          {...(score.band !== undefined ? { band: score.band } : {})}
                          signed={false}
                        />
                      ))}
                  </Stack>
                  {latest.scores.some((score) => score.band === NO_SIGNAL_BAND) ? (
                    <Text size="sm" tone="tertiary">
                      Not covered this time:{' '}
                      {latest.scores
                        .filter((score) => score.band === NO_SIGNAL_BAND)
                        .map((score) => SPINE_LABELS[score.key] ?? score.key)
                        .join(' · ')}
                      .
                    </Text>
                  ) : null}
                </section>
              ) : null}

              {/*
               * Across takes. The whole reason the spine is FIXED (74 §4.2) is that a retake stays comparable —
               * the report was throwing that away and showing only the newest take, so nothing in the app ever
               * answered "has this moved?". The chart's text equivalents come from `LineChart` itself (§9).
               */}
              {trendSeries.length > 0 ? (
                <section>
                  <Heading level={2}>Across your takes</Heading>
                  <LineChart
                    series={trendSeries}
                    ariaLabel="How each dimension has moved across your takes"
                    yMin={0}
                    yMax={1}
                    yLowLabel="Low"
                    yHighLabel="High"
                    emphasizeLast
                  />
                </section>
              ) : null}

              {/*
               * What the synthesis actually said about REGISTER and TIMING. It has been scoring both on every
               * take and nothing read them — generated, stored, discarded. This is the person's own profile, and
               * the timing read is the most usable thing in it.
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
                  <Stack gap={4}>
                    {registers.length > 0 ? (
                      <div>
                        <Text size="sm" tone="secondary">
                          Which register lands
                        </Text>
                        <Stack gap={2}>
                          {registers.map(([key, value]) => (
                            <SubscaleBar
                              key={key}
                              label={REGISTER_LABELS[key] ?? key}
                              normalized={value}
                              signed={false}
                            />
                          ))}
                        </Stack>
                      </div>
                    ) : null}
                    {contexts.length > 0 ? (
                      <div>
                        <Text size="sm" tone="secondary">
                          When it lands
                        </Text>
                        <Stack gap={2}>
                          {contexts.map(([key, ctx]) => (
                            <div key={key}>
                              <SubscaleBar
                                label={CONTEXT_LABELS[key] ?? key}
                                normalized={ctx.heat}
                                signed={false}
                              />
                              {ctx.note ? (
                                <Text size="sm" tone="tertiary">
                                  {ctx.note}
                                </Text>
                              ) : null}
                            </div>
                          ))}
                        </Stack>
                      </div>
                    ) : null}
                  </Stack>
                </section>
              ) : null}

              {/*
               * 74 §3.6.8 — the most directly usable thing the test produces, and it produced none of it
               * before: what the two of you want to be called. Loved names lead; the middle mark is listed
               * plainly as second-tier; a hard no is shown struck through, because seeing it recorded is
               * the point. Per direction, since a name is answered twice.
               */}
              {names.callMe.length + names.iCall.length + names.neverCalled.length > 0 ? (
                <section>
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
                    <div>
                      <Text size="sm" tone="secondary">
                        Call me
                      </Text>
                      {names.callMe.length + names.okayCalled.length + names.neverCalled.length ===
                      0 ? (
                        <Text size="sm" tone="tertiary">
                          Nothing marked this way yet.
                        </Text>
                      ) : null}
                      <div className={adaptive.chipRow}>
                        {names.callMe.map((text) => (
                          <span key={text} className={`${adaptive.nameChip} ${adaptive.chipLove}`}>
                            {text}
                          </span>
                        ))}
                      </div>
                      {names.okayCalled.length > 0 ? (
                        <Text size="sm" tone="tertiary" className={adaptive.tier2}>
                          Fine either way: {names.okayCalled.join(' · ')}
                        </Text>
                      ) : null}
                      {names.neverCalled.length > 0 ? (
                        <div className={adaptive.chipRow}>
                          {names.neverCalled.map((text) => (
                            <span key={text} className={`${adaptive.nameChip} ${adaptive.chipNo}`}>
                              {text}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <Text size="sm" tone="secondary">
                        What you call them
                      </Text>
                      {/* A column heading with nothing under it reads as a broken screen — and it is entirely
                          normal to answer one direction and not the other. */}
                      {names.iCall.length + names.okaySaying.length + names.neverSaying.length ===
                      0 ? (
                        <Text size="sm" tone="tertiary">
                          Nothing marked this way yet.
                        </Text>
                      ) : null}
                      <div className={adaptive.chipRow}>
                        {names.iCall.map((text) => (
                          <span key={text} className={`${adaptive.nameChip} ${adaptive.chipLove}`}>
                            {text}
                          </span>
                        ))}
                      </div>
                      {names.okaySaying.length > 0 ? (
                        <Text size="sm" tone="tertiary" className={adaptive.tier2}>
                          Fine either way: {names.okaySaying.join(' · ')}
                        </Text>
                      ) : null}
                      {names.neverSaying.length > 0 ? (
                        <div className={adaptive.chipRow}>
                          {names.neverSaying.map((text) => (
                            <span key={text} className={`${adaptive.nameChip} ${adaptive.chipNo}`}>
                              {text}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </section>
              ) : null}

              <section>
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
                  {/* A heading with nothing under it is the empty-report defect one level down: it reads as a
                      broken screen, and it says "we have nothing" in the voice of "here is your answer". Each
                      band appears only when it holds something, and if none of them do the section says so. */}
                  {loves.length > 0 ? (
                    <div>
                      <Text size="sm" tone="secondary">
                        Love to hear
                      </Text>
                      <Chips entries={loves} />
                    </div>
                  ) : null}
                  {says.length > 0 ? (
                    <div>
                      <Text size="sm" tone="secondary">
                        Comfortable saying
                      </Text>
                      <Chips entries={says} />
                    </div>
                  ) : null}
                  {loves.length + says.length + notYet.length + never.length + okay.length === 0 ? (
                    <Text tone="secondary">
                      Nothing from the words yet — this fills in as you mark them.
                    </Text>
                  ) : null}
                  {notYet.length > 0 ? (
                    <div>
                      <Text size="sm" tone="secondary">
                        Want to, and freeze — worth practising
                      </Text>
                      <Chips entries={notYet} />
                      <div className={take.footer}>
                        <Button
                          variant="secondary"
                          onClick={() =>
                            // Straight into the guided practice session with the goal already loaded — the whole
                            // point of deriving `wantsToSay` is that it stops asking what they want to say (§3.5).
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
                    </div>
                  ) : null}
                  {okay.length > 0 ? (
                    <div>
                      <Text size="sm" tone="secondary">
                        Fine either way — usable, not favourites
                      </Text>
                      <Chips entries={okay} />
                    </div>
                  ) : null}
                  {never.length > 0 ? (
                    <div>
                      <Text size="sm" tone="secondary">
                        Off the table — nothing in SelfOS will suggest these
                      </Text>
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
                    </div>
                  ) : null}
                </Stack>
              </section>

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
                <Button variant="secondary" onClick={() => navigate(`/tests/${testId}/take`)}>
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
                  SelfOS. Anything you marked <strong>off the table</strong> stays off the table.
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

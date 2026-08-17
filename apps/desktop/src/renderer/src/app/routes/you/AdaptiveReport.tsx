import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { NO_SIGNAL_BAND, type LexiconEntry } from '@shared/schemas';

import {
  Banner,
  Button,
  Card,
  Heading,
  Markdown,
  Stack,
  SubscaleBar,
  Text,
} from '../../../design-system/components';
import { useAdaptiveTestStore } from '../../../stores/adaptiveTestStore';
import { CrisisFooter } from '../sessions/CrisisFooter';
import styles from './You.module.css';
import take from './TestTake.module.css';
import adaptive from './Adaptive.module.css';

const SPINE_LABELS: Record<string, string> = {
  'dirtytalk.explicitness': 'How explicit',
  'dirtytalk.praise': 'Praise',
  'dirtytalk.claiming': 'Being claimed',
  'dirtytalk.command': 'Being told',
  'dirtytalk.narration': 'Narration',
  'dirtytalk.degradation': 'Degradation',
  'dirtytalk.begging': 'Begging',
  'dirtytalk.taboo': 'Taboo & roleplay',
  'dirtytalk.receiving-voice': 'The receiving voice',
  'dirtytalk.giving-voice': 'The giving voice',
  'dirtytalk.say-confidence': 'Saying it out loud',
};

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
  const loves = lexicon.entries.filter((e) => e.state === undefined && e.hear >= 3 && askedHear(e));
  const says = lexicon.entries.filter((e) => e.state === undefined && e.say >= 3 && askedSay(e));
  // 74 §3.6.2/§3.6.6 — sourced from the hear/say GAP, not the middle mark (which is a mild yes now), and only
  // where BOTH sides were actually asked: a side the orientation never offered is not a thing they freeze on.
  const notYet = lexicon.entries.filter(
    (e) =>
      e.state === undefined &&
      e.hear >= 3 &&
      e.say <= 1 &&
      (e.sides === undefined || (e.sides.includes('hear') && e.sides.includes('say'))),
  );
  const never = lexicon.entries.filter((e) => e.state === 'never');

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Stack gap={5}>
          <button type="button" className={take.back} onClick={() => navigate('/tests')}>
            ← Tests
          </button>

          <header className={styles.header}>
            <span className={styles.eyebrow}>
              SelfOS
              <span className={styles.privateTag}>
                <Lock size={11} aria-hidden="true" /> yours
              </span>
            </span>
            <Heading level={1}>{state.title}</Heading>
            <Text size="sm" tone="tertiary" className={styles.framing}>
              {state.framing}
            </Text>
            {/* The same disclosure the take's intro carries — the report is the screen they come BACK to, so
                it must not quietly contradict it with a "private, only you" badge (74 §8.4). */}
            <Text size="sm" tone="tertiary">
              Nobody else reads this. It shapes how SelfOS talks to you — and, if you have a partner
              here, it quietly shapes what their coach suggests to them, without ever telling them
              what you said.
            </Text>
          </header>

          {/* §8.3 — a take that carried a disclosure leads with support, before anything erotic. */}
          {latest?.crisisFlag ? (
            <Banner tone="warning" role="alert">
              Something you wrote here sounds like it was hard, and bigger than a preference. Please
              reach out to someone who can help — the resources below are there for you, and this
              profile can wait.
            </Banner>
          ) : null}

          {!latest ? (
            <Stack gap={3}>
              <Banner tone="info">You haven&rsquo;t taken this yet.</Banner>
              <div>
                <Button variant="primary" onClick={() => navigate(`/tests/${testId}/take`)}>
                  Take it
                </Button>
              </div>
            </Stack>
          ) : null}

          {latest?.narrative ? (
            <Card className={adaptive.reportSection}>
              <Markdown>{latest.narrative}</Markdown>
            </Card>
          ) : latest ? (
            <Banner tone="info">
              The written read didn&rsquo;t come through this time — everything below is from your
              own answers, and it&rsquo;s all still yours.
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

          <section>
            <Heading level={2}>Your words</Heading>
            <Stack gap={4}>
              <div>
                <Text size="sm" tone="secondary">
                  Love to hear
                </Text>
                <Chips entries={loves} />
              </div>
              <div>
                <Text size="sm" tone="secondary">
                  Comfortable saying
                </Text>
                <Chips entries={says} />
              </div>
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

          {state.staleForRetake ? (
            <Banner tone="info">
              It&rsquo;s been a while — worth a fresh look? What you want changes.
            </Banner>
          ) : null}

          <div className={take.footer}>
            <Button variant="secondary" onClick={() => navigate(`/tests/${testId}/take`)}>
              {latest ? 'Take it again' : 'Take it'}
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
              This removes every take, the profile, and the words you rated — everywhere in SelfOS.
              Anything you marked <strong>off the table</strong> stays off the table.
            </Text>
          ) : null}

          <CrisisFooter />
        </Stack>
      </div>
    </div>
  );
}

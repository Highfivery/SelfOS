import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
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
 * 74 §3.2 — taking the Dirty Talk test.
 *
 * Pass 1 walks the WHOLE bank and they mark only what lands (🔥 / ✗ / ~); pass 2 asks the hear/say split on
 * just what they marked. ~1,100 entries without ~1,000 taps. Then the AI phases chase what the bank left
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
    return () => reset();
  }, [load, reset, testId]);

  // Each AI phase starts itself once on entry — otherwise the person lands on an empty screen and has to ask
  // for the thing they just said yes to. Guarded per phase, so a degraded phase (which moves the take on)
  // can never loop back into itself.
  const started = useRef<Record<string, boolean>>({});
  const { phase: currentPhase, busy } = store;
  useEffect(() => {
    if (busy || started.current[currentPhase]) return;
    if (currentPhase === 'lines') {
      started.current['lines'] = true;
      void useAdaptiveTestStore.getState().loadLines(testId, 1);
    } else if (currentPhase === 'probe') {
      started.current['probe'] = true;
      void useAdaptiveTestStore.getState().nextProbe(testId);
    }
  }, [currentPhase, busy, testId]);

  const bank = store.bank;
  const marked = useMemo(() => Object.keys(store.marks), [store.marks]);

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
                <Banner tone="info">You have a take in progress — this picks it up.</Banner>
              ) : null}
              <div>
                <Button variant="primary" onClick={() => void store.start(testId)}>
                  {store.state.draft ? 'Pick up where you left off' : 'Begin'}
                </Button>
              </div>
              <CrisisFooter />
            </Stack>
          ) : null}

          {phase === 'bank' ? (
            <Stack gap={4}>
              <Heading level={2}>What lands?</Heading>
              <Text tone="secondary">
                Everything is here, tame to extreme. Only tap what actually does something for you —
                skip the rest. <strong>🔥</strong> if you love it, <strong>~</strong> if it makes
                you cringe, <strong>✗</strong> if it&rsquo;s a no. A <strong>✗</strong> is a
                boundary: nothing in SelfOS will suggest it again.
              </Text>
              <Text size="sm" tone="tertiary">
                {marked.length} marked
              </Text>
              {bank.families.map((family) => (
                <Card key={family.id} className={adaptive.family}>
                  <Heading level={3}>{family.label}</Heading>
                  {family.note ? (
                    <Text size="sm" tone="tertiary" className={styles.framing}>
                      {family.note}
                    </Text>
                  ) : null}
                  <ul className={adaptive.grid}>
                    {bank.entries
                      .filter((entry) => entry.family === family.id)
                      .map((entry) => {
                        const mark = store.marks[entry.key];
                        return (
                          <li key={entry.key} className={adaptive.row}>
                            <span className={adaptive.entryText}>{entry.text}</span>
                            <span className={adaptive.marks}>
                              {(['love', 'notYet', 'never'] as BankMark[]).map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  className={adaptive.markButton}
                                  aria-pressed={mark === option}
                                  aria-label={`${entry.text} — ${
                                    option === 'love'
                                      ? 'love it'
                                      : option === 'notYet'
                                        ? 'makes me cringe'
                                        : 'never'
                                  }`}
                                  onClick={() =>
                                    store.mark(entry.key, mark === option ? null : option)
                                  }
                                >
                                  {option === 'love' ? '🔥' : option === 'notYet' ? '~' : '✗'}
                                </button>
                              ))}
                            </span>
                          </li>
                        );
                      })}
                  </ul>
                </Card>
              ))}
              <div className={take.footer}>
                <Button
                  variant="primary"
                  disabled={store.busy}
                  onClick={() => void store.submitBank(testId)}
                >
                  Next — how you want them
                </Button>
              </div>
              <CrisisFooter />
            </Stack>
          ) : null}

          {phase === 'split' ? (
            <Stack gap={4}>
              <Heading level={2}>Hearing it, or saying it?</Heading>
              <Text tone="secondary">
                Only the ones you marked. What you love to <em>hear</em> and what you can get out of
                your own mouth are usually different — that gap is the most useful thing here.
              </Text>
              {marked.map((key) => {
                const entry = bank.entries.find((e) => e.key === key);
                if (!entry || store.marks[key] === 'never') return null;
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
                        {reaction === 'love' ? '🔥' : reaction === 'meh' ? '😐' : '🚫'}
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
                    <Button variant="ghost" onClick={() => void store.nextProbe(testId)}>
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
        </Stack>
      </div>
    </div>
  );
}

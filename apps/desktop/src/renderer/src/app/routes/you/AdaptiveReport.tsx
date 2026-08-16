import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import type { LexiconEntry } from '@shared/schemas';
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
  const loves = lexicon.entries.filter((e) => e.state === undefined && e.hear >= 3);
  const says = lexicon.entries.filter((e) => e.state === undefined && e.say >= 3);
  const notYet = lexicon.entries.filter((e) => e.state === 'notYet');
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
                <Lock size={11} aria-hidden="true" /> private — only you
              </span>
            </span>
            <Heading level={1}>{state.title}</Heading>
            <Text size="sm" tone="tertiary" className={styles.framing}>
              {state.framing}
            </Text>
          </header>

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
                {latest.scores.map((score) => (
                  <SubscaleBar
                    key={score.key}
                    label={SPINE_LABELS[score.key] ?? score.key}
                    normalized={score.normalized}
                    {...(score.band !== undefined ? { band: score.band } : {})}
                    signed={false}
                  />
                ))}
              </Stack>
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
                    <Button variant="secondary" onClick={() => navigate('/sessions')}>
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
          </div>

          <CrisisFooter />
        </Stack>
      </div>
    </div>
  );
}

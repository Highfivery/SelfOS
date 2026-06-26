import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { TEST_GROUP_LABELS, type TestGroupId, type TestSummary } from '@selfos/core/tests';
import type { TestResult } from '@shared/schemas';
import {
  Banner,
  Button,
  Card,
  Heading,
  Stack,
  SubscaleBar,
  Text,
} from '../../../design-system/components';
import { useTestStore } from '../../../stores/testStore';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { topSubscales } from './profile';
import styles from './You.module.css';

const GROUP_ORDER: TestGroupId[] = ['personality', 'relationships', 'intimacy'];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

/** A profile card for an instrument the person has taken: top dimensions + when, with Open / Retake. */
function ProfileCard({ test, results }: { test: TestSummary; results: TestResult[] }): JSX.Element {
  const navigate = useNavigate();
  const latest = results[0];
  const top = latest ? topSubscales(test, latest.scores, 2) : [];
  return (
    <Card className={styles.card}>
      <Stack gap={3}>
        <div>
          <span className={styles.eyebrow}>
            {test.instrument}
            {test.sensitive ? (
              <span className={styles.privateTag}>
                <Lock size={11} aria-hidden="true" /> private — only you
              </span>
            ) : null}
          </span>
          <Heading level={3}>{test.title}</Heading>
        </div>
        <Stack gap={2}>
          {top.map((s) => (
            <SubscaleBar
              key={s.key}
              label={s.label}
              normalized={s.normalized}
              band={s.band}
              signed={s.signed}
            />
          ))}
        </Stack>
        <Text size="sm" tone="secondary">
          Taken {results.length === 1 ? 'once' : `${results.length} times`} · last{' '}
          {formatDate(latest?.takenAt ?? '')}
        </Text>
        <div className={styles.cardActions}>
          <Button variant="secondary" onClick={() => navigate(`/you/${test.id}`)}>
            Open
          </Button>
          <Button variant="ghost" onClick={() => navigate(`/you/${test.id}/take`)}>
            Retake
          </Button>
        </div>
      </Stack>
    </Card>
  );
}

/** A catalog card for a test the person can take. */
function CatalogCard({ test }: { test: TestSummary }): JSX.Element {
  const navigate = useNavigate();
  return (
    <Card className={styles.card}>
      <Stack gap={3}>
        <div>
          <span className={styles.eyebrow}>{test.instrument}</span>
          <Heading level={3}>{test.title}</Heading>
        </div>
        <Text size="sm" tone="secondary" className={styles.blurb}>
          {test.blurb}
        </Text>
        <Text size="sm" tone="secondary">
          {test.itemCount} questions · about {test.estimatedMinutes} min
        </Text>
        <Text size="sm" tone="tertiary" className={styles.framing}>
          {test.framing}
        </Text>
        <div className={styles.cardActions}>
          <Button variant="primary" onClick={() => navigate(`/you/${test.id}/take`)}>
            Take
          </Button>
        </div>
      </Stack>
    </Card>
  );
}

/**
 * 50-self-assessments §3.1 — the "You" hub. The home of the tests you took (distinct from Memory, the AI's
 * inferred facts). Top: a non-diagnostic header + a link to Memory. Then "Your profiles" (per taken
 * instrument) and "Available tests" (a grouped catalog). The Intimacy & sexuality group is 18+-gated (§3.5).
 */
export function You(): JSX.Element {
  const navigate = useNavigate();
  const catalog = useTestStore((s) => s.catalog);
  const resultsByTest = useTestStore((s) => s.resultsByTest);
  const adultAcknowledged = useTestStore((s) => s.adultAcknowledged);
  const loaded = useTestStore((s) => s.loaded);
  const load = useTestStore((s) => s.load);
  const acknowledgeAdult = useTestStore((s) => s.acknowledgeAdult);
  const [acking, setAcking] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const taken = catalog.filter((t) => (resultsByTest[t.id]?.length ?? 0) > 0);
  const anyResults = taken.length > 0;

  const ack = async (): Promise<void> => {
    setAcking(true);
    try {
      await acknowledgeAdult();
    } finally {
      setAcking(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Stack gap={5}>
          <header className={styles.header}>
            <Heading level={1}>You — how you see yourself</Heading>
            <Text tone="secondary">
              These are reflections, not verdicts. What SelfOS has <em>learned</em> about you lives
              in{' '}
              <button
                type="button"
                className={styles.memoryLink}
                onClick={() => navigate('/memory')}
              >
                Memory
              </button>
              .
            </Text>
          </header>

          {loaded && !anyResults ? (
            <Banner tone="info">
              Take a test to see how SelfOS understands you — and to make your coach, dreams, and
              questionnaires fit you better.
            </Banner>
          ) : null}

          {anyResults ? (
            <section>
              <Heading level={2}>Your profiles</Heading>
              <div className={styles.grid}>
                {taken.map((test) => (
                  <ProfileCard key={test.id} test={test} results={resultsByTest[test.id] ?? []} />
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <Heading level={2}>Available tests</Heading>
            <Stack gap={4}>
              {GROUP_ORDER.map((group) => {
                const tests = catalog.filter((t) => t.group === group);
                const isIntimacyGated = group === 'intimacy' && !adultAcknowledged;
                if (tests.length === 0 && !isIntimacyGated) return null;
                return (
                  <div key={group}>
                    <Heading level={3} className={styles.groupTitle}>
                      {TEST_GROUP_LABELS[group]}
                    </Heading>
                    {isIntimacyGated ? (
                      <Card className={styles.gatedCard}>
                        <Stack gap={3}>
                          <Text>
                            <Lock size={14} aria-hidden="true" /> These are 18+. Acknowledge to view
                            the kink-interests inventory and the sexuality & orientation spectrum.
                          </Text>
                          <div className={styles.cardActions}>
                            <Button variant="primary" onClick={() => void ack()} disabled={acking}>
                              I’m 18 or older — show me
                            </Button>
                          </div>
                        </Stack>
                      </Card>
                    ) : (
                      <div className={styles.grid}>
                        {tests.map((test) => (
                          <CatalogCard key={test.id} test={test} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </Stack>
          </section>

          <CrisisFooter />
        </Stack>
      </div>
    </div>
  );
}

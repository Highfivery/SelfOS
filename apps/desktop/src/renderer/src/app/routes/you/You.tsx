import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import type { TestGroupId, TestSummary } from '@selfos/core/tests';
import { Button, Heading, Select, Text } from '../../../design-system/components';
import { useTestStore } from '../../../stores/testStore';
import { NextUpSlot } from './NextUpSlot';
import { TestCard } from './TestCard';
import {
  FILTER_GROUP_LABELS,
  type HubFilter,
  filterCount,
  filterTests,
  hubStats,
  nextUpFor,
  takesOf,
} from './testsHub';
import styles from './You.module.css';

const GROUP_ORDER: TestGroupId[] = ['personality', 'relationships', 'intimacy', 'wellbeing'];

/** The catalog filter. Status and area live in ONE control — a single "show me…" concept, not two rows. */
const STATUS_FILTERS: { id: HubFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'untaken', label: 'Not tried' },
  { id: 'quick', label: 'Under 5 min' },
];

/**
 * 50-self-assessments §3.1 — the Tests hub. A rotating "next for you" slot over ONE catalog grid where every
 * instrument keeps its place and carries its own state, so taking something enriches a card rather than
 * moving it to another section.
 *
 * The counts are counts, never a proportion: the catalog grows as instruments are added, so a ratio would be
 * a lie by the next release, and an adaptive take (74) never finishes at all.
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
  const [filter, setFilter] = useState<HubFilter>('all');

  useEffect(() => {
    void load();
  }, [load]);

  // One clock reading per render, matching AppShell's badge exactly. A memoized `now` frozen on the last
  // load would drift past a re-check boundary while the badge (computed fresh) moved — the two disagreeing
  // is precisely what deriving both from this module is meant to prevent.
  const now = Date.now();
  const stats = hubStats(catalog, resultsByTest, now);
  const next = nextUpFor(catalog, resultsByTest, now, 2);
  const shown = filterTests(catalog, resultsByTest, now, filter);

  const filters: { id: HubFilter; label: string; count: number }[] = [
    ...STATUS_FILTERS,
    ...GROUP_ORDER.filter((group) => catalog.some((t) => t.group === group)).map((group) => ({
      id: group as HubFilter,
      label: FILTER_GROUP_LABELS[group],
    })),
  ].map((f) => ({ ...f, count: filterCount(catalog, resultsByTest, now, f.id) }));

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
        <header className={styles.header}>
          <div className={styles.headerMain}>
            <Heading level={1}>Tests</Heading>
            <Text tone="secondary" size="sm">
              How you see yourself — reflections, never verdicts. What SelfOS has <em>learned</em>{' '}
              about you lives in{' '}
              <button
                type="button"
                className={styles.memoryLink}
                onClick={() => navigate('/memory')}
              >
                Memory
              </button>
              .
            </Text>
          </div>
          {loaded && catalog.length > 0 ? (
            <div className={styles.stats} role="group" aria-label="Your tests at a glance">
              {stats.taken > 0 ? (
                <div className={styles.stat}>
                  <b>{stats.taken}</b>
                  <span>Taken</span>
                </div>
              ) : null}
              {stats.notTried > 0 ? (
                <div className={styles.stat}>
                  <b>{stats.notTried}</b>
                  <span>Not tried</span>
                </div>
              ) : null}
              {stats.due > 0 ? (
                <div className={`${styles.stat} ${styles.statDue}`}>
                  <b>{stats.due}</b>
                  <span>Due</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </header>

        {next.length > 0 ? (
          <div className={styles.leadGrid}>
            {next.map((pick) => (
              <NextUpSlot key={pick.test.id} next={pick} now={now} />
            ))}
          </div>
        ) : null}

        {loaded && catalog.length > 0 ? (
          <section aria-label="Everything you can take">
            <div className={styles.gridHead}>
              <Heading level={2} className={styles.gridTitle}>
                Everything you can take
              </Heading>
              <Text size="sm" tone="tertiary">
                {catalog.length} instruments
              </Text>
            </div>

            {/* Desktop: chips with counts. Below --bp-md they can't fit, and wrapping a control cluster
                isn't a design (§12), so the same filter becomes ONE full-width Select. */}
            <div className={styles.filters} role="group" aria-label="Filter tests">
              {filters.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`${styles.chip} ${filter === f.id ? styles.chipOn : ''}`}
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                  <span className={styles.chipCount}>{f.count}</span>
                </button>
              ))}
            </div>
            <div className={styles.filterSelect}>
              <Select
                aria-label="Show"
                value={filter}
                onChange={(e) => setFilter(e.target.value as HubFilter)}
              >
                {filters.map((f) => (
                  <option key={f.id} value={f.id}>
                    {`Show: ${f.label} (${f.count})`}
                  </option>
                ))}
              </Select>
            </div>

            {shown.length > 0 ? (
              <div className={styles.grid} role="list">
                {shown.map((test: TestSummary) => (
                  <TestCard
                    key={test.id}
                    test={test}
                    results={takesOf(resultsByTest, test)}
                    now={now}
                  />
                ))}
              </div>
            ) : (
              <Text size="sm" tone="secondary">
                Nothing matches that filter.
              </Text>
            )}
          </section>
        ) : null}

        {/* The 18+ gate is a property of the PAGE, not a card pretending to be an instrument. The gated
            instruments are withheld in the bridge (§3.5), so nothing about them is reachable until this. */}
        {loaded && !adultAcknowledged ? (
          <section className={styles.gate} aria-label="Adult instruments">
            <Lock size={20} aria-hidden="true" className={styles.gateIcon} />
            <div className={styles.gateText}>
              <strong>More, for adults</strong>
              <Text size="sm" tone="secondary">
                Sexuality &amp; orientation, kink &amp; intimacy interests, and dirty talk.
              </Text>
            </div>
            <Button variant="primary" onClick={() => void ack()} disabled={acking}>
              I’m 18 or older
            </Button>
          </section>
        ) : null}

        {/* Said once, properly. The per-instrument framing stays on the intro and result screens, where
            51 §8.1 requires it — ten repeated disclaimers in a catalog only train people to skip them. */}
        {loaded && catalog.length > 0 ? (
          <p className={styles.reflectionLine}>
            Every one of these is a reflection of how you answered on a given day — not a verdict, a
            score, or a diagnosis. The check-ins are not medical screening.
          </p>
        ) : null}
      </div>
    </div>
  );
}

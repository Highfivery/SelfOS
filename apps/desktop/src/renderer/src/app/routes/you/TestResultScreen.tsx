import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { TestNarrateResponse } from '@selfos/core/tests';
import {
  AdminOnlyBadge,
  Banner,
  Button,
  Card,
  Heading,
  Markdown,
  Stack,
  SubscaleBar,
  Text,
  TrendLine,
} from '../../../design-system/components';
import { useTestStore } from '../../../stores/testStore';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { subscaleViews } from './profile';
import styles from './You.module.css';
import result from './TestResult.module.css';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

/**
 * 50-self-assessments §3.3 — the result profile screen (`/you/:testId`). A non-diagnostic preamble, the
 * subscale bars, optional retake trends (per-subscale `TrendLine`), an OPTIONAL user-triggered AI narrative
 * (metered; the deterministic profile always renders without it), a history of prior dated results, and
 * Manage (Retake / Delete). The crisis footer + not-medical line are present throughout (§8).
 */
export function TestResultScreen(): JSX.Element {
  const { testId = '' } = useParams();
  const navigate = useNavigate();

  const test = useTestStore((s) => s.catalog.find((t) => t.id === testId));
  const results = useTestStore((s) => s.resultsByTest[testId]);
  const loaded = useTestStore((s) => s.loaded);
  const loadResults = useTestStore((s) => s.loadResults);
  const narrate = useTestStore((s) => s.narrate);
  const deleteResult = useTestStore((s) => s.deleteResult);
  const deleteAll = useTestStore((s) => s.deleteAll);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [narrative, setNarrative] = useState<TestNarrateResponse | null>(null);
  const [narrating, setNarrating] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  useEffect(() => {
    if (!results) void loadResults(testId);
  }, [testId, results, loadResults]);

  const all = useMemo(() => results ?? [], [results]);
  const selected = all.find((r) => r.id === selectedId) ?? all[0] ?? null;

  // Trends: each subscale's normalized over takes (oldest → newest), bounded to its scale.
  const trends = useMemo(() => {
    if (!test || all.length < 2) return [];
    const ordered = [...all].reverse(); // oldest first for the x-axis
    return test.subscales.map((meta) => ({
      ...meta,
      points: ordered
        .map((r) => {
          const score = r.scores.find((s) => s.key === meta.key);
          return score ? { date: r.takenAt, value: score.normalized } : null;
        })
        .filter((p): p is { date: string; value: number } => p !== null),
    }));
  }, [test, all]);

  const onNarrate = async (): Promise<void> => {
    if (!selected) return;
    setNarrating(true);
    setNarrative(await narrate(testId, selected.id));
    setNarrating(false);
  };

  if (loaded && test && all.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <Stack gap={4}>
            <button type="button" className={result.back} onClick={() => navigate('/you')}>
              ← You
            </button>
            <Heading level={1}>{test.title}</Heading>
            <Banner tone="info">You haven’t taken this yet.</Banner>
            <div>
              <Button variant="primary" onClick={() => navigate(`/you/${testId}/take`)}>
                Take it
              </Button>
            </div>
            <CrisisFooter />
          </Stack>
        </div>
      </div>
    );
  }

  if (!test || !selected) {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <Text tone="secondary">Loading…</Text>
        </div>
      </div>
    );
  }

  const views = subscaleViews(test, selected.scores);

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Stack gap={5}>
          <button type="button" className={result.back} onClick={() => navigate('/you')}>
            ← You
          </button>

          <header>
            <span className={styles.eyebrow}>{test.instrument}</span>
            <Heading level={1}>{test.title}</Heading>
            <Text tone="secondary">
              A snapshot of how you answered on {formatDate(selected.takenAt)} — not a label or a
              diagnosis.
            </Text>
          </header>

          {selected.crisisFlag ? (
            <Banner tone="warning">
              Some of what you shared sounds heavy. If you’re struggling, please reach out — you’re
              not alone. See the resources below.
            </Banner>
          ) : null}

          <section>
            <Heading level={2}>Your results</Heading>
            <Stack gap={3}>
              {views.map((v) => (
                <SubscaleBar
                  key={v.key}
                  label={v.label}
                  normalized={v.normalized}
                  band={v.band}
                  signed={v.signed}
                />
              ))}
            </Stack>
          </section>

          {trends.length > 0 && all.length >= 2 ? (
            <details className={result.trends}>
              <summary>How this has shifted ({all.length} takes)</summary>
              <Stack gap={3}>
                {trends.map((t) => (
                  <div key={t.key} className={result.trendRow}>
                    <Text size="sm">{t.label}</Text>
                    <TrendLine
                      points={t.points}
                      min={t.signed ? -1 : 0}
                      max={1}
                      aria-label={`${t.label} over ${t.points.length} takes`}
                    />
                  </div>
                ))}
              </Stack>
            </details>
          ) : null}

          <section>
            <Heading level={2}>What this means for you</Heading>
            {narrative?.ok ? (
              <Card className={result.narrative}>
                <div role="status">
                  <Markdown>{narrative.text}</Markdown>
                </div>
                {narrative.costUsd !== undefined ? (
                  <Text size="xs" tone="tertiary">
                    <AdminOnlyBadge /> ${narrative.costUsd.toFixed(3)}
                  </Text>
                ) : null}
              </Card>
            ) : (
              <Stack gap={2}>
                <Text tone="secondary" size="sm">
                  An optional, warm reflection on your scores. The profile above is yours regardless
                  — this just adds a few words.
                </Text>
                {narrative && !narrative.ok ? (
                  <Banner tone={narrative.reason === 'ERROR' ? 'warning' : 'info'}>
                    {narrative.message}
                  </Banner>
                ) : null}
                <div>
                  <Button variant="secondary" onClick={() => void onNarrate()} disabled={narrating}>
                    {narrating ? 'Reflecting…' : 'Reflect on my result'}
                  </Button>
                </div>
              </Stack>
            )}
          </section>

          {all.length > 1 ? (
            <section>
              <Heading level={2}>History</Heading>
              <Stack gap={1}>
                {all.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`${result.historyRow} ${r.id === selected.id ? result.historyOn : ''}`}
                    onClick={() => setSelectedId(r.id)}
                  >
                    {formatDate(r.takenAt)}
                    {r.id === selected.id ? ' · showing' : ''}
                  </button>
                ))}
              </Stack>
            </section>
          ) : null}

          <section className={result.manage}>
            <Button variant="primary" onClick={() => navigate(`/you/${testId}/take`)}>
              Retake
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                void deleteResult(testId, selected.id);
                setSelectedId(null);
                setNarrative(null);
              }}
            >
              Delete this result
            </Button>
            {confirmDeleteAll ? (
              <Button
                variant="danger"
                onClick={() => {
                  void deleteAll(testId);
                  navigate('/you');
                }}
              >
                Confirm — delete all
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmDeleteAll(true)}>
                Delete all results
              </Button>
            )}
          </section>

          <CrisisFooter />
        </Stack>
      </div>
    </div>
  );
}

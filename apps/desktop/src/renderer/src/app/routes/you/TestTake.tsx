import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { unansweredRequired, type AnswerMap } from '@selfos/core/questionnaires';
import type { TestForm } from '@selfos/core/tests';
import { QuestionnaireForm } from '@selfos/answering';
import { Banner, Button, Heading, Stack, Text } from '../../../design-system/components';
import { useTestStore } from '../../../stores/testStore';
import { CrisisFooter } from '../sessions/CrisisFooter';
import styles from './You.module.css';
import take from './TestTake.module.css';

/**
 * 50-self-assessments §3.2 — taking / retaking a test. Intro (non-diagnostic framing + length + a retake
 * note), then the items via the shared `@selfos/answering` renderer (branching + required live), then Score
 * (deterministic, free). A required Likert item is NOT auto-seeded — it stays unanswered until moved. The
 * whole battery renders to the bottom (no default-collapsed group) and Score gates on `unansweredRequired`.
 */
export function TestTake(): JSX.Element {
  const { testId = '' } = useParams();
  const navigate = useNavigate();
  const take_ = useTestStore((s) => s.take);
  const priorCount = useTestStore((s) => s.resultsByTest[testId]?.length ?? 0);

  const [form, setForm] = useState<TestForm | null>(null);
  const [missing, setMissing] = useState(false);
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const result = (await window.selfos?.testsGet({ testId })) ?? null;
      if (!live) return;
      if (!result) setLoadError(true);
      else setForm(result);
    })();
    return () => {
      live = false;
    };
  }, [testId]);

  const remaining = useMemo(
    () => (form ? unansweredRequired(form.items, answers).length : 0),
    [form, answers],
  );

  const onScore = async (): Promise<void> => {
    if (!form) return;
    if (remaining > 0) {
      setMissing(true);
      return;
    }
    setBusy(true);
    const result = await take_(testId, answers as Record<string, unknown>);
    setBusy(false);
    if (result) navigate(`/you/${testId}`);
  };

  if (loadError) {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <Stack gap={4}>
            <Banner tone="warning">That assessment isn’t available.</Banner>
            <Button variant="secondary" onClick={() => navigate('/you')}>
              ← Back to You
            </Button>
          </Stack>
        </div>
      </div>
    );
  }

  if (!form) {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <Text tone="secondary">Loading…</Text>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Stack gap={4}>
          <button type="button" className={take.back} onClick={() => navigate('/you')}>
            ← You
          </button>

          {!started ? (
            <Stack gap={4}>
              <div>
                <span className={styles.eyebrow}>{form.instrument}</span>
                <Heading level={1}>{form.title}</Heading>
              </div>
              <Text tone="secondary">{form.blurb}</Text>
              <Text size="sm" tone="tertiary" className={styles.framing}>
                {form.framing}
              </Text>
              <Text size="sm" tone="secondary">
                {form.itemCount} questions · about {form.estimatedMinutes} min
              </Text>
              {priorCount > 0 ? (
                <Banner tone="info">
                  This creates a new dated result and adds a point to your trend — your previous
                  results are kept.
                </Banner>
              ) : null}
              <div>
                <Button variant="primary" onClick={() => setStarted(true)}>
                  Begin
                </Button>
              </div>
              <CrisisFooter />
            </Stack>
          ) : (
            <Stack gap={4}>
              <Heading level={2}>{form.title}</Heading>
              <QuestionnaireForm
                questions={form.items}
                answers={answers}
                onChange={(id, value) => {
                  setMissing(false);
                  setAnswers((prev) => ({ ...prev, [id]: value }));
                }}
                footer={<CrisisFooter />}
              />
              {missing ? (
                <Banner tone="warning">
                  Answer the {remaining} remaining question{remaining === 1 ? '' : 's'} to see your
                  result.
                </Banner>
              ) : null}
              <div className={take.footer}>
                <Button variant="primary" onClick={() => void onScore()} disabled={busy}>
                  See my result
                </Button>
              </div>
            </Stack>
          )}
        </Stack>
      </div>
    </div>
  );
}

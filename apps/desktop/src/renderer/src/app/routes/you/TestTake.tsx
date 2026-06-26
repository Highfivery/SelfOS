import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { unansweredRequired, type AnswerMap } from '@selfos/core/questionnaires';
import { crisisItemPositive, type TestForm } from '@selfos/core/tests';
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

  // 51 §3.2 step 3 — the mid-check-in crisis interception. The moment a crisis item (PHQ-9 item 9) is answered
  // positive, this turns true and a prominent, resources-first banner appears immediately — before the check-in
  // is even finished. Pure + client-evaluable from the definition's crisisItems (no IPC round-trip); the bridge
  // still authoritatively sets the result's crisisFlag at score time.
  const crisisActive = useMemo(
    () =>
      form?.wellbeing
        ? crisisItemPositive(form.crisisItems, answers as Record<string, never>)
        : false,
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
              {/* 51 §3.2 step 1 — for a wellbeing reflection the not-medical framing comes FIRST + prominent. */}
              {form.wellbeing ? (
                <Banner tone="info">
                  This is a reflection to help you notice how you’ve been — <strong>not</strong> a
                  diagnosis, a screening, or medical advice. You can stop anytime.
                </Banner>
              ) : null}
              <Text tone="secondary">{form.blurb}</Text>
              {!form.wellbeing ? (
                <Text size="sm" tone="tertiary" className={styles.framing}>
                  {form.framing}
                </Text>
              ) : null}
              <Text size="sm" tone="secondary">
                {form.itemCount} questions · about {form.estimatedMinutes} min
              </Text>
              {form.attribution ? (
                <Text size="xs" tone="tertiary">
                  {form.attribution}
                </Text>
              ) : null}
              {priorCount > 0 ? (
                <Banner tone="info">
                  This creates a new dated {form.wellbeing ? 'check-in' : 'result'} and adds a point
                  to your trend — your previous {form.wellbeing ? 'check-ins are' : 'results are'}{' '}
                  kept.
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
              {/* 51 §3.2 step 3 / §8.2 — escalate to a prominent, warm, resources-first banner the instant a
                  crisis item is answered positive, before the check-in is even finished. */}
              {crisisActive ? (
                <Banner tone="warning" role="alert">
                  It sounds like you’ve been having a really hard time — please reach out to someone
                  who can help right now. You don’t have to go through this alone; the resources
                  below are there for you.
                </Banner>
              ) : null}
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
                  {form.wellbeing ? ' check-in' : ' result'}.
                </Banner>
              ) : null}
              <div className={take.footer}>
                <Button variant="primary" onClick={() => void onScore()} disabled={busy}>
                  {form.wellbeing ? 'See my check-in' : 'See my result'}
                </Button>
                {form.wellbeing ? (
                  <Button variant="ghost" onClick={() => navigate('/you')}>
                    Stop check-in
                  </Button>
                ) : null}
              </div>
            </Stack>
          )}
        </Stack>
      </div>
    </div>
  );
}

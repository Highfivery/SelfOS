import { useNavigate } from 'react-router-dom';
import { ArrowRight, ClipboardList, RefreshCw, Sparkles } from 'lucide-react';
import { portraitStaleness } from '@selfos/core/intake';
import type { AnswerMap } from '@selfos/core/questionnaires';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { useSessionStore } from '../../../stores/sessionStore';
import { useIntakeStore } from '../../../stores/intakeStore';
import {
  attentionFromIntakeState,
  intakeQuestionTotals,
  overallProgress,
} from '../onboarding/progress';
import { relativeTime } from '../../notifications/relativeTime';
import styles from './Home.module.css';

/** A bare "2d ago" / "just now" for a timestamp; '' when missing or unparseable. */
function relativeAgo(iso: string | undefined): string {
  if (!iso) return '';
  const rel = relativeTime(iso);
  if (!rel) return '';
  return rel === 'just now' ? 'just now' : `${rel} ago`;
}

/**
 * The persistent onboarding nudge (18-personal-onboarding §3.1/§15, 17 §13). While the intake is in progress
 * it shows scannable progress (questions answered, sections done, last updated) and a Continue action. Once
 * complete it becomes a calm portrait-health summary that nudges a refresh ONLY when the portrait has gone
 * stale (answers added/edited/cleared since it was generated). Self-hides for someone without `intake.own`,
 * or once complete AND the portrait is up to date.
 *
 * Pending profile-update suggestions (§15) are surfaced as the "refresh your portrait" recommendation in the
 * "For you" zone (53 §3.6), so this card deliberately does NOT re-surface them — and "due for a review" is
 * staleness, never a calendar clock (no nagging, matches 29).
 */
export function OnboardingCard(): JSX.Element | null {
  const navigate = useNavigate();
  const canDoIntake = useSessionStore((s) => s.can('intake.own'));
  const state = useIntakeStore((s) => s.state);
  const loaded = useIntakeStore((s) => s.loaded);

  if (!canDoIntake || !loaded || !state) return null;

  const { session, sections } = state;
  const sectionById = new Map(session.sections.map((s) => [s.id, s]));

  // --- Complete: surface new/unanswered onboarding questions, else nudge a portrait refresh, else self-hide. ---
  if (session.status === 'complete') {
    // 55 §3.1 — new questions in finished sections, new sections from updates, and skipped/blank ones. This
    // takes precedence over the staleness nudge: filling in a real gap is more actionable than a refresh.
    const attention = attentionFromIntakeState(state);
    if (attention.total > 0) {
      const areas = attention.areas.length;
      return (
        <Card>
          <Stack gap={3}>
            <Heading level={2}>
              <ClipboardList size={18} aria-hidden="true" /> A few more things to tell SelfOS
            </Heading>
            <Text tone="secondary">
              {areas === 1 ? 'One area of your profile has' : `${areas} areas of your profile have`}{' '}
              new or unanswered questions — including anything added in recent updates. Filling them
              in helps your coaching fit you.
            </Text>
            <div>
              <Button variant="primary" onClick={() => navigate('/onboarding')}>
                Continue onboarding
                <ArrowRight size={16} aria-hidden="true" />
              </Button>
            </div>
          </Stack>
        </Card>
      );
    }

    const stale = portraitStaleness(session);
    if (!stale.stale) return null;

    const updated = relativeAgo(session.completedAt ?? session.updatedAt);
    return (
      <Card>
        <Stack gap={3}>
          <Heading level={2}>
            <RefreshCw size={18} aria-hidden="true" /> Time for a quick profile review
          </Heading>
          <Text tone="secondary">
            You’ve added or changed about {stale.pct}% of your answers since your last portrait — a
            quick refresh keeps your coaching current.
          </Text>
          <dl className={styles.onboardStats}>
            <div className={styles.onboardStat}>
              <dt>Changed since portrait</dt>
              <dd>{stale.pct}%</dd>
            </div>
            {updated ? (
              <div className={styles.onboardStat}>
                <dt>Portrait updated</dt>
                <dd>{updated}</dd>
              </div>
            ) : null}
          </dl>
          <div>
            <Button variant="primary" onClick={() => navigate('/onboarding')}>
              Refresh my portrait
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </div>
        </Stack>
      </Card>
    );
  }

  // --- In progress: scannable progress + a Continue action. ---
  const started = session.sections.some((s) => s.status !== 'notStarted');
  const questions = intakeQuestionTotals(sections, (id) => {
    const s = sectionById.get(id);
    return s ? { status: s.status, answers: s.answers as AnswerMap } : undefined;
  });
  const bySection = overallProgress(sections, (id) => sectionById.get(id)?.status);
  const sectionsDone = bySection.completed + bySection.skipped; // a skipped section is intentionally resolved
  const updated = relativeAgo(session.updatedAt);

  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2}>
          <Sparkles size={18} aria-hidden="true" />{' '}
          {started ? 'Finish getting to know SelfOS' : 'Tell SelfOS about yourself'}
        </Heading>
        <Text tone="secondary">
          {started
            ? 'Pick up your getting-to-know-you conversation where you left off — it helps SelfOS support you better.'
            : 'A warm, private conversation so SelfOS can understand you and support you better. Skip anything; stop anytime.'}
        </Text>
        {started ? (
          <dl className={styles.onboardStats}>
            {questions.total > 0 ? (
              <div className={styles.onboardStat}>
                <dt>Questions</dt>
                <dd>
                  {questions.answered} of {questions.total} answered
                </dd>
              </div>
            ) : null}
            <div className={styles.onboardStat}>
              <dt>Sections</dt>
              <dd>
                {sectionsDone} of {bySection.total} done
              </dd>
            </div>
            {updated ? (
              <div className={styles.onboardStat}>
                <dt>Last updated</dt>
                <dd>{updated}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <div>
          <Button variant="primary" onClick={() => navigate('/onboarding')}>
            {started ? 'Continue onboarding' : 'Start onboarding'}
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
        </div>
      </Stack>
    </Card>
  );
}

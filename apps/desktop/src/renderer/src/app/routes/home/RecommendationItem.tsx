import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Lightbulb, RefreshCw, Sparkles } from 'lucide-react';
import type { Recommendation } from '@selfos/core/recommendations';
import { getExercise } from '@selfos/core/conversations';
import type { ProfileUpdateSuggestion } from '@shared/channels';
import type { QuestionnaireSuggestion } from '@shared/schemas';
import { Button, Inline, Markdown, Text } from '../../../design-system/components';
import { useGoalStore } from '../../../stores/goalStore';
import { useSynthesisStore } from '../../../stores/synthesisStore';
import { useGuidanceStore } from '../../../stores/guidanceStore';
import { useConversationStore } from '../../../stores/conversationStore';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { useDiscoveryStore, DISCOVERY_KEYS } from '../../../stores/discoveryStore';
import { stalestGoal } from '../../notifications/goalFollowup';
import { AiUnavailableNotice } from '../../AiUnavailableNotice';
import { GuidedExerciseCard } from '../sessions/GuidedExerciseCard';
import { toSeed } from '../questionnaires/SuggestedPanel';
import { RecommendationCard } from './RecommendationCard';
import styles from './Home.module.css';

/** The CTA label for the navigate-only recommendations (a single primary action → its route). */
const LINK_CTA: Record<string, string> = {
  'continue-session': 'Open Sessions',
  'refresh-portrait': 'Refresh my portrait',
  'refresh-memory': 'Review memory',
};

/**
 * One ranked "For you" card, with its absorbed action preserved (53 §5.4) — the engine changes WHERE/HOW a
 * recommendation is surfaced + ranked, never WHAT it does. A goal keeps Still on it / Mark done / Let it go
 * (`goals:setStatus`); the synthesis observation keeps its cached display + explicit-tap run + "Talk it
 * through" seed; the rest are a calm reason + one primary action that routes to where the work happens. All
 * store hooks run unconditionally at the top (the rules-of-hooks); the action body is chosen by `rec.id`.
 */
export function RecommendationItem({
  rec,
  configured,
  depthSuggestion,
  onDismiss,
}: {
  rec: Recommendation;
  configured: boolean;
  depthSuggestion: ProfileUpdateSuggestion | null;
  onDismiss: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const goals = useGoalStore((s) => s.goals);
  const setGoalStatus = useGoalStore((s) => s.setStatus);
  const synthesis = useSynthesisStore((s) => s.synthesis);
  const synthRunning = useSynthesisStore((s) => s.running);
  const synthError = useSynthesisStore((s) => s.error);
  const runSynthesis = useSynthesisStore((s) => s.run);
  const guidedSuggestions = useGuidanceStore((s) => s.suggestions);
  const generating = useGuidanceStore((s) => s.generating);
  const generateGuided = useGuidanceStore((s) => s.generate);
  const startGuided = useConversationStore((s) => s.startGuided);
  const suggestQuestionnaires = useQuestionnaireStore((s) => s.suggest);
  const dismissTip = useDiscoveryStore((s) => s.dismiss);

  const [qBusy, setQBusy] = useState(false);
  const [qSuggestion, setQSuggestion] = useState<QuestionnaireSuggestion | null>(null);
  const [qNotice, setQNotice] = useState<string | null>(null);

  const card = (body: JSX.Element): JSX.Element => (
    <RecommendationCard
      domain={rec.domain}
      label={rec.label}
      reason={rec.reason}
      onDismiss={onDismiss}
    >
      {body}
    </RecommendationCard>
  );

  // --- A quiet goal worth a check-in: Still on it / Mark done / Let it go (40 §3.2). ---
  if (rec.id === 'stale-goal') {
    const goal = stalestGoal(goals, new Date());
    return card(
      <Inline gap={2} wrap>
        <Button
          variant="secondary"
          onClick={() => goal && void setGoalStatus(goal.id, 'inProgress')}
        >
          Still on it
        </Button>
        <Button variant="secondary" onClick={() => goal && void setGoalStatus(goal.id, 'done')}>
          Mark done
        </Button>
        <Button variant="ghost" onClick={() => goal && void setGoalStatus(goal.id, 'abandoned')}>
          Let it go
        </Button>
      </Inline>,
    );
  }

  // --- The one AI voice: a cached observation + run + "Talk it through" seed (40 §3.3/§3.8). ---
  if (rec.id === 'synthesis-observation') {
    return card(
      <>
        {synthesis ? <Markdown>{synthesis.observation}</Markdown> : null}
        {synthError ? (
          <Text size="sm" tone="secondary">
            {synthError}
          </Text>
        ) : null}
        {configured ? (
          <Inline gap={2} wrap>
            <Button variant="secondary" disabled={synthRunning} onClick={() => void runSynthesis()}>
              {synthRunning
                ? 'Looking…'
                : synthesis
                  ? 'Look again'
                  : 'What are you noticing lately?'}
            </Button>
            {synthesis ? (
              <Button
                variant="ghost"
                onClick={() =>
                  navigate('/sessions', { state: { seedText: synthesis.observation } })
                }
              >
                Talk it through <ArrowRight size={14} aria-hidden="true" />
              </Button>
            ) : null}
          </Inline>
        ) : synthesis ? null : (
          <AiUnavailableNotice variant="inline" />
        )}
      </>,
    );
  }

  // --- A guided session: cached picks + explicit-tap (re)generate, else browse the launcher (16). ---
  if (rec.id === 'guided-suggestion') {
    const guided = (guidedSuggestions?.items ?? [])
      .map((s) => ({ exercise: getExercise(s.guideId), reason: s.reason }))
      .filter((x): x is { exercise: NonNullable<typeof x.exercise>; reason: string } =>
        Boolean(x.exercise),
      )
      .slice(0, 2);

    const onPick = async (guideId: string): Promise<void> => {
      const id = await startGuided(guideId);
      if (id) navigate('/sessions');
    };

    return card(
      guided.length > 0 ? (
        <>
          <div className={styles.suggestGrid}>
            {guided.map(({ exercise, reason }) => (
              <GuidedExerciseCard
                key={exercise.id}
                exercise={exercise}
                reason={reason}
                onPick={() => void onPick(exercise.id)}
              />
            ))}
          </div>
          {configured ? (
            <div>
              <Button variant="ghost" disabled={generating} onClick={() => void generateGuided()}>
                <RefreshCw size={14} aria-hidden="true" /> {generating ? 'Finding…' : 'Refresh'}
              </Button>
            </div>
          ) : null}
        </>
      ) : configured ? (
        <div>
          <Button variant="secondary" disabled={generating} onClick={() => void generateGuided()}>
            <Sparkles size={14} aria-hidden="true" />{' '}
            {generating ? 'Finding…' : 'Get personalized suggestions'}
          </Button>
        </div>
      ) : (
        <div>
          <Button variant="secondary" onClick={() => navigate('/sessions')}>
            Browse guided sessions <ArrowRight size={16} aria-hidden="true" />
          </Button>
        </div>
      ),
    );
  }

  // --- A questionnaire worth sending: explicit-tap gap-finder, then "Create from this" (08). ---
  if (rec.id === 'questionnaire-gap') {
    const onSuggest = async (): Promise<void> => {
      setQBusy(true);
      setQNotice(null);
      try {
        const result = await suggestQuestionnaires({});
        if (result.ok && result.suggestions && result.suggestions.length > 0) {
          setQSuggestion(result.suggestions[0] ?? null);
        } else {
          setQSuggestion(null);
          setQNotice(result.message ?? 'No questionnaire suggestions right now.');
        }
      } finally {
        setQBusy(false);
      }
    };

    return card(
      <>
        {qSuggestion ? (
          <div className={styles.suggestQuestionnaire}>
            <Text weight={600}>{qSuggestion.title}</Text>
            {qSuggestion.rationale ? (
              <Text size="sm" tone="secondary">
                {qSuggestion.rationale}
              </Text>
            ) : null}
            <div>
              <Button
                variant="secondary"
                onClick={() =>
                  navigate('/questionnaires', { state: { seed: toSeed(qSuggestion) } })
                }
              >
                Create from this
              </Button>
            </div>
          </div>
        ) : qNotice ? (
          <Text size="sm" tone="secondary">
            {qNotice}
          </Text>
        ) : null}
        {configured ? (
          <div>
            <Button variant="secondary" disabled={qBusy} onClick={() => void onSuggest()}>
              <Lightbulb size={14} aria-hidden="true" />{' '}
              {qBusy ? 'Thinking…' : qSuggestion ? 'Suggest again' : 'Suggest a questionnaire'}
            </Button>
          </div>
        ) : (
          <AiUnavailableNotice variant="inline" />
        )}
      </>,
    );
  }

  // --- Go a little deeper: open the invited intake section (29 §3.2). ---
  if (rec.id === 'depth-invitation') {
    const goDeeper = async (): Promise<void> => {
      dismissTip(DISCOVERY_KEYS.tipDepthInvitations); // acting on it suppresses the explainer tip
      if (depthSuggestion) {
        await window.selfos?.profileAcceptSuggestion(depthSuggestion.id);
        if (depthSuggestion.sectionId) {
          navigate('/onboarding', { state: { openSection: depthSuggestion.sectionId } });
          return;
        }
      }
      navigate('/onboarding');
    };
    return card(
      <div>
        <Button variant="secondary" onClick={() => void goDeeper()}>
          Go deeper <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>,
    );
  }

  // --- Default: a single primary action that routes to where the work happens. ---
  return card(
    <div>
      <Button variant="secondary" onClick={() => navigate(rec.route)}>
        {LINK_CTA[rec.id] ?? 'Open'} <ArrowRight size={16} aria-hidden="true" />
      </Button>
    </div>,
  );
}

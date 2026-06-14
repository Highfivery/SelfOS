import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lightbulb, RefreshCw, Sparkles } from 'lucide-react';
import { getExercise } from '@selfos/core/conversations';
import type { QuestionnaireSuggestion } from '@shared/schemas';
import { useGuidanceStore } from '../../../stores/guidanceStore';
import { useConversationStore } from '../../../stores/conversationStore';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { GuidedExerciseCard } from '../sessions/GuidedExerciseCard';
import { toSeed } from '../questionnaires/SuggestedPanel';
import styles from './Home.module.css';

/**
 * "Suggested next steps" (17 §3.1) — both guided sessions (16) and a questionnaire worth sending (08
 * gap-finder), clearly labelled. Renders only when AI is ready (else hidden — deterministic cards still
 * show). **No spend on load**: guided suggestions come from 16's cache; generating/refreshing them and
 * the questionnaire gap-finder are explicit-tap actions that spend only on a deliberate tap (build
 * decision, 17 §13).
 */
export function SuggestionsCard({
  configured,
  canCreateQuestionnaires,
}: {
  configured: boolean;
  canCreateQuestionnaires: boolean;
}): JSX.Element | null {
  const navigate = useNavigate();
  const suggestions = useGuidanceStore((s) => s.suggestions);
  const generating = useGuidanceStore((s) => s.generating);
  const generate = useGuidanceStore((s) => s.generate);
  const startGuided = useConversationStore((s) => s.startGuided);
  const suggestQuestionnaires = useQuestionnaireStore((s) => s.suggest);

  const [qBusy, setQBusy] = useState(false);
  const [qSuggestion, setQSuggestion] = useState<QuestionnaireSuggestion | null>(null);
  const [qNotice, setQNotice] = useState<string | null>(null);

  if (!configured) return null;

  const guided = (suggestions?.items ?? [])
    .map((s) => ({ exercise: getExercise(s.guideId), reason: s.reason }))
    .filter((x): x is { exercise: NonNullable<typeof x.exercise>; reason: string } =>
      Boolean(x.exercise),
    )
    .slice(0, 3);

  const onPickGuided = async (guideId: string): Promise<void> => {
    const id = await startGuided(guideId);
    if (id) navigate('/sessions');
  };

  const onSuggestQuestionnaire = async (): Promise<void> => {
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

  return (
    <Card className={styles.wide}>
      <Stack gap={4}>
        <Heading level={2}>Suggested next steps</Heading>

        {/* Guided sessions — cached, with an explicit generate/refresh (spends only on tap). */}
        <Stack gap={2}>
          <div className={styles.cardHead}>
            <Text weight={600}>Guided sessions</Text>
            <Button variant="secondary" onClick={() => void generate()} disabled={generating}>
              {suggestions ? (
                <RefreshCw size={14} aria-hidden="true" />
              ) : (
                <Sparkles size={14} aria-hidden="true" />
              )}
              {generating ? 'Finding…' : suggestions ? 'Refresh' : 'Get personalized suggestions'}
            </Button>
          </div>
          {guided.length > 0 ? (
            <div className={styles.suggestGrid}>
              {guided.map(({ exercise, reason }) => (
                <GuidedExerciseCard
                  key={exercise.id}
                  exercise={exercise}
                  reason={reason}
                  onPick={() => void onPickGuided(exercise.id)}
                />
              ))}
            </div>
          ) : (
            <Text size="sm" tone="secondary">
              Get a few exercises picked for you, based on your profile and recent sessions.
            </Text>
          )}
        </Stack>

        {/* Questionnaire gap-finder — explicit-tap only (spends on tap). */}
        {canCreateQuestionnaires ? (
          <Stack gap={2}>
            <div className={styles.cardHead}>
              <Text weight={600}>A questionnaire to send</Text>
              <Button
                variant="secondary"
                onClick={() => void onSuggestQuestionnaire()}
                disabled={qBusy}
              >
                <Lightbulb size={14} aria-hidden="true" />
                {qBusy ? 'Thinking…' : qSuggestion ? 'Suggest again' : 'Suggest a questionnaire'}
              </Button>
            </div>
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
            ) : (
              <Text size="sm" tone="secondary">
                Let the coach suggest the next questionnaire to send someone in your circle.
              </Text>
            )}
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}

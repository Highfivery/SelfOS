import { useEffect, useState } from 'react';
import { Lightbulb, Sparkles } from 'lucide-react';
import { aiKeyResolved } from '../../aiAvailability';
import { AiUnavailableNotice } from '../../AiUnavailableNotice';
import { DiscoveryTip } from '../../DiscoveryTip';
import type { Question, QuestionnaireSuggestion } from '@shared/schemas';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { useDiscoveryStore, DISCOVERY_KEYS } from '../../../stores/discoveryStore';
import { useSetting } from '../../../settings/useSetting';
import { Banner, Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import type { BuilderSeed } from './QuestionnaireBuilder';
import styles from './Questionnaires.module.css';

const genId = (): string => `q-${Math.random().toString(36).slice(2, 10)}`;

/** A gap-finder suggestion → a builder seed (its sample questions become editable drafts). */
export function toSeed(suggestion: QuestionnaireSuggestion): BuilderSeed {
  const questions: Question[] = suggestion.questions.map((q) => ({
    id: genId(),
    type: q.type,
    prompt: q.prompt,
    required: q.required ?? false, // a suggestion's sample question may omit `required` (37 §3.3)
  }));
  return { title: suggestion.title, type: suggestion.type, questions };
}

/**
 * "Suggested for you" — the gap-finder surface (08-questionnaires §3.7/§13.3). On demand (never
 * auto-spending budget), AI proposes the next questionnaires from the author's structured context.
 * "Create from this" opens the builder pre-filled. Calm states when AI is off or over budget.
 */
export function SuggestedPanel({
  onCreate,
}: {
  onCreate: (seed: BuilderSeed) => void;
}): JSX.Element {
  const suggest = useQuestionnaireStore((s) => s.suggest);
  const dismissTip = useDiscoveryStore((s) => s.dismiss);
  const [aiEnabled] = useSetting('ai.enabled');
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<QuestionnaireSuggestion[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void aiKeyResolved('anthropic').then(setHasKey);
  }, []);

  const aiReady = aiEnabled === true && hasKey;

  const onFind = async (): Promise<void> => {
    dismissTip(DISCOVERY_KEYS.tipGapFinder); // using the gap-finder suppresses its tip for good
    setBusy(true);
    setNotice(null);
    try {
      const result = await suggest({});
      if (result.ok && result.suggestions) setSuggestions(result.suggestions);
      else {
        setSuggestions([]);
        setNotice(result.message ?? 'No suggestions right now.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={4}>
      <Heading level={3}>Suggested for you</Heading>

      {!aiReady ? (
        <AiUnavailableNotice />
      ) : (
        <>
          <DiscoveryTip tipKey={DISCOVERY_KEYS.tipGapFinder}>
            New here? Let the coach suggest a questionnaire worth sending — it reads what it already
            knows, never raw answers.
          </DiscoveryTip>
          <Text tone="secondary">
            Let the coach suggest the next questionnaires to send, based on what it knows about the
            people in your life.
          </Text>
          <div>
            <Button variant="primary" onClick={() => void onFind()} disabled={busy}>
              <Sparkles size={14} aria-hidden="true" />
              {busy ? 'Thinking…' : suggestions ? 'Suggest again' : 'Suggest questionnaires'}
            </Button>
          </div>

          {notice ? <Banner tone="info">{notice}</Banner> : null}

          {suggestions?.map((s, i) => (
            <Card key={`${s.title}-${i}`}>
              <Stack gap={2}>
                <div className={styles.suggestionHead}>
                  <Lightbulb size={16} aria-hidden="true" />
                  <Text weight={600}>{s.title}</Text>
                </div>
                {s.rationale ? (
                  <Text size="sm" tone="secondary">
                    {s.rationale}
                  </Text>
                ) : null}
                <ul className={styles.suggestionQuestions}>
                  {s.questions.map((q, qi) => (
                    <li key={qi}>{q.prompt}</li>
                  ))}
                </ul>
                <div>
                  <Button variant="secondary" onClick={() => onCreate(toSeed(s))}>
                    Create from this
                  </Button>
                </div>
              </Stack>
            </Card>
          ))}
        </>
      )}
    </Stack>
  );
}

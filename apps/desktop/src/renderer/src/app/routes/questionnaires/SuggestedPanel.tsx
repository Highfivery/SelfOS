import { useEffect, useState } from 'react';
import { Lightbulb, Sparkles, Trash2 } from 'lucide-react';
import { aiKeyResolved } from '../../aiAvailability';
import { AiUnavailableNotice } from '../../AiUnavailableNotice';
import { DiscoveryTip } from '../../DiscoveryTip';
import type { Question, QuestionnaireSuggestion, SavedSuggestion } from '@shared/schemas';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useDiscoveryStore, DISCOVERY_KEYS } from '../../../stores/discoveryStore';
import { useSetting } from '../../../settings/useSetting';
import {
  Banner,
  Button,
  Card,
  Field,
  Heading,
  IconButton,
  Select,
  Stack,
  Text,
} from '../../../design-system/components';
import type { BuilderSeed } from './QuestionnaireBuilder';
import styles from './Questionnaires.module.css';

const genId = (): string => `q-${Math.random().toString(36).slice(2, 10)}`;

/** A gap-finder suggestion → a builder seed (its sample questions become editable drafts). Accepts the base
 * shape so both a `SavedSuggestion` (the panel) and a plain `QuestionnaireSuggestion` (Home's teaser) work. */
export function toSeed(suggestion: QuestionnaireSuggestion): BuilderSeed {
  const questions: Question[] = suggestion.questions.map((q) => ({
    id: genId(),
    type: q.type,
    prompt: q.prompt,
    required: q.required ?? false, // a suggestion's sample question may omit `required` (37 §3.3)
    // Carry the sample question's options through so a seeded choice question isn't blank (08 §19.4).
    ...(q.options && q.options.length > 0 ? { options: q.options } : {}),
  }));
  return { title: suggestion.title, type: suggestion.type, questions };
}

/** What "Create from this" hands back: the seed + the link so the container can bind the recipient and remove
 * the suggestion once a questionnaire is actually saved from it (08 §18.4). */
export interface SuggestionCreate {
  seed: BuilderSeed;
  recipientPersonId: string;
  suggestionId: string;
}

/**
 * "Suggested for you" — the recipient-first gap-finder surface (08-questionnaires §18). You pick **who** the
 * ideas are for FIRST; the coach then proposes questionnaires tailored to that person (going deeper on what
 * it knows, opening brand-new areas, never repeating what they've been asked). Suggestions are **saved** per
 * person, so re-opening costs no AI; "Suggest more" accumulates genuinely-new ideas. Each card can be deleted,
 * and "Create from this" binds the recipient straight away (no re-asking who it's for).
 */
export function SuggestedPanel({
  onCreate,
}: {
  onCreate: (create: SuggestionCreate) => void;
}): JSX.Element {
  const generateSuggestions = useQuestionnaireStore((s) => s.generateSuggestions);
  const listSavedSuggestions = useQuestionnaireStore((s) => s.listSavedSuggestions);
  const deleteSuggestion = useQuestionnaireStore((s) => s.deleteSuggestion);
  const materializeSuggestion = useQuestionnaireStore((s) => s.materializeSuggestion);
  const people = usePeopleStore((s) => s.people);
  const peopleLoaded = usePeopleStore((s) => s.loaded);
  const loadPeople = usePeopleStore((s) => s.load);
  const activePersonId = useSessionStore((s) => s.activePerson?.id);
  const dismissTip = useDiscoveryStore((s) => s.dismiss);
  const [aiEnabled] = useSetting('ai.enabled');
  const [hasKey, setHasKey] = useState(false);
  const [recipientId, setRecipientId] = useState('');
  const [saved, setSaved] = useState<SavedSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [materializingId, setMaterializingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void aiKeyResolved('anthropic').then(setHasKey);
  }, []);
  useEffect(() => {
    if (!peopleLoaded) void loadPeople();
  }, [peopleLoaded, loadPeople]);

  // Load the saved set whenever the recipient — or the active person (the author) — changes, so one person's
  // ideas never linger into another's view (the per-person isolation rule). No AI spend on this read.
  useEffect(() => {
    if (recipientId === '') {
      setSaved([]);
      return;
    }
    let cancelled = false;
    void listSavedSuggestions(recipientId).then((list) => {
      if (!cancelled) setSaved(list);
    });
    return () => {
      cancelled = true;
    };
  }, [recipientId, activePersonId, listSavedSuggestions]);

  const aiReady = aiEnabled === true && hasKey;
  const recipientName = people.find((p) => p.id === recipientId)?.displayName ?? '';

  const onSuggest = async (): Promise<void> => {
    if (recipientId === '') return;
    dismissTip(DISCOVERY_KEYS.tipGapFinder); // using the gap-finder suppresses its tip for good
    setBusy(true);
    setNotice(null);
    try {
      const result = await generateSuggestions(recipientId);
      setSaved(result.saved ?? []);
      // A failed/empty generate carries an honest message (incl. the thin-context hint, which has no reason);
      // a success just adds the new cards. (`ok:true` always implies ≥1 added, so there's no "0 new" case.)
      if (!result.ok) setNotice(result.message ?? 'No suggestions right now.');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (suggestionId: string): Promise<void> => {
    setSaved(await deleteSuggestion(recipientId, suggestionId));
  };

  // "Create from this" (08 §19.4): run a full, knowledge-aware generation from the suggestion's idea — a
  // complete, de-duped questionnaire with proper options. Falls back to seeding the sample questions if the
  // generation can't run (over budget / refusal), so create never dead-ends.
  const onCreateFromSuggestion = async (s: SavedSuggestion): Promise<void> => {
    setMaterializingId(s.id);
    setNotice(null);
    try {
      const result = await materializeSuggestion(recipientId, s.id);
      if (result.ok && result.questions && result.questions.length > 0) {
        onCreate({
          seed: {
            title: result.title?.trim() || s.title,
            type: s.type,
            questions: result.questions,
          },
          recipientPersonId: recipientId,
          suggestionId: s.id,
        });
      } else {
        setNotice(
          'Couldn’t expand that one with AI — opening it with the sample questions to edit.',
        );
        onCreate({ seed: toSeed(s), recipientPersonId: recipientId, suggestionId: s.id });
      }
    } finally {
      setMaterializingId(null);
    }
  };

  return (
    <Stack gap={4}>
      <Heading level={3}>Suggested for you</Heading>

      <DiscoveryTip tipKey={DISCOVERY_KEYS.tipGapFinder}>
        Pick who you want ideas for, and the coach will suggest a questionnaire worth sending —
        tailored to them, never repeating what it already knows.
      </DiscoveryTip>

      {/* Who the ideas are for, chosen FIRST (08 §18.1) — a full-width Select, household people only. */}
      <Field label="Who do you want ideas for?">
        {(props) => (
          <Select
            {...props}
            value={recipientId}
            onChange={(e) => {
              setNotice(null);
              setRecipientId(e.target.value);
            }}
          >
            <option value="">Choose a person…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
                {p.id === activePersonId ? ' (you)' : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {recipientId === '' ? (
        <Text tone="secondary">
          Choose someone in your household and I’ll suggest questionnaires tailored to them —
          building on what I already know and opening up new ground.
        </Text>
      ) : !aiReady ? (
        // Generating needs AI; saved ideas (if any) still render below so they stay usable when AI is off.
        <AiUnavailableNotice />
      ) : (
        <>
          <Text tone="secondary">
            Tailored to {recipientName} — I’ll go deeper on what I know and open brand-new areas,
            never re-asking what they’ve already answered.
          </Text>
          <div>
            <Button variant="primary" onClick={() => void onSuggest()} disabled={busy}>
              <Sparkles size={14} aria-hidden="true" />
              {busy
                ? 'Thinking…'
                : saved.length > 0
                  ? 'Suggest more'
                  : `Suggest questionnaires for ${recipientName}`}
            </Button>
          </div>
        </>
      )}

      {notice ? <Banner tone="info">{notice}</Banner> : null}

      {saved.map((s) => (
        <Card key={s.id}>
          <Stack gap={2}>
            <div className={styles.suggestionTop}>
              <div className={styles.suggestionHead}>
                <Lightbulb size={16} aria-hidden="true" />
                <Text weight={600}>{s.title}</Text>
              </div>
              <IconButton
                variant="ghost"
                aria-label={`Delete suggestion “${s.title}”`}
                onClick={() => void onDelete(s.id)}
              >
                <Trash2 size={16} aria-hidden="true" />
              </IconButton>
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
              <Button
                variant="secondary"
                disabled={materializingId !== null}
                onClick={() => void onCreateFromSuggestion(s)}
              >
                {materializingId === s.id ? 'Building…' : 'Create from this'}
              </Button>
            </div>
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

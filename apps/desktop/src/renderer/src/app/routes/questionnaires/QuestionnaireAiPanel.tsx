import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import type { Question, SensitivityTier } from '@shared/schemas';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import {
  Banner,
  Button,
  Field,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
} from '../../../design-system/components';
import styles from './Questionnaires.module.css';

/**
 * "Draft with AI" (08-questionnaires §3.1/§13.3): generate questions from a free-text brief and/or the
 * **configured structured context** — the author's own data, an optional target person (shareable facts
 * only), and/or the relationship between them. Budget-gated + metered in main; calm states when AI is
 * off or over budget. Generated questions are appended to the draft (the caller marks them AI-drafted).
 */
export function QuestionnaireAiPanel({
  aiReady,
  type,
  sensitivity,
  existingPrompts,
  onGenerated,
}: {
  aiReady: boolean;
  type: string;
  sensitivity: SensitivityTier;
  existingPrompts: string[];
  onGenerated: (questions: Question[]) => void;
}): JSX.Element {
  const navigate = useNavigate();
  const generate = useQuestionnaireStore((s) => s.generate);
  const people = usePeopleStore((s) => s.people);
  const loadPeople = usePeopleStore((s) => s.load);
  const activePerson = useSessionStore((s) => s.activePerson);

  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const [targetPersonId, setTargetPersonId] = useState('');
  const [includeTarget, setIncludeTarget] = useState(true);
  const [includeRelationship, setIncludeRelationship] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning'; text: string } | null>(null);

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

  const targets = people.filter((p) => p.id !== activePerson?.id);
  const targetName = targets.find((p) => p.id === targetPersonId)?.displayName;

  if (!aiReady) {
    return (
      <Banner tone="info">
        Turn on AI in Settings to draft questions automatically.{' '}
        <button type="button" className={styles.linkButton} onClick={() => navigate('/settings')}>
          Open Settings
        </button>
      </Banner>
    );
  }

  const onGenerate = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await generate({
        type,
        sensitivity,
        ...(brief.trim() ? { brief: brief.trim() } : {}),
        ...(targetPersonId ? { targetPersonId } : {}),
        includeTarget: Boolean(targetPersonId) && includeTarget,
        includeRelationship: Boolean(targetPersonId) && includeRelationship,
        existingPrompts,
      });
      if (result.ok && result.questions && result.questions.length > 0) {
        onGenerated(result.questions);
        setNotice({
          tone: 'info',
          text: `Added ${result.questions.length} draft question${
            result.questions.length === 1 ? '' : 's'
          } below — review and edit them.`,
        });
      } else {
        setNotice({ tone: 'warning', text: result.message ?? 'No questions came back.' });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.aiPanel}>
      <button
        type="button"
        className={styles.aiHeader}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Sparkles size={16} aria-hidden="true" />
        <Text weight={600}>Draft with AI</Text>
      </button>

      {open ? (
        <Stack gap={3}>
          <Field label="What do you want to explore? (optional)">
            {(props) => (
              <Textarea
                {...props}
                rows={2}
                value={brief}
                placeholder="e.g. how we’re handling the move, what they need more of from me"
                onChange={(event) => setBrief(event.target.value)}
              />
            )}
          </Field>

          <Field label="About a specific person? (optional)">
            {(props) => (
              <Select
                {...props}
                value={targetPersonId}
                onChange={(event) => setTargetPersonId(event.target.value)}
              >
                <option value="">No one in particular</option>
                {targets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {/* Your own shareable data is always used to personalise generation (§15.4) — no toggle. The
              optional toggles below pull in a *different* person's context (the §13.3 shareable boundary). */}
          {targetPersonId ? (
            <div className={styles.aiToggles}>
              <label className={styles.aiToggle}>
                <Switch
                  checked={includeTarget}
                  onChange={setIncludeTarget}
                  aria-label={`Use ${targetName ?? 'their'} shareable info`}
                />
                <Text size="sm">Use {targetName ?? 'their'} shareable info</Text>
              </label>
              <label className={styles.aiToggle}>
                <Switch
                  checked={includeRelationship}
                  onChange={setIncludeRelationship}
                  aria-label="Use our relationship"
                />
                <Text size="sm">Use our relationship</Text>
              </label>
            </div>
          ) : null}

          {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}

          <Button variant="primary" onClick={() => void onGenerate()} disabled={busy}>
            <Sparkles size={14} aria-hidden="true" />
            {busy ? 'Drafting…' : 'Generate questions'}
          </Button>
        </Stack>
      ) : null}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Question, SensitivityTier } from '@shared/schemas';
import { AiUnavailableNotice } from '../../AiUnavailableNotice';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { useSessionStore } from '../../../stores/sessionStore';
import {
  Banner,
  Button,
  Field,
  Select,
  Stack,
  Text,
  Textarea,
} from '../../../design-system/components';
import styles from './Questionnaires.module.css';

/**
 * "Draft with AI" (08-questionnaires §3.1/§13.3/§17.12): generate questions from a free-text brief. Generation
 * automatically uses the author's own shareable data AND the **bound recipient's** shareable context to tailor
 * the questions (the recipient is chosen at the start step — no second person-picker here, §17.12-A), plus the
 * recipient's full history for de-dup (§17.4). Budget-gated + metered in main; calm states when AI is off or
 * over budget. Generated questions are appended to the draft (the caller marks them AI-drafted).
 */
export function QuestionnaireAiPanel({
  aiReady,
  type,
  sensitivity,
  recipientPersonId,
  existingPrompts,
  onGenerated,
  onTitle,
}: {
  aiReady: boolean;
  type: string;
  sensitivity: SensitivityTier;
  // The bound household recipient (08 §17.3/§17.4): generation tailors to their shareable context and skips
  // what they've already covered. Undefined for an external recipient (no household context).
  recipientPersonId?: string;
  existingPrompts: string[];
  onGenerated: (questions: Question[]) => void;
  // A short AI-suggested title (08 §16.4); the builder applies it only when the title is still empty.
  onTitle?: (title: string) => void;
}): JSX.Element {
  const generate = useQuestionnaireStore((s) => s.generate);
  // Owner-only inline "add a topic" for an intimacy questionnaire at an explicit tier (08 §16.5a).
  const canManageTopics = useSessionStore((s) => s.can('people.manage'));
  const showTopicAdd =
    canManageTopics &&
    type === 'intimacy' &&
    (sensitivity === 'explicit' || sensitivity === 'unfiltered');

  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState('');
  // Intimacy drafts can be direct questions, described scenarios, or a mix (08 §17.12-C).
  const [intimacyMode, setIntimacyMode] = useState<'questions' | 'scenarios' | 'mix'>('questions');
  const isIntimacy = type === 'intimacy';
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning'; text: string } | null>(null);
  const [topicKind, setTopicKind] = useState<'activities' | 'fantasies'>('activities');
  const [topicDraft, setTopicDraft] = useState('');
  const [topicBusy, setTopicBusy] = useState(false);
  const [topicNotice, setTopicNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const onAddTopic = async (): Promise<void> => {
    const name = topicDraft.trim();
    if (name === '' || topicBusy) return;
    setTopicBusy(true);
    setTopicNotice(null);
    try {
      await window.selfos?.questionnairesAddIntimacyTopic({ kind: topicKind, name });
      setTopicDraft('');
      setTopicNotice({ ok: true, text: `Added “${name}” — the AI will draw on it.` });
    } catch {
      setTopicNotice({ ok: false, text: 'Couldn’t add that topic.' });
    } finally {
      setTopicBusy(false);
    }
  };

  // A live elapsed-time counter while drafting, so it's clearly working and not stuck (generation is a
  // single non-streaming call, so an honest "it's running" beats a frozen spinner).
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  if (!aiReady) {
    return <AiUnavailableNotice />;
  }

  const onGenerate = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await generate({
        type,
        sensitivity,
        ...(brief.trim() ? { brief: brief.trim() } : {}),
        existingPrompts,
        // The bound household recipient (08 §17.12-A): the bridge auto-tailors to their shareable context and
        // de-dups against their full history. No person-picker here — the recipient was chosen at the start.
        ...(recipientPersonId ? { recipientPersonId } : {}),
        // Intimacy can draft questions, scenarios, or a mix (08 §17.12-C).
        ...(isIntimacy ? { intimacyMode } : {}),
      });
      if (result.ok && result.questions && result.questions.length > 0) {
        onGenerated(result.questions);
        if (result.title) onTitle?.(result.title);
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

          {/* Intimacy can draft direct questions, described scenarios to react to, or a mix (§17.12-C). */}
          {isIntimacy ? (
            <Field label="Generate">
              {(props) => (
                <Select
                  {...props}
                  value={intimacyMode}
                  onChange={(e) =>
                    setIntimacyMode(e.target.value as 'questions' | 'scenarios' | 'mix')
                  }
                >
                  <option value="questions">Questions</option>
                  <option value="scenarios">Scenarios (situations to react to)</option>
                  <option value="mix">A mix of both</option>
                </Select>
              )}
            </Field>
          ) : null}

          {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}

          {busy ? (
            <div className={styles.aiProgress} role="status" aria-live="polite">
              <div className={styles.aiProgressBar} aria-hidden="true">
                <span />
              </div>
              <Text size="sm" tone="secondary">
                Drafting your questions… {elapsed}s
                {elapsed >= 30 ? ' — almost there, hang tight.' : ' (usually 10–30 seconds)'}
              </Text>
            </div>
          ) : (
            <Button variant="primary" onClick={() => void onGenerate()} disabled={busy}>
              <Sparkles size={14} aria-hidden="true" />
              Generate questions
            </Button>
          )}

          {showTopicAdd ? (
            <Stack gap={2}>
              <Text size="sm" tone="secondary">
                Add a consensual-adult topic for the AI to draw on (18+). It’s saved household-wide
                and also feeds the personal intake — manage the full list in Settings.
              </Text>
              <Select
                aria-label="Topic kind"
                value={topicKind}
                onChange={(e) => setTopicKind(e.target.value as 'activities' | 'fantasies')}
              >
                <option value="activities">Activity</option>
                <option value="fantasies">Fantasy</option>
              </Select>
              <Textarea
                aria-label="New topic"
                rows={2}
                value={topicDraft}
                placeholder="e.g. Wax play"
                onChange={(e) => setTopicDraft(e.target.value)}
              />
              <div>
                <Button
                  variant="secondary"
                  onClick={() => void onAddTopic()}
                  disabled={topicBusy || topicDraft.trim() === ''}
                >
                  {topicBusy ? 'Adding…' : 'Add topic'}
                </Button>
              </div>
              {topicNotice ? (
                <Text size="sm" tone={topicNotice.ok ? 'secondary' : 'tertiary'}>
                  {topicNotice.text}
                </Text>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      ) : null}
    </div>
  );
}

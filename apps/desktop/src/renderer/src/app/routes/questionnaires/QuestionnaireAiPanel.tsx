import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Question, SensitivityTier } from '@shared/schemas';
import { AiUnavailableNotice } from '../../AiUnavailableNotice';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
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
 * "Draft with AI" (08-questionnaires §3.1/§13.3/§17.12/§23): generate questions from a free-text brief that,
 * when present, is the GOVERNING focus of the whole questionnaire (§23.3). Generation automatically uses the
 * author's own shareable data AND the **bound recipient's** shareable context to tailor the questions (the
 * recipient is chosen at the start step — no second person-picker here, §17.12-A), plus the recipient's full
 * history for de-dup (§17.4/§23.5). The author picks how many questions (§23.4). Budget-gated + metered in
 * main; calm states when AI is off or over budget. Generated questions are appended to the draft (the caller
 * marks them AI-drafted). The household-wide intimacy-topic inventory is managed in Settings → Intimacy topics
 * (§16.5a) — it is deliberately NOT surfaced here (§23.6).
 */
export function QuestionnaireAiPanel({
  aiReady,
  type,
  sensitivity,
  recipientPersonId,
  existingPrompts,
  onGenerated,
  onTitle,
  initialBrief,
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
  // A pre-filled starting brief from a Home "Ideas" card (59 §3.5) — opens the panel expanded + seeds the brief
  // so a fun/spicy idea is one tap from a drafted questionnaire. Undefined ⇒ the panel starts collapsed + empty.
  initialBrief?: string;
}): JSX.Element {
  const generate = useQuestionnaireStore((s) => s.generate);

  const [open, setOpen] = useState(initialBrief != null);
  const [brief, setBrief] = useState(initialBrief ?? '');
  // How many questions to draft (08 §23.4): a Select (1–20) keeps the value always valid — no NaN/blank edge
  // from a free-typed number input (§22 lesson). Default 5.
  const [count, setCount] = useState(5);
  // Intimacy drafts can be direct questions, described scenarios, or a mix (08 §17.12-C).
  const [intimacyMode, setIntimacyMode] = useState<'questions' | 'scenarios' | 'mix'>('questions');
  const isIntimacy = type === 'intimacy';
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning'; text: string } | null>(null);

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
        count,
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

          <Field label="Number of questions">
            {(props) => (
              <Select
                {...props}
                value={String(count)}
                onChange={(e) => setCount(Number(e.target.value))}
              >
                {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
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
        </Stack>
      ) : null}
    </div>
  );
}

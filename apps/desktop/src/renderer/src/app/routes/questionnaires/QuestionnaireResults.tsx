import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brain, Lock, Sparkles } from 'lucide-react';
import { ANTHROPIC_API_KEY_ID } from '@shared/channels';
import type { AssignmentStatus, SendResult } from '@shared/schemas';
import { Banner, Button, Card, Heading, Stack, Text } from '../../../design-system/components';
import { useResultsStore } from '../../../stores/resultsStore';
import { useSetting } from '../../../settings/useSetting';
import styles from './Questionnaires.module.css';

const STATUS_LABEL: Record<AssignmentStatus, string> = {
  draft: 'Draft',
  sent: 'Sent — waiting',
  opened: 'Opened — waiting',
  inProgress: 'In progress',
  submitted: 'Answered',
  analyzed: 'Answered',
  expired: 'Expired',
  revoked: 'Revoked',
  declined: 'Declined',
};

/**
 * The sender's **Results** for one questionnaire (08-questionnaires §3.7): every send + its outcome.
 * Standard sends show the raw answers; Private (break-glass) sends show only an Analyze action — the raw
 * answers never reach the sender (the bridge enforces this). **Analyze** turns a submitted response into
 * a draft Insight reviewed in **Memory**. With `questionnaires.autoAnalyze` on, opening this view
 * analyzes any new responses automatically.
 */
export function QuestionnaireResults({
  questionnaireId,
}: {
  questionnaireId: string;
}): JSX.Element {
  const results = useResultsStore((s) => s.results);
  const loaded = useResultsStore((s) => s.loaded);
  const load = useResultsStore((s) => s.load);
  const analyze = useResultsStore((s) => s.analyze);
  const reset = useResultsStore((s) => s.reset);

  const [autoAnalyze] = useSetting('questionnaires.autoAnalyze');
  const [aiEnabled] = useSetting('ai.enabled');
  const [hasAiKey, setHasAiKey] = useState(false);
  useEffect(() => {
    void window.selfos
      ?.secretHas({ id: ANTHROPIC_API_KEY_ID })
      .then((v) => setHasAiKey(Boolean(v)));
  }, []);
  const aiReady = aiEnabled === true && hasAiKey;

  const [analyzing, setAnalyzing] = useState<Record<string, boolean>>({});
  const [messages, setMessages] = useState<
    Record<string, { tone: 'info' | 'warning'; text: string }>
  >({});

  useEffect(() => {
    void load(questionnaireId);
    return () => reset();
  }, [questionnaireId, load, reset]);

  const runAnalyze = async (assignmentId: string): Promise<void> => {
    if (analyzing[assignmentId]) return;
    setAnalyzing((m) => ({ ...m, [assignmentId]: true }));
    setMessages((m) => ({ ...m, [assignmentId]: { tone: 'info', text: 'Analyzing…' } }));
    try {
      const result = await analyze(assignmentId);
      setMessages((m) => ({
        ...m,
        [assignmentId]: result.ok
          ? { tone: 'info', text: 'Insight drafted — review it in Memory.' }
          : { tone: 'warning', text: result.message ?? 'Couldn’t analyze this response.' },
      }));
    } finally {
      setAnalyzing((m) => ({ ...m, [assignmentId]: false }));
    }
  };

  // autoAnalyze (default OFF): when on, draft an insight for each new response one at a time. Each
  // attempt is recorded so a failure (e.g. over budget) is never retried in a loop. The effect re-fires
  // on `results` (each analyze reloads them), so it walks the list one send per run — `runAnalyze` is
  // deliberately omitted from the deps (it isn't memoized and `results` is the real trigger).
  const autoAttempted = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (autoAnalyze !== true || !aiReady) return;
    const next = results.find(
      (r) => r.status === 'submitted' && !r.analyzed && !autoAttempted.current.has(r.assignmentId),
    );
    if (!next) return;
    autoAttempted.current.add(next.assignmentId);
    void runAnalyze(next.assignmentId);
  }, [results, autoAnalyze, aiReady]);

  if (loaded && results.length === 0) {
    return (
      <Card>
        <Stack gap={2} align="center">
          <Brain size={24} aria-hidden="true" />
          <Text tone="secondary">
            You haven’t sent this questionnaire yet. Use <strong>Send</strong> on the Edit tab to
            ask someone — their response shows up here.
          </Text>
        </Stack>
      </Card>
    );
  }

  return (
    <Stack gap={3}>
      <Heading level={3}>Results</Heading>
      {!aiReady ? (
        <Banner tone="info">
          Turn on AI in <Link to="/settings">Settings</Link> to analyze responses into insights.
        </Banner>
      ) : null}

      {results.map((send) => (
        <SendCard
          key={send.assignmentId}
          send={send}
          aiReady={aiReady}
          analyzing={analyzing[send.assignmentId] === true}
          message={messages[send.assignmentId]}
          onAnalyze={() => void runAnalyze(send.assignmentId)}
        />
      ))}
    </Stack>
  );
}

function SendCard({
  send,
  aiReady,
  analyzing,
  message,
  onAnalyze,
}: {
  send: SendResult;
  aiReady: boolean;
  analyzing: boolean;
  message: { tone: 'info' | 'warning'; text: string } | undefined;
  onAnalyze: () => void;
}): JSX.Element {
  const isSubmitted = send.status === 'submitted';
  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.resultHead}>
          <Text weight={500}>{send.recipientName}</Text>
          <span className={styles.rowBadge}>
            {send.privacy === 'private' ? (
              <Lock size={12} aria-hidden="true" className={styles.privacyIcon} />
            ) : null}
            {STATUS_LABEL[send.status]}
          </span>
        </div>

        {send.status === 'declined' ? (
          <Text tone="secondary">
            {send.declineNote ? `Declined — “${send.declineNote}”` : 'Declined.'}
          </Text>
        ) : null}

        {/* Standard, submitted → the raw answers; Private never carries them (privacy boundary). */}
        {isSubmitted && send.answers ? (
          <dl className={styles.qaList}>
            {send.answers.map((qa, i) => (
              <div key={i} className={styles.qaItem}>
                <dt className={styles.qaPrompt}>{qa.prompt}</dt>
                <dd className={styles.qaAnswer}>{qa.answer === '' ? '—' : qa.answer}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {isSubmitted && !send.answers && send.privacy === 'private' ? (
          <Text tone="secondary">
            Answered privately — their raw responses stay hidden. Analyze to draft an insight from
            them.
          </Text>
        ) : null}

        {/* Standard but the answers couldn't be read (a rare missing/corrupt file) — don't mislabel it as private. */}
        {isSubmitted && !send.answers && send.privacy === 'standard' ? (
          <Text tone="secondary">Couldn’t load these answers.</Text>
        ) : null}

        {isSubmitted && send.analyzed ? (
          <Banner tone="info">
            Insight drafted from this response. <Link to="/memory">Review it in Memory →</Link>
          </Banner>
        ) : null}

        {isSubmitted && !send.analyzed && aiReady ? (
          <div>
            <Button variant="secondary" onClick={onAnalyze} disabled={analyzing}>
              <Sparkles size={16} aria-hidden="true" />
              {analyzing ? 'Analyzing…' : 'Analyze'}
            </Button>
          </div>
        ) : null}

        {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
      </Stack>
    </Card>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brain, Lock, Sparkles, Trash2 } from 'lucide-react';
import { ANTHROPIC_API_KEY_ID } from '@shared/channels';
import type {
  AssignmentStatus,
  CompatibilityConfig,
  QuestionTrend,
  SendResult,
} from '@shared/schemas';
import { CompatibilityResults } from './CompatibilityResults';
import {
  Banner,
  Button,
  Card,
  Heading,
  IconButton,
  Inline,
  LineChart,
  Stack,
  Text,
  type LineChartSeries,
} from '../../../design-system/components';
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
  compatibility,
}: {
  questionnaireId: string;
  compatibility: CompatibilityConfig | null;
}): JSX.Element {
  // A compatibility questionnaire has its own paired Results surface (alignment report + break-glass),
  // distinct from the per-recipient Standard/Private cards below.
  if (compatibility?.enabled) {
    return <CompatibilityResults questionnaireId={questionnaireId} />;
  }
  return <StandardResults questionnaireId={questionnaireId} />;
}

function StandardResults({ questionnaireId }: { questionnaireId: string }): JSX.Element {
  const results = useResultsStore((s) => s.results);
  const trends = useResultsStore((s) => s.trends);
  const loaded = useResultsStore((s) => s.loaded);
  const load = useResultsStore((s) => s.load);
  const analyze = useResultsStore((s) => s.analyze);
  const remove = useResultsStore((s) => s.remove);
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

  const runDelete = async (assignmentId: string): Promise<void> => {
    setMessages((m) => {
      const next = { ...m };
      delete next[assignmentId];
      return next;
    });
    try {
      await remove(assignmentId);
    } catch {
      setMessages((m) => ({
        ...m,
        [assignmentId]: { tone: 'warning', text: 'Couldn’t delete this send. Please try again.' },
      }));
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
          onDelete={() => void runDelete(send.assignmentId)}
        />
      ))}

      {trends.length > 0 ? (
        <Stack gap={3}>
          <Heading level={3}>Trends</Heading>
          <Text size="sm" tone="secondary">
            How numeric answers have moved across re-asks.
          </Text>
          {trends.map((trend) => (
            <TrendCard key={trend.questionId} trend={trend} />
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

/** One numeric question's rating-over-time chart across the questionnaire's re-asks. */
function TrendCard({ trend }: { trend: QuestionTrend }): JSX.Element {
  const series: LineChartSeries[] = trend.series.map((s) => ({
    label: s.label,
    points: s.points.map((p) => ({ x: Date.parse(p.at), y: p.value })),
  }));
  return (
    <Card>
      <Stack gap={2}>
        <Text weight={500}>{trend.prompt}</Text>
        <LineChart series={series} ariaLabel={`Trend over time for “${trend.prompt}”`} />
      </Stack>
    </Card>
  );
}

function SendCard({
  send,
  aiReady,
  analyzing,
  message,
  onAnalyze,
  onDelete,
}: {
  send: SendResult;
  aiReady: boolean;
  analyzing: boolean;
  message: { tone: 'info' | 'warning'; text: string } | undefined;
  onAnalyze: () => void;
  onDelete: () => void;
}): JSX.Element {
  const isSubmitted = send.status === 'submitted';
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.resultHead}>
          <Text weight={500}>{send.recipientName}</Text>
          <div className={styles.resultHeadRight}>
            <span className={styles.rowBadge}>
              {send.privacy === 'private' ? (
                <Lock size={12} aria-hidden="true" className={styles.privacyIcon} />
              ) : null}
              {STATUS_LABEL[send.status]}
            </span>
            <IconButton
              aria-label={`Delete this send to ${send.recipientName}`}
              variant="secondary"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 size={14} aria-hidden="true" />
            </IconButton>
          </div>
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

        {confirmingDelete ? (
          <Banner tone="warning">
            <Stack gap={2}>
              <Text>
                Delete this send to {send.recipientName}? It removes their response and any insight
                drawn from it. This can’t be undone.
              </Text>
              <Inline gap={2}>
                <Button
                  variant="primary"
                  onClick={() => {
                    setConfirmingDelete(false);
                    onDelete();
                  }}
                >
                  Delete
                </Button>
                <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
              </Inline>
            </Stack>
          </Banner>
        ) : null}
      </Stack>
    </Card>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, Link2, Link2Off, Lock, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { aiKeyResolved } from '../../aiAvailability';
import { AiUnavailableNotice } from '../../AiUnavailableNotice';
import type {
  AssignmentStatus,
  CompatibilityConfig,
  QuestionTrend,
  RelayLinkResult,
  SendNumericAnswer,
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
import { Avatar } from './Avatar';
import { AtAGlance } from './AtAGlance';
import { InsightExcerpt } from './InsightExcerpt';
import { ResultGroupHead, ResultsSummaryBand } from './ResultsSummaryBand';
import { groupSendsByStatus, summarizeSends } from './resultsSummary';
import { useResultsStore } from '../../../stores/resultsStore';
import { useNotificationStore } from '../../../stores/notificationStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSetting } from '../../../settings/useSetting';
import { RelayLinkDelivery } from './RelayLinkDelivery';
import styles from './Questionnaires.module.css';

const OPEN_STATUSES: AssignmentStatus[] = ['sent', 'opened', 'inProgress'];

/** A human countdown for a relay link's expiry, so the sender knows when to re-share (38 §3.6). */
export function formatLinkExpiry(expiresAt: string, now: number = Date.now()): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'Link expired';
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  if (days <= 1) return 'Link expires today';
  return `Link expires in ${days} days`;
}

// Sender-facing lifecycle labels (38 §3.5). "Started" = the recipient opened and saved a draft (inProgress)
// but hasn't submitted — the sender sees only that it's underway, never the draft answers.
const STATUS_LABEL: Record<AssignmentStatus, string> = {
  draft: 'Draft',
  sent: 'Sent — waiting',
  opened: 'Opened — waiting',
  inProgress: 'Started',
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
  // Opening Results is "seen" (38 §3.1): clear the responses-arrived slot for this questionnaire so the bell
  // stops counting it. A later, higher response count re-surfaces it (the onIncrease rule, 35 §11). markRead
  // is a no-op when no such notification is showing, so this is safe on a direct (non-notification) open.
  const markRead = useNotificationStore((s) => s.markRead);
  useEffect(() => {
    markRead(`responses-arrived:${questionnaireId}`);
  }, [markRead, questionnaireId]);

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
  const aggregate = useResultsStore((s) => s.aggregate);
  const loaded = useResultsStore((s) => s.loaded);
  const load = useResultsStore((s) => s.load);
  const analyze = useResultsStore((s) => s.analyze);
  const remove = useResultsStore((s) => s.remove);
  const drain = useResultsStore((s) => s.drain);
  const revoke = useResultsStore((s) => s.revoke);
  const reset = useResultsStore((s) => s.reset);
  const senderName = useSessionStore((s) => s.activePerson?.displayName ?? 'Someone');

  const [draining, setDraining] = useState(false);
  const [drainMsg, setDrainMsg] = useState<string | null>(null);
  // A relay-backed send is drainable whether it's an external ('relay') or a household ('inApp') send that
  // also minted a link (§17.13) — key off the relay material, NOT the channel.
  const hasRelayLink = results.some((r) => r.relayLinked);
  // Export is offered once there's at least one submitted/analyzed send to export (38 §3.7).
  const hasAnswers = results.some((r) => r.status === 'submitted' || r.status === 'analyzed');
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const onExport = async (format: 'csv' | 'json'): Promise<void> => {
    setExporting(true);
    setExportMsg(null);
    try {
      const path = await window.selfos?.assignmentsExportResults({ questionnaireId, format });
      // null = the sender cancelled the save dialog — no message (not an error).
      if (path) setExportMsg(`Exported to ${path} — this file is outside your encrypted vault.`);
    } catch {
      setExportMsg('Couldn’t export the results. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const runDrain = async (): Promise<void> => {
    setDraining(true);
    setDrainMsg(null);
    try {
      const { drained, declined } = await drain();
      setDrainMsg(
        drained + declined === 0
          ? 'No new responses yet.'
          : `Collected ${drained} response${drained === 1 ? '' : 's'}${declined ? ` and ${declined} decline${declined === 1 ? '' : 's'}` : ''}.`,
      );
    } catch {
      setDrainMsg('Couldn’t check for responses. Please try again.');
    } finally {
      setDraining(false);
    }
  };

  const [autoAnalyze] = useSetting('questionnaires.autoAnalyze');
  const [aiEnabled] = useSetting('ai.enabled');
  const [hasAiKey, setHasAiKey] = useState(false);
  useEffect(() => {
    void aiKeyResolved('anthropic').then(setHasAiKey);
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

  // autoAnalyze (default OFF): when on, draft an insight for each new response — AND re-draft when a recipient
  // edits + resubmits (a stale analysis, 56 §3.2) — one at a time. Each attempt is recorded keyed by the send's
  // REVISION, so a failure (e.g. over budget) is never retried in a loop, yet a genuine re-edit (a higher
  // revision) IS re-analyzed. The effect re-fires on `results` (each analyze reloads them), walking one send
  // per run — `runAnalyze` is deliberately omitted from the deps (`results` is the real trigger).
  const autoAttempted = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (autoAnalyze !== true || !aiReady) return;
    const next = results.find((r) => {
      if (r.status !== 'submitted') return false;
      const needs = !r.analyzed || r.analysisStale; // never analyzed, or answers changed since
      return needs && !autoAttempted.current.has(`${r.assignmentId}:${r.revision ?? 1}`);
    });
    if (!next) return;
    autoAttempted.current.add(`${next.assignmentId}:${next.revision ?? 1}`);
    void runAnalyze(next.assignmentId);
  }, [results, autoAnalyze, aiReady]);

  // Results is hidden until there's a send (§20.6). Render nothing until the sends have loaded (so the
  // summary band never flashes "0 recipients"), and nothing for the transient empty / all-deleted edge —
  // never a stale empty card.
  if (!loaded || results.length === 0) return <></>;

  const summary = summarizeSends(results);
  const groups = groupSendsByStatus(results);

  return (
    <Stack gap={4}>
      <div className={styles.resultsHead}>
        <Heading level={3}>Results</Heading>
        <Inline gap={2} align="center">
          {hasAnswers ? (
            <>
              <Button variant="secondary" onClick={() => void onExport('csv')} disabled={exporting}>
                <Download size={15} aria-hidden="true" />
                Export CSV
              </Button>
              <Button
                variant="secondary"
                onClick={() => void onExport('json')}
                disabled={exporting}
              >
                <Download size={15} aria-hidden="true" />
                Export JSON
              </Button>
            </>
          ) : null}
          {hasRelayLink ? (
            <Button variant="secondary" onClick={() => void runDrain()} disabled={draining}>
              <RefreshCw size={15} aria-hidden="true" />
              {draining ? 'Checking…' : 'Check for responses'}
            </Button>
          ) : null}
        </Inline>
      </div>

      <ResultsSummaryBand summary={summary} />

      {drainMsg ? <Banner tone="info">{drainMsg}</Banner> : null}
      {exportMsg ? <Banner tone="info">{exportMsg}</Banner> : null}
      {!aiReady ? <AiUnavailableNotice /> : null}

      {/* Per-recipient cards grouped by status (§20.6) — Answered · In progress · Awaiting · Declined · Closed. */}
      {groups.map((group) => (
        <Stack gap={2} key={group.key}>
          <ResultGroupHead label={group.label} count={group.sends.length} />
          {group.sends.map((send) => (
            <SendCard
              key={send.assignmentId}
              send={send}
              aiReady={aiReady}
              senderName={senderName}
              analyzing={analyzing[send.assignmentId] === true}
              message={messages[send.assignmentId]}
              onAnalyze={() => void runAnalyze(send.assignmentId)}
              onDelete={() => void runDelete(send.assignmentId)}
              onRevoke={() => void revoke(send.assignmentId)}
            />
          ))}
        </Stack>
      ))}

      <AtAGlance aggregate={aggregate} />

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

/** A private send's numeric answers as read-only bars (08 §20.8) — the numbers the sender is allowed to
 * see. The value is always shown as text (never colour-only, §9); no written content. */
function PrivateNumericAnswers({ answers }: { answers: SendNumericAnswer[] }): JSX.Element {
  return (
    <Stack gap={1}>
      {answers.map((a, i) => {
        const span = a.max - a.min;
        const pct = span > 0 ? Math.round(((a.value - a.min) / span) * 100) : 0;
        return (
          <div key={`${a.prompt}-${a.row ?? ''}-${i}`} className={styles.glanceRow}>
            <span className={styles.glanceLabel}>
              {a.row ? `${a.prompt} — ${a.row}` : a.prompt}
            </span>
            <span className={styles.glanceTrack}>
              <span
                className={styles.glanceFill}
                style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
              />
            </span>
            <span className={styles.glanceValue}>{a.value}</span>
          </div>
        );
      })}
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
  senderName,
  analyzing,
  message,
  onAnalyze,
  onDelete,
  onRevoke,
}: {
  send: SendResult;
  aiReady: boolean;
  senderName: string;
  analyzing: boolean;
  message: { tone: 'info' | 'warning'; text: string } | undefined;
  onAnalyze: () => void;
  onDelete: () => void;
  onRevoke: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const isSubmitted = send.status === 'submitted';
  const isOpen = OPEN_STATUSES.includes(send.status);
  // A relay link that's still open (not answered / declined / revoked / expired) can be revoked — for an
  // external send AND a household send that also minted a link (§17.13).
  const canRevoke = send.relayLinked && isOpen;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Re-publish / resend (§17.14): an open send can (re-)mint a fresh link + PIN for delivery. Since the PIN
  // is never stored, resharing always mints a NEW one; the old link stops working.
  const [delivery, setDelivery] = useState<RelayLinkResult | null>(null);
  const [resharing, setResharing] = useState(false);
  const [reshareMsg, setReshareMsg] = useState<string | null>(null);

  const runReshare = async (): Promise<void> => {
    if (resharing) return;
    setResharing(true);
    setReshareMsg(null);
    try {
      const result = await window.selfos?.assignmentsReshare(send.assignmentId);
      if (result) setDelivery(result);
      else
        setReshareMsg(
          'Couldn’t create a link — connect a relay in Settings → Relay, then try again.',
        );
    } catch {
      setReshareMsg('Couldn’t create a link. Please try again.');
    } finally {
      setResharing(false);
    }
  };

  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.resultHead}>
          <span className={styles.resultRecipient}>
            <Avatar name={send.recipientName} />
            <Text weight={500}>{send.recipientName}</Text>
          </span>
          <div className={styles.resultHeadRight}>
            <span className={styles.rowBadge}>
              {send.privacy === 'private' ? (
                <Lock size={12} aria-hidden="true" className={styles.privacyIcon} />
              ) : null}
              {STATUS_LABEL[send.status]}
            </span>
            {canRevoke ? (
              <IconButton
                aria-label={`Revoke the link sent to ${send.recipientName}`}
                variant="secondary"
                onClick={onRevoke}
              >
                <Link2Off size={14} aria-hidden="true" />
              </IconButton>
            ) : null}
            <IconButton
              aria-label={`Delete this send to ${send.recipientName}`}
              variant="secondary"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 size={14} aria-hidden="true" />
            </IconButton>
          </div>
        </div>

        {send.relayLinked ? (
          <Text size="sm" tone="secondary">
            {send.channel === 'relay'
              ? 'Sent via a private link.'
              : 'In their Inbox — also answerable via the link you shared.'}
          </Text>
        ) : null}

        {send.expiresAt ? (
          <Text size="sm" tone="secondary">
            {formatLinkExpiry(send.expiresAt)}
          </Text>
        ) : null}

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

        {/* Private submitted send (08 §20.8): a calm privacy explainer + the numeric answers the sender is
            allowed to see (never the written content). */}
        {isSubmitted && !send.answers && send.privacy === 'private' ? (
          <Stack gap={2}>
            <div className={styles.privateNote}>
              <Lock size={14} aria-hidden="true" className={styles.privateNoteIcon} />
              <Text size="sm" tone="secondary">
                {send.analyzed ? 'You see' : 'You’ll see'} the insight drawn from{' '}
                {send.recipientName}’s answers — never the raw answers themselves.
              </Text>
            </div>
            {send.numericAnswers && send.numericAnswers.length > 0 ? (
              <Stack gap={1}>
                <Text size="sm" tone="tertiary">
                  Ratings you can see
                </Text>
                <PrivateNumericAnswers answers={send.numericAnswers} />
              </Stack>
            ) : null}
          </Stack>
        ) : null}

        {/* Standard but the answers couldn't be read (a rare missing/corrupt file) — don't mislabel it as private. */}
        {isSubmitted && !send.answers && send.privacy === 'standard' ? (
          <Text tone="secondary">Couldn’t load these answers.</Text>
        ) : null}

        {/* Analyzed + the recipient edited since (56 §3.2): flag it stale + offer a Re-analyze (the manual path;
            autoAnalyze refreshes it automatically when on). */}
        {isSubmitted && send.analyzed && send.analysisStale ? (
          <Banner tone="warning">
            <Stack gap={2}>
              <Text>
                Answers updated since your last analysis — re-analyze to refresh the insight.
              </Text>
              {aiReady ? (
                <div>
                  <Button variant="secondary" onClick={onAnalyze} disabled={analyzing}>
                    <Sparkles size={16} aria-hidden="true" />
                    {analyzing ? 'Analyzing…' : 'Re-analyze'}
                  </Button>
                </div>
              ) : null}
            </Stack>
          </Banner>
        ) : isSubmitted && send.analyzed && send.insightSummary ? (
          // The drafted Insight, INLINE — the excerpt + a deep-link to the exact insight in Memory (§20.8).
          <InsightExcerpt
            summary={send.insightSummary}
            onViewInMemory={() =>
              navigate(
                '/memory',
                send.insightId ? { state: { insightId: send.insightId } } : undefined,
              )
            }
          />
        ) : isSubmitted && send.analyzed ? (
          <Banner tone="info">
            Insight drafted from this response. <Link to="/memory">Review it in Memory →</Link>
          </Banner>
        ) : null}

        {/* Prominent one-tap Analyze on an un-analyzed submitted send — primary for a Private send (it's the
            only way to see anything from it, §20.8); secondary for a Standard send (whose answers already show). */}
        {isSubmitted && !send.analyzed && aiReady ? (
          <div>
            <Button
              variant={send.privacy === 'private' ? 'primary' : 'secondary'}
              onClick={onAnalyze}
              disabled={analyzing}
            >
              <Sparkles size={16} aria-hidden="true" />
              {analyzing
                ? 'Analyzing…'
                : send.privacy === 'private'
                  ? 'Analyze to see the insight'
                  : 'Analyze'}
            </Button>
          </div>
        ) : null}

        {/* Share / resend a link for an OPEN send (not yet answered). Resharing mints a fresh link + PIN. */}
        {isOpen ? (
          delivery ? (
            <RelayLinkDelivery
              link={delivery.link}
              pin={delivery.pin}
              senderName={senderName}
              sensitive={false}
              note="A fresh link + PIN — the previous link no longer works. Share it now; we don’t keep a copy of the PIN."
              onDone={() => setDelivery(null)}
            />
          ) : (
            <div>
              <Button variant="secondary" onClick={() => void runReshare()} disabled={resharing}>
                <Link2 size={16} aria-hidden="true" />
                {resharing ? 'Creating link…' : send.relayLinked ? 'Resend link' : 'Create a link'}
              </Button>
            </div>
          )
        ) : null}

        {reshareMsg ? <Banner tone="warning">{reshareMsg}</Banner> : null}

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

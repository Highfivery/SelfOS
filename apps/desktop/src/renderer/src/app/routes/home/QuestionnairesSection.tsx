import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ClipboardList,
  Clock,
  Flame,
  Lightbulb,
  MailOpen,
  PartyPopper,
  RefreshCw,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type {
  AnswersUpdatedSummary,
  ReminderDueSummary,
  ResponsesArrivedSummary,
} from '@shared/channels';
import { Button, Card, Markdown, Stack, Text } from '../../../design-system/components';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { useInsightStore } from '../../../stores/insightStore';
import { unansweredCount, useInboxStore } from '../../../stores/inboxStore';
import type { BuilderSeed } from '../questionnaires/QuestionnaireBuilder';
import {
  needsYou,
  questionnaireInsights,
  questionnaireTrend,
  rollupStats,
  unsentTypes,
  type NeedsYouItem,
  type QuestionnaireTrend,
} from './questionnaireDashboard';
import styles from './Home.module.css';

/** Open the builder pre-seeded (the router-state handoff `/questionnaires` reads, 08 §18). */
function useSeededBuilder(): (seed: BuilderSeed) => void {
  const navigate = useNavigate();
  return (seed) => navigate('/questionnaires', { state: { seed } });
}

/**
 * The Home "Questionnaires" section (59-questionnaires-dashboard). A per-active-person, derived-only surface:
 * a stat strip, the few things that need the person now, their latest questionnaire insight, and (as a PUSH,
 * gated by `showIdeas`) smart ideas to create/send next. Composes from stores Home already loaded + three
 * cheap notification reads it loads itself — no per-load AI spend, no raw private answers. Self-hides when the
 * person has nothing yet and can't create.
 */
export function QuestionnairesSection({
  canCreate,
  canViewResults,
  canAnswer,
  configured,
  adultAcknowledged,
  showIdeas,
  subjectPersonId,
}: {
  canCreate: boolean;
  canViewResults: boolean;
  canAnswer: boolean;
  configured: boolean;
  adultAcknowledged: boolean;
  showIdeas: boolean;
  subjectPersonId: string | null;
}): JSX.Element | null {
  const navigate = useNavigate();
  const openSeeded = useSeededBuilder();
  const sentOverview = useQuestionnaireStore((s) => s.sentOverview);
  const questionnaires = useQuestionnaireStore((s) => s.questionnaires);
  const analyze = useQuestionnaireStore((s) => s.analyze);
  const insights = useInsightStore((s) => s.insights);
  const inboxItems = useInboxStore((s) => s.items);

  const [responses, setResponses] = useState<ResponsesArrivedSummary[]>([]);
  const [answerEdits, setAnswerEdits] = useState<AnswersUpdatedSummary[]>([]);
  const [reminders, setReminders] = useState<ReminderDueSummary[]>([]);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // The three questionnaire signals (already gated + derived server-side — empty when not permitted). Reload on
  // the active-person change so one account's actions never linger into another's.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      canViewResults
        ? (window.selfos?.notificationsResponsesArrived?.() ?? Promise.resolve([]))
        : Promise.resolve([]),
      canViewResults
        ? (window.selfos?.notificationsAnswersUpdated?.() ?? Promise.resolve([]))
        : Promise.resolve([]),
      canViewResults
        ? (window.selfos?.notificationsRemindersDue?.() ?? Promise.resolve([]))
        : Promise.resolve([]),
    ]).then(([r, a, rem]) => {
      if (cancelled) return;
      setResponses(r ?? []);
      setAnswerEdits(a ?? []);
      setReminders(rem ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [subjectPersonId, canViewResults]);

  if (!canCreate && !canAnswer) return null;

  const rollup = rollupStats(sentOverview);
  const insightRollup = questionnaireInsights(insights, subjectPersonId);
  const trend = questionnaireTrend(insights, subjectPersonId);
  const inboxCount = unansweredCount(inboxItems);
  const actions = needsYou({
    sentOverview,
    responsesArrived: responses,
    answersUpdated: answerEdits,
    remindersDue: reminders,
    inboxCount,
    canAnswer,
  });
  const unsent = unsentTypes(questionnaires, sentOverview);

  const hasAnything =
    rollup.sentCount > 0 || inboxCount > 0 || insightRollup.count > 0 || actions.length > 0;

  // Nothing yet: a warm one-line invitation to send the first questionnaire (never an empty grid). If the
  // person can't even create, there's genuinely nothing to show.
  if (!hasAnything) {
    if (!canCreate) return null;
    return (
      <Card>
        <div className={styles.qSectionHead}>
          <ClipboardList size={18} aria-hidden="true" />
          <h2 className={styles.sectionTitle}>Questionnaires</h2>
        </div>
        <Stack gap={3}>
          <Text tone="secondary">
            Learn what someone really thinks — send a questionnaire and turn the answers into
            insight.
          </Text>
          <div>
            <Button variant="primary" onClick={() => navigate('/questionnaires')}>
              Create your first questionnaire
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </div>
        </Stack>
      </Card>
    );
  }

  const runAnalyze = async (assignmentId: string): Promise<void> => {
    setAnalyzingId(assignmentId);
    setAnalyzeError(null);
    const result = await analyze(assignmentId);
    setAnalyzingId(null);
    if (!result.ok) setAnalyzeError(result.message ?? 'Analysis is unavailable right now.');
  };

  const ideas = buildIdeas({ canCreate, configured, adultAcknowledged, unsent });

  return (
    <section className={styles.qSection} aria-label="Questionnaires">
      <div className={styles.qSectionHead}>
        <ClipboardList size={18} aria-hidden="true" />
        <h2 className={styles.sectionTitle}>Questionnaires</h2>
        {canCreate ? (
          <button
            type="button"
            className={styles.cardLink}
            onClick={() => navigate('/questionnaires')}
          >
            Create
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/* Stat strip — each tile omitted when its value is zero (never a wall of zeros). */}
      <div className={styles.qStats}>
        {rollup.sentCount > 0 ? (
          <StatTile
            label="Sent"
            value={String(rollup.sentCount)}
            onClick={() => navigate('/questionnaires')}
          />
        ) : null}
        {rollup.totalSends > 0 ? (
          <StatTile
            label="Response rate"
            value={`${Math.round(rollup.responseRate * 100)}%`}
            onClick={() => navigate('/questionnaires')}
          />
        ) : null}
        {rollup.newReplies > 0 ? (
          <StatTile
            label="New replies"
            value={String(rollup.newReplies)}
            accent
            onClick={() => navigate('/questionnaires')}
          />
        ) : null}
        {insightRollup.count > 0 ? (
          <StatTile
            label="Insights"
            value={String(insightRollup.count)}
            onClick={() => navigate('/memory')}
          />
        ) : null}
      </div>

      {/* Needs you */}
      {actions.length > 0 ? (
        <Stack gap={2}>
          <Text size="xs" tone="tertiary">
            Needs you
          </Text>
          {actions.map((item) => (
            <NeedsYouRow
              key={needsYouKey(item)}
              item={item}
              analyzing={analyzingId}
              onAnalyze={runAnalyze}
              onAnswer={() => navigate('/inbox')}
              onResend={() => navigate('/questionnaires')}
            />
          ))}
          {analyzeError ? <span className={styles.qError}>{analyzeError}</span> : null}
        </Stack>
      ) : null}

      {/* Latest insight + a trend forming — a two-up row, each half self-hiding. */}
      {insightRollup.latest || trend ? (
        <div className={styles.qInsightRow}>
          {insightRollup.latest ? (
            <div className={styles.qInsight}>
              <div className={styles.qEyebrow}>
                <Lightbulb size={13} aria-hidden="true" />
                {insightRollup.latest.aboutName
                  ? `Latest insight · from ${insightRollup.latest.aboutName}`
                  : 'Latest insight'}
              </div>
              <Markdown inline className={styles.factText}>
                {insightRollup.latest.summary}
              </Markdown>
              <button
                type="button"
                className={styles.cardLink}
                onClick={() =>
                  navigate('/memory', { state: { insightId: insightRollup.latest?.id } })
                }
              >
                View in Memory
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {trend ? (
            <div className={styles.qInsight}>
              <div className={styles.qEyebrow}>
                <TrendingUp size={13} aria-hidden="true" />A trend forming
              </div>
              <span className={styles.factText}>{describeTrend(trend)}</span>
              <button
                type="button"
                className={styles.cardLink}
                onClick={() => navigate('/questionnaires')}
              >
                See trends
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Ideas for you — a PUSH surface, shown only when encouragement is on (§7). */}
      {showIdeas && ideas.length > 0 ? (
        <Stack gap={2}>
          <Text size="xs" tone="tertiary">
            Ideas for you
          </Text>
          <div className={styles.qIdeas}>
            {ideas.map((idea) => (
              <IdeaCard
                key={idea.kind}
                idea={idea}
                onGoDeeper={() => navigate('/questionnaires')}
                onSeed={openSeeded}
              />
            ))}
          </div>
        </Stack>
      ) : null}
    </section>
  );
}

function StatTile({
  label,
  value,
  accent,
  onClick,
}: {
  label: string;
  value: string;
  accent?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`${styles.qStat} ${accent ? styles.qStatAccent : ''}`}
      onClick={onClick}
    >
      <span className={styles.qStatLabel}>{label}</span>
      <span className={styles.qStatValue}>{value}</span>
    </button>
  );
}

/** A calm, neutral one-liner for the trend card (direction only — never a value judgement). */
function describeTrend(trend: QuestionnaireTrend): string {
  const move =
    trend.direction === 'up'
      ? 'trending up'
      : trend.direction === 'down'
        ? 'trending down'
        : 'holding steady';
  return `Across ${trend.points} check-ins, ${trend.label} is ${move}.`;
}

function needsYouKey(item: NeedsYouItem): string {
  switch (item.kind) {
    case 'answer':
      return 'answer';
    case 'resend':
      return `resend:${item.questionnaireId}`;
    default:
      return `${item.kind}:${item.assignmentId}`;
  }
}

function NeedsYouRow({
  item,
  analyzing,
  onAnalyze,
  onAnswer,
  onResend,
}: {
  item: NeedsYouItem;
  analyzing: string | null;
  onAnalyze: (assignmentId: string) => void;
  onAnswer: () => void;
  onResend: () => void;
}): JSX.Element {
  if (item.kind === 'answer') {
    return (
      <ActionRow
        icon={<MailOpen size={16} aria-hidden="true" />}
        line={
          item.count === 1
            ? '1 questionnaire waiting for you to answer'
            : `${item.count} questionnaires waiting for you to answer`
        }
        action={
          <Button variant="secondary" size="sm" onClick={onAnswer}>
            Answer
          </Button>
        }
      />
    );
  }
  if (item.kind === 'resend') {
    return (
      <ActionRow
        icon={<Clock size={16} aria-hidden="true" />}
        line={`Still waiting on ${item.recipientName}`}
        sub={`“${item.title}”`}
        action={
          <Button variant="secondary" size="sm" onClick={onResend}>
            Resend
          </Button>
        }
      />
    );
  }
  // analyze | reAnalyze
  const busy = analyzing === item.assignmentId;
  const line =
    item.kind === 'analyze'
      ? `${item.recipientName} answered`
      : `${item.recipientName} edited their answers`;
  return (
    <ActionRow
      icon={
        item.kind === 'analyze' ? (
          <Sparkles size={16} aria-hidden="true" />
        ) : (
          <RefreshCw size={16} aria-hidden="true" />
        )
      }
      line={line}
      sub={`“${item.title}”`}
      action={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onAnalyze(item.assignmentId)}
          disabled={busy}
        >
          {busy ? 'Analysing…' : item.kind === 'analyze' ? 'Analyse' : 'Re-analyze'}
        </Button>
      }
    />
  );
}

function ActionRow({
  icon,
  line,
  sub,
  action,
}: {
  icon: JSX.Element;
  line: string;
  sub?: string;
  action: JSX.Element;
}): JSX.Element {
  return (
    <div className={styles.qActionRow}>
      <span className={styles.qActionIcon}>{icon}</span>
      <div className={styles.qActionText}>
        <span className={styles.qActionLine}>{line}</span>
        {sub ? <span className={styles.qActionSub}>{sub}</span> : null}
      </div>
      {action}
    </div>
  );
}

type Idea =
  | { kind: 'goDeeper' }
  | { kind: 'variety'; label: string; type: string }
  | { kind: 'fun' }
  | { kind: 'spicy' };

/** Rank up to three "Ideas for you" (§3.5): go-deeper (AI), a variety nudge, a fun draft, an 18+ spicy draft. */
function buildIdeas(input: {
  canCreate: boolean;
  configured: boolean;
  adultAcknowledged: boolean;
  unsent: { value: string; label: string }[];
}): Idea[] {
  if (!input.canCreate) return [];
  const ideas: Idea[] = [];
  if (input.configured) ideas.push({ kind: 'goDeeper' });
  if (input.adultAcknowledged) ideas.push({ kind: 'spicy' });
  const firstUnsent = input.unsent[0];
  if (firstUnsent)
    ideas.push({ kind: 'variety', label: firstUnsent.label, type: firstUnsent.value });
  ideas.push({ kind: 'fun' });
  return ideas.slice(0, 3);
}

function IdeaCard({
  idea,
  onGoDeeper,
  onSeed,
}: {
  idea: Idea;
  onGoDeeper: () => void;
  onSeed: (seed: BuilderSeed) => void;
}): JSX.Element {
  if (idea.kind === 'goDeeper') {
    return (
      <IdeaShell
        icon={<Sparkles size={16} aria-hidden="true" />}
        eyebrow="Go deeper"
        title="Ask someone the next question"
        blurb="Let the coach suggest a questionnaire tailored to someone in your circle."
        cta="Get a suggestion"
        onClick={onGoDeeper}
      />
    );
  }
  if (idea.kind === 'spicy') {
    return (
      <IdeaShell
        icon={<Flame size={16} aria-hidden="true" />}
        eyebrow="Spicy · 18+"
        tone="danger"
        title="A flirty, explicit questionnaire"
        blurb="Explore desire and fantasies together — draft it with AI, then edit."
        cta="Explore"
        onClick={() =>
          onSeed({
            title: '',
            type: 'intimacy',
            sensitivity: 'explicit',
            questions: [],
            brief:
              'A flirty, explicit questionnaire about our desires and fantasies — playful and honest.',
          })
        }
      />
    );
  }
  if (idea.kind === 'variety') {
    return (
      <IdeaShell
        icon={<Lightbulb size={16} aria-hidden="true" />}
        eyebrow="Try something new"
        title={idea.label}
        blurb="You haven’t sent this kind yet — a fresh angle on someone you know."
        cta="Start it"
        onClick={() => onSeed({ title: '', type: idea.type, questions: [] })}
      />
    );
  }
  return (
    <IdeaShell
      icon={<PartyPopper size={16} aria-hidden="true" />}
      eyebrow="Just for fun"
      title="A playful this-or-that"
      blurb="A light, fun questionnaire to send a friend or partner."
      cta="Try it"
      onClick={() =>
        onSeed({
          title: '',
          type: 'scenario',
          questions: [],
          brief:
            'A light, playful questionnaire — fun this-or-that and would-you-rather questions to enjoy together.',
        })
      }
    />
  );
}

function IdeaShell({
  icon,
  eyebrow,
  tone,
  title,
  blurb,
  cta,
  onClick,
}: {
  icon: JSX.Element;
  eyebrow: string;
  tone?: 'danger';
  title: string;
  blurb: string;
  cta: string;
  onClick: () => void;
}): JSX.Element {
  const toneClass = tone === 'danger' ? styles.qIdeaDanger : '';
  return (
    <div className={styles.qIdea}>
      <div className={`${styles.qIdeaEyebrow} ${toneClass}`}>
        {icon}
        <span>{eyebrow}</span>
      </div>
      <span className={styles.qIdeaTitle}>{title}</span>
      <Text size="sm" tone="secondary">
        {blurb}
      </Text>
      <button type="button" className={styles.cardLink} onClick={onClick}>
        {cta}
        <ArrowRight size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

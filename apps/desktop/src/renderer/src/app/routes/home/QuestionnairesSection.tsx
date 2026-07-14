import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ClipboardList,
  Clock,
  Flame,
  Heart,
  MailOpen,
  MessageCircle,
  Moon,
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
import { useDreamPatternStore } from '../../../stores/dreamPatternStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { unansweredCount, useInboxStore } from '../../../stores/inboxStore';
import { Avatar } from '../questionnaires/Avatar';
import type { BuilderSeed } from '../questionnaires/QuestionnaireBuilder';
import {
  engagementSummary,
  goDeeperThemes,
  needsYou,
  questionnaireInsights,
  questionnaireTrend,
  richInsights,
  rollupStats,
  sentTypeCount,
  STARTER_TYPE_COUNT,
  unsentTypes,
  type GoDeeperTheme,
  type NeedsYouItem,
  type QuestionnaireTrend,
  type RichInsight,
} from './questionnaireDashboard';
import styles from './Home.module.css';

/** Open the builder pre-seeded (the router-state handoff `/questionnaires` reads, 08 §18). */
function useSeededBuilder(): (seed: BuilderSeed) => void {
  const navigate = useNavigate();
  return (seed) => navigate('/questionnaires', { state: { seed } });
}

/**
 * The Home "Questionnaires" section (59-questionnaires-dashboard) — a rich, per-active-person, derived-only
 * surface that makes questionnaires inviting: a warm engagement banner, contextual stats, the few things that
 * need the person now, insights that name who they're FOR and ABOUT, "go deeper" threads pulled from recent
 * sessions/dreams/Together, prominent fun + 18+ spicy prompts, and type coverage. Composes from stores Home
 * already loaded + three cheap notification reads it loads itself — no per-load AI spend, no raw private answers.
 */
export function QuestionnairesSection({
  canCreate,
  canViewResults,
  canAnswer,
  adultAcknowledged,
  showIdeas,
  subjectPersonId,
  togetherPartnerName,
}: {
  canCreate: boolean;
  canViewResults: boolean;
  canAnswer: boolean;
  adultAcknowledged: boolean;
  showIdeas: boolean;
  subjectPersonId: string | null;
  togetherPartnerName?: string;
}): JSX.Element | null {
  const navigate = useNavigate();
  const openSeeded = useSeededBuilder();
  const sentOverview = useQuestionnaireStore((s) => s.sentOverview);
  const questionnaires = useQuestionnaireStore((s) => s.questionnaires);
  const analyze = useQuestionnaireStore((s) => s.analyze);
  const insights = useInsightStore((s) => s.insights);
  const inboxItems = useInboxStore((s) => s.items);
  const dreamStats = useDreamPatternStore((s) => s.stats);
  const people = usePeopleStore((s) => s.people);

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
  const fresh = richInsights(sentOverview, questionnaires, insights, people, subjectPersonId);
  const trend = questionnaireTrend(insights, subjectPersonId);
  const engagement = engagementSummary(insights, people, sentOverview, subjectPersonId);
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
  const sessionInsights = insights.filter(
    (i) => i.source === 'session' && i.approved && i.subjectPersonId === subjectPersonId,
  );
  const themes = goDeeperThemes({
    sessionInsights,
    dreamSymbols: dreamStats?.symbols ?? [],
    ...(togetherPartnerName ? { togetherPartnerName } : {}),
  });
  const triedTypes = sentTypeCount(questionnaires, sentOverview);

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

  const bannerLine = engagementLine(engagement);

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

      {/* Engagement banner — a warm, personal reflection of what you've learned + who to ask next. */}
      {bannerLine ? (
        <div className={styles.qBanner}>
          <Sparkles size={18} aria-hidden="true" />
          <span>{bannerLine}</span>
        </div>
      ) : null}

      {/* Stat strip — each tile omitted when its value is zero, with a bit of context under the number. */}
      <div className={styles.qStats}>
        {rollup.sentCount > 0 ? (
          <StatTile
            label="Sent"
            value={String(rollup.sentCount)}
            sub={rollup.sentCount === 1 ? 'questionnaire' : 'questionnaires'}
            onClick={() => navigate('/questionnaires')}
          />
        ) : null}
        {rollup.totalSends > 0 ? (
          <StatTile
            label="Response rate"
            value={`${Math.round(rollup.responseRate * 100)}%`}
            sub={`${rollup.answeredSends} of ${rollup.totalSends} answered`}
            onClick={() => navigate('/questionnaires')}
          />
        ) : null}
        {rollup.newReplies > 0 ? (
          <StatTile
            label="New replies"
            value={String(rollup.newReplies)}
            sub="ready to analyse"
            accent
            onClick={() => navigate('/questionnaires')}
          />
        ) : null}
        {insightRollup.count > 0 ? (
          <StatTile
            label="Insights"
            value={String(insightRollup.count)}
            sub={
              engagement.peopleCount === 1
                ? 'about 1 person'
                : `about ${engagement.peopleCount} people`
            }
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

      {/* Fresh insights — who they're about + which questionnaire + the finding + its life-area. */}
      {fresh.length > 0 ? (
        <Stack gap={2}>
          <Text size="xs" tone="tertiary">
            Fresh insights
          </Text>
          <div className={styles.qInsightRow}>
            {fresh.map((ins) => (
              <RichInsightCard
                key={ins.insightId}
                insight={ins}
                onOpen={() => navigate('/memory', { state: { insightId: ins.insightId } })}
              />
            ))}
          </div>
          {trend ? (
            <button
              type="button"
              className={styles.qTrendLine}
              onClick={() => navigate('/questionnaires')}
            >
              <TrendingUp size={14} aria-hidden="true" />
              {describeTrend(trend)}
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          ) : null}
        </Stack>
      ) : null}

      {/* Go deeper — threads from recent sessions / dreams / Together (a PUSH). */}
      {showIdeas && canCreate && themes.length > 0 ? (
        <Stack gap={2}>
          <div>
            <Text size="xs" tone="tertiary">
              Go deeper — from your recent activity
            </Text>
          </div>
          <Stack gap={2}>
            {themes.map((theme) => (
              <GoDeeperRow key={theme.kind} theme={theme} onSeed={openSeeded} />
            ))}
          </Stack>
        </Stack>
      ) : null}

      {/* Fun + spicy — prominent, inviting (a PUSH). Spicy is 18+-gated. */}
      {showIdeas && canCreate ? (
        <Stack gap={2}>
          <Text size="xs" tone="tertiary">
            For fun · for the two of you
          </Text>
          <div className={styles.qIdeas}>
            <FunBand
              onClick={() =>
                openSeeded({
                  title: '',
                  type: 'scenario',
                  questions: [],
                  brief:
                    'A light, playful questionnaire — fun this-or-that and would-you-rather questions to enjoy together.',
                })
              }
            />
            {adultAcknowledged ? (
              <SpicyBand
                onClick={() =>
                  openSeeded({
                    title: '',
                    type: 'intimacy',
                    sensitivity: 'explicit',
                    questions: [],
                    brief:
                      'A flirty, explicit questionnaire about our desires and fantasies — playful and honest.',
                  })
                }
              />
            ) : null}
          </div>
        </Stack>
      ) : null}

      {/* Explore more types — coverage + a nudge toward a type you haven't sent (a PUSH). */}
      {showIdeas && canCreate ? (
        <Stack gap={2}>
          <div className={styles.qCoverageHead}>
            <Text size="xs" tone="tertiary">
              Explore more types
            </Text>
            <Text size="xs" tone="tertiary">
              {triedTypes} of {STARTER_TYPE_COUNT} tried
            </Text>
          </div>
          <div className={styles.qTypeChips}>
            {unsent.slice(0, 4).map((t) => (
              <button
                key={t.value}
                type="button"
                className={styles.qTypeChip}
                onClick={() => openSeeded({ title: '', type: t.value, questions: [] })}
              >
                {t.label}
              </button>
            ))}
            <button
              type="button"
              className={styles.qTypeChip}
              onClick={() => navigate('/questionnaires')}
            >
              + New type
            </button>
          </div>
        </Stack>
      ) : null}
    </section>
  );
}

/** The warm banner line, or null when there's nothing worth saying. */
function engagementLine(e: ReturnType<typeof engagementSummary>): string | null {
  const parts: string[] = [];
  if (e.insightCount > 0) {
    const insights = e.insightCount === 1 ? '1 insight' : `${e.insightCount} insights`;
    const people = e.peopleCount === 1 ? '1 person' : `${e.peopleCount} people`;
    parts.push(`You've gathered ${insights} about ${people}.`);
  }
  if (e.notAsked.length > 0) {
    const who = e.notAsked.slice(0, 2).join(' and ');
    parts.push(`You haven't asked ${who} anything yet.`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

function StatTile({
  label,
  value,
  sub,
  accent,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
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
      <span className={styles.qStatSub}>{sub}</span>
    </button>
  );
}

/** A calm, neutral one-liner for the trend line (direction only — never a value judgement). */
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
        avatar={<AvatarIcon icon={<MailOpen size={16} aria-hidden="true" />} />}
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
        avatar={<AvatarIcon icon={<Clock size={16} aria-hidden="true" />} />}
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
  const busy = analyzing === item.assignmentId;
  const line =
    item.kind === 'analyze'
      ? `${item.recipientName} answered`
      : `${item.recipientName} edited their answers`;
  return (
    <ActionRow
      avatar={
        item.kind === 'analyze' ? (
          <Avatar name={item.recipientName} />
        ) : (
          <AvatarIcon icon={<RefreshCw size={16} aria-hidden="true" />} />
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

function AvatarIcon({ icon }: { icon: JSX.Element }): JSX.Element {
  return <span className={styles.qAvatarIcon}>{icon}</span>;
}

function ActionRow({
  avatar,
  line,
  sub,
  action,
}: {
  avatar: JSX.Element;
  line: string;
  sub?: string;
  action: JSX.Element;
}): JSX.Element {
  return (
    <div className={styles.qActionRow}>
      {avatar}
      <div className={styles.qActionText}>
        <span className={styles.qActionLine}>{line}</span>
        {sub ? <span className={styles.qActionSub}>{sub}</span> : null}
      </div>
      {action}
    </div>
  );
}

function RichInsightCard({
  insight,
  onOpen,
}: {
  insight: RichInsight;
  onOpen: () => void;
}): JSX.Element {
  const context = insight.aboutName
    ? `About ${insight.aboutName} · from “${insight.title}”`
    : `From your answers to “${insight.title}”`;
  return (
    <div className={styles.qInsight}>
      <div className={styles.qInsightHead}>
        <Avatar name={insight.aboutName ?? 'You'} />
        <span className={styles.qInsightContext}>{context}</span>
      </div>
      <Markdown inline className={styles.factText}>
        {insight.summary}
      </Markdown>
      <div className={styles.qInsightMeta}>
        {insight.area ? <span className={styles.qAreaChip}>{insight.area}</span> : null}
        <button type="button" className={styles.cardLink} onClick={onOpen}>
          View in Memory
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function GoDeeperRow({
  theme,
  onSeed,
}: {
  theme: GoDeeperTheme;
  onSeed: (seed: BuilderSeed) => void;
}): JSX.Element {
  const { icon, line, source, brief, cta, accent } = goDeeperCopy(theme);
  return (
    <div className={`${styles.qActionRow} ${accent ? styles.qActionRowAccent : ''}`}>
      <span className={styles.qActionIcon}>{icon}</span>
      <div className={styles.qActionText}>
        <span className={styles.qActionLine}>{line}</span>
        <span className={styles.qActionSub}>{source}</span>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onSeed({ title: '', type: 'general', questions: [], brief })}
      >
        {cta}
      </Button>
    </div>
  );
}

function goDeeperCopy(theme: GoDeeperTheme): {
  icon: JSX.Element;
  line: string;
  source: string;
  brief: string;
  cta: string;
  accent: boolean;
} {
  if (theme.kind === 'session') {
    const area = theme.area.toLowerCase();
    return {
      icon: <MessageCircle size={18} aria-hidden="true" />,
      line: `You've been reflecting on ${area} lately — get someone else's view.`,
      source: 'From your Sessions',
      brief: `how someone close to me sees ${area}, and what they'd want me to know`,
      cta: 'Draft it',
      accent: true,
    };
  }
  if (theme.kind === 'dream') {
    return {
      icon: <Moon size={18} aria-hidden="true" />,
      line: `Your recurring dream about ${theme.symbol} keeps surfacing — explore what it stirs up.`,
      source: 'From your Dreams',
      brief: `feelings, memories, and associations around ${theme.symbol}`,
      cta: 'Explore',
      accent: false,
    };
  }
  return {
    icon: <Heart size={18} aria-hidden="true" />,
    line: `You and ${theme.partnerName} could use a gentle check-in.`,
    source: 'From Together',
    brief: `a warm check-in with ${theme.partnerName} about how we're doing and what we each need more of`,
    cta: 'Check in',
    accent: false,
  };
}

function FunBand({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button type="button" className={`${styles.qBand} ${styles.qBandFun}`} onClick={onClick}>
      <span className={styles.qBandEyebrow}>
        <PartyPopper size={15} aria-hidden="true" /> Just for fun
      </span>
      <span className={styles.qBandTitle}>This-or-that showdown</span>
      <span className={styles.qBandBlurb}>A light, playful game to send a friend or partner.</span>
    </button>
  );
}

function SpicyBand({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button type="button" className={`${styles.qBand} ${styles.qBandSpicy}`} onClick={onClick}>
      <span className={`${styles.qBandEyebrow} ${styles.qBandEyebrowDanger}`}>
        <Flame size={15} aria-hidden="true" /> Spice it up · 18+
      </span>
      <span className={styles.qBandTitle}>Yes / No / Maybe, together</span>
      <span className={styles.qBandBlurb}>
        A flirty questionnaire about desire and fantasies, for you and a partner.
      </span>
    </button>
  );
}

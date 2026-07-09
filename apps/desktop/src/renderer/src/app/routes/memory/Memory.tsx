import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Brain,
  ClipboardList,
  LineChart as LineChartIcon,
  MessageCircle,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import type { Insight, Relationship } from '@shared/schemas';
import { availableRelationshipTypesFor } from '../../availableRelationshipTypes';
import { useInsightStore } from '../../../stores/insightStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { aiUnavailableMessage } from '../../AiUnavailableNotice';
import { useLocation, useNavigate } from 'react-router-dom';
import { useConversationStore } from '../../../stores/conversationStore';
import { useDreamStore } from '../../../stores/dreamStore';
import {
  Banner,
  Button,
  Card,
  Heading,
  LineChart,
  Markdown,
  Stack,
  Text,
  TextInput,
} from '../../../design-system/components';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { InsightCard } from './InsightCard';
import { InsightRow } from './InsightRow';
import { LifeAreaTile } from './LifeAreaTile';
import { areaIcon } from './lifeAreaIcons';
import { confidenceStats, overviewStats } from './stats';
import { confidenceLabel, knowsYouRead, summarizeAreas } from './overview';
import { buildTrendSeries } from './trends';
import styles from './Memory.module.css';

/** Where a "back" from the insight detail returns to. */
type BackTarget =
  | { name: 'overview' }
  | { name: 'area'; area: string }
  | { name: 'review' }
  | { name: 'responses' };

type View =
  | { name: 'overview' }
  | { name: 'area'; area: string }
  | { name: 'insight'; insightId: string; back: BackTarget }
  | { name: 'review' }
  | { name: 'responses' };

/** A calm relative date for the "Memory last tidied …" signal (39 §3.2). */
function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';
  const days = Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function matchesText(insight: Insight, q: string): boolean {
  const hay = [insight.summary, ...insight.facts.map((f) => f.text)].join(' ').toLowerCase();
  return hay.includes(q);
}

/**
 * "Memory" — the active person's overview of what SelfOS understands about them
 * (20 → 44 → 54 → 57-memory-overview-redesign). Overview-first: a portrait hero + a "how well it knows you"
 * read, a slim review callout, and a **life-area tile map** you drill into (a life-area → a single insight,
 * where Edit / correct / scope / provenance live). Purely "about you" — Goals live at /goals (57 §3.7); the
 * partner relationship synthesis + the outbound-sharing surface live at /sharing (57 §3.8). No AI spend here:
 * the portrait reuses the onboarding-portrait insight; the "knows you" read + gists are deterministic (§4).
 */
export function Memory(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const insights = useInsightStore((s) => s.insights);
  const loaded = useInsightStore((s) => s.loaded);
  const load = useInsightStore((s) => s.load);
  const refresh = useInsightStore((s) => s.refresh);
  const people = usePeopleStore((s) => s.people);
  const loadPeople = usePeopleStore((s) => s.load);
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);
  const canManageAi = useSessionStore((s) => s.can('settings.manage'));
  const canStartSession = useSessionStore((s) => s.can('sessions.own'));
  const conversations = useConversationStore((s) => s.conversations);
  const dreams = useDreamStore((s) => s.dreams);
  const lastReconciledAt = useInsightStore((s) => s.lastReconciledAt);
  const proposals = useInsightStore((s) => s.proposals);
  const loadReconcileState = useInsightStore((s) => s.loadReconcileState);
  const resolveProposal = useInsightStore((s) => s.resolveProposal);

  const [view, setView] = useState<View>({ name: 'overview' });
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [relationships, setRelationships] = useState<Relationship[]>([]);

  useEffect(() => {
    void load();
    void loadPeople();
    void loadReconcileState();
    void window.selfos?.relationshipsList?.().then((rels) => setRelationships(rels ?? []));
  }, [load, loadPeople, loadReconcileState]);

  // Reset to the overview on a fresh navigation to Memory (the nav link) or an active-person change
  // (57 §3.6) — so a drill-down never persists across leaving + returning.
  useEffect(() => {
    setView({ name: 'overview' });
    setQuery('');
  }, [activePersonId, location.key]);

  const availableTypes = useMemo(
    () => availableRelationshipTypesFor(activePersonId, relationships),
    [activePersonId, relationships],
  );

  const liveConversationIds = useMemo(
    () => new Set(conversations.map((c) => c.id)),
    [conversations],
  );
  const liveDreamIds = useMemo(() => new Set(dreams.map((d) => d.id)), [dreams]);

  // A session/dream insight whose source no longer exists shows "original source removed" (§3.3/§3.7).
  const sourceRemoved = (insight: Insight): boolean => {
    if (insight.source === 'session' && insight.provenance.conversationId)
      return !liveConversationIds.has(insight.provenance.conversationId);
    if (insight.source === 'dream' && insight.provenance.dreamId)
      return !liveDreamIds.has(insight.provenance.dreamId);
    return false;
  };

  // Only the person's OWN insights are ever displayed (54): related shared facts feed the AI's context, never
  // shown raw. Goals + the partner synthesis live elsewhere now (57).
  const own = insights.filter((i) => i.subjectPersonId === activePersonId);
  const drafts = own.filter((i) => !i.approved);
  const approvedOwn = own.filter((i) => i.approved);

  // Who a sent-questionnaire insight is ABOUT (#129): the recipient of a questionnaire you sent. Their facts
  // describe THEIR answers, so these get their own "responses" section, not the life-area cards.
  const responseAbout = (insight: Insight): { key: string; name: string } | null => {
    if (insight.source !== 'questionnaire') return null;
    const pid = insight.provenance.aboutPersonId;
    if (pid) return { key: pid, name: people.find((p) => p.id === pid)?.displayName ?? 'someone' };
    const name = insight.provenance.aboutName;
    return name ? { key: `ext:${name}`, name } : null;
  };

  const responseInsights = approvedOwn.filter((i) => responseAbout(i) !== null);
  const aboutYouApproved = approvedOwn.filter((i) => responseAbout(i) === null);

  // Deep-link from a Sent questionnaire card's "View in Memory" (08 §3.1): open the exact insight once
  // insights are loaded, with a back target matching where it lives (a response → Responses, else the
  // overview). Declared AFTER the reset-to-overview effect so it wins on the same navigation; a plain
  // nav-link visit carries no state and stays on the overview. Deliberately keyed on `loaded` (not the
  // insight lists — fresh arrays every render) so it fires once per navigation, or again when the
  // per-person load completes.
  useEffect(() => {
    const id = (location.state as { insightId?: string } | null)?.insightId;
    if (!id || !loaded) return;
    const insight = own.find((i) => i.id === id);
    // Not this person's insight (a person switch re-fires this with the OLD state — 57 §3.6 says a
    // drill-down never survives a switch) or since deleted → stay on the overview, never a dead end.
    if (!insight) return;
    const back: BackTarget = responseAbout(insight) ? { name: 'responses' } : { name: 'overview' };
    setView({ name: 'insight', insightId: id, back });
  }, [activePersonId, location.key, loaded]);

  // Group responses by recipient (name), for the responses view.
  const recipientGroups = useMemo(() => {
    const byRecipient = new Map<string, { key: string; name: string; insights: Insight[] }>();
    for (const insight of responseInsights) {
      const about = responseAbout(insight);
      if (!about) continue;
      const entry = byRecipient.get(about.key) ?? {
        key: about.key,
        name: about.name,
        insights: [],
      };
      entry.insights.push(insight);
      byRecipient.set(about.key, entry);
    }
    return [...byRecipient.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [responseInsights, people]);

  const areas = useMemo(() => summarizeAreas(aboutYouApproved), [aboutYouApproved]);
  const overview = overviewStats(aboutYouApproved);
  const knows = knowsYouRead(confidenceStats(aboutYouApproved));
  // The onboarding portrait can be a long essay — the hero shows only a short lead (first paragraph, capped);
  // "Read full portrait" opens the insight where the whole thing (+ its grouped facts) lives.
  const portraitInsight = approvedOwn.find((i) => i.source === 'intake');
  const portraitFull = portraitInsight?.summary?.trim() ?? '';
  const portraitLead = ((): string => {
    const firstPara = portraitFull.split(/\n{2,}/)[0]?.trim() ?? '';
    if (firstPara.length <= 320) return firstPara;
    return `${firstPara.slice(0, 320).replace(/\s+\S*$/, '')}…`;
  })();
  const hasMorePortrait = portraitInsight != null && portraitFull.length > portraitLead.length;
  const trendSeries = activePersonId ? buildTrendSeries(insights, activePersonId) : [];
  const responseCount = responseInsights.length;

  const q = query.trim().toLowerCase();
  const searchResults = q ? approvedOwn.filter((i) => matchesText(i, q)) : [];

  const anyOwn = own.length > 0;
  const reviewCount = drafts.length + proposals.length;

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    setRefreshNote(null);
    try {
      const result = await refresh();
      if (result.ok) {
        const proposed = result.proposedCount ?? 0;
        setRefreshNote(
          `Memory refreshed — ${result.reconciledCount ?? 0} updated${proposed ? `, ${proposed} to review` : ''}.`,
        );
      } else if (result.reason === 'AI_OFF' || result.reason === 'NO_KEY') {
        setRefreshNote(aiUnavailableMessage({ canManageAi }));
      } else if (result.reason === 'BUDGET') {
        setRefreshNote('AI budget reached for this period.');
      } else if (result.reason === 'NOTHING_TO_DO') {
        setRefreshNote('Nothing to refresh yet.');
      } else {
        setRefreshNote('Couldn’t refresh memory. Please try again.');
      }
    } finally {
      setRefreshing(false);
    }
  };

  const openInsight = (insightId: string, back: BackTarget): void =>
    setView({ name: 'insight', insightId, back });

  const findInsight = (id: string): Insight | undefined => own.find((i) => i.id === id);

  const renderInsightCard = (insight: Insight): JSX.Element => {
    const about = responseAbout(insight);
    return (
      <InsightCard
        insight={insight}
        subjectName="you"
        isOwn
        sourceRemoved={sourceRemoved(insight)}
        {...(about ? { aboutName: about.name } : {})}
        {...(availableTypes ? { availableTypes } : {})}
      />
    );
  };

  const back = (target: BackTarget): void => setView(target);

  // ── Drill-down views ───────────────────────────────────────────────────────
  const renderArea = (area: string): JSX.Element => {
    const summary = areas.find((a) => a.area === area);
    const list = summary?.insights ?? [];
    const Icon = areaIcon(area);
    return (
      <Stack gap={3}>
        <button type="button" className={styles.back} onClick={() => back({ name: 'overview' })}>
          <ArrowLeft size={15} aria-hidden="true" /> Memory
        </button>
        <div className={styles.areaHead}>
          <span className={styles.areaChip}>
            <Icon size={22} aria-hidden="true" />
          </span>
          <div>
            <Heading level={2}>{area}</Heading>
            <Text size="sm" tone="tertiary">
              {summary?.factCount ?? 0} {(summary?.factCount ?? 0) === 1 ? 'thing' : 'things'}{' '}
              SelfOS knows · {confidenceLabel(summary?.confidenceLevel ?? 1)}
            </Text>
          </div>
        </div>
        <div className={styles.insightList}>
          {list.map((insight) => (
            <InsightRow
              key={insight.id}
              insight={insight}
              onOpen={() => openInsight(insight.id, { name: 'area', area })}
            />
          ))}
        </div>
      </Stack>
    );
  };

  const renderInsightView = (insightId: string, backTarget: BackTarget): JSX.Element => {
    const insight = findInsight(insightId);
    const backLabel =
      backTarget.name === 'area'
        ? backTarget.area
        : backTarget.name === 'review'
          ? 'Review'
          : backTarget.name === 'responses'
            ? 'Responses'
            : 'Memory';
    return (
      <Stack gap={3}>
        <button type="button" className={styles.back} onClick={() => back(backTarget)}>
          <ArrowLeft size={15} aria-hidden="true" /> {backLabel}
        </button>
        {insight ? (
          renderInsightCard(insight)
        ) : (
          <Card>
            <Text tone="secondary">That insight is no longer here.</Text>
          </Card>
        )}
      </Stack>
    );
  };

  const renderReview = (): JSX.Element => (
    <Stack gap={3}>
      <button type="button" className={styles.back} onClick={() => back({ name: 'overview' })}>
        <ArrowLeft size={15} aria-hidden="true" /> Memory
      </button>
      <Heading level={2}>Needs your review</Heading>
      <Text size="sm" tone="tertiary">
        Drafts wait here until you approve them — they don’t inform your coaching yet.
      </Text>
      {proposals.map((proposal) => (
        <Card key={proposal.id} className={styles.proposal}>
          <Stack gap={2}>
            <Text size="sm" tone="secondary">
              These two look like the same thing — combine them into one?
            </Text>
            <Text>· {proposal.intoSummary}</Text>
            <Text>· {proposal.fromSummary}</Text>
            <div className={styles.proposalActions}>
              <Button
                variant="secondary"
                onClick={() => void resolveProposal(proposal.id, 'merge')}
              >
                Merge
              </Button>
              <Button variant="ghost" onClick={() => void resolveProposal(proposal.id, 'keepBoth')}>
                Keep both
              </Button>
            </div>
          </Stack>
        </Card>
      ))}
      {drafts.map((insight) => (
        <div key={insight.id}>{renderInsightCard(insight)}</div>
      ))}
      {reviewCount === 0 ? (
        <Card>
          <Text tone="secondary">Nothing to review right now.</Text>
        </Card>
      ) : null}
    </Stack>
  );

  const renderResponses = (): JSX.Element => (
    <Stack gap={4}>
      <button type="button" className={styles.back} onClick={() => back({ name: 'overview' })}>
        <ArrowLeft size={15} aria-hidden="true" /> Memory
      </button>
      <Stack gap={1}>
        <Heading level={2}>Responses to your questionnaires</Heading>
        <Text size="sm" tone="tertiary">
          What you learned from questionnaires you sent — these reflect their answers, not you.
        </Text>
      </Stack>
      {recipientGroups.map((group) => (
        <div key={group.key} className={styles.responseGroup}>
          <h3 className={styles.responseName}>{group.name}</h3>
          <div className={styles.insightList}>
            {group.insights.map((insight) => (
              <InsightRow
                key={insight.id}
                insight={insight}
                onOpen={() => openInsight(insight.id, { name: 'responses' })}
              />
            ))}
          </div>
        </div>
      ))}
    </Stack>
  );

  // ── Overview ───────────────────────────────────────────────────────────────
  const renderOverview = (): JSX.Element => {
    if (loaded && !anyOwn) {
      return (
        <Card>
          <Stack gap={3} align="center">
            <Brain size={24} aria-hidden="true" />
            <Text tone="secondary">
              As you have sessions, log dreams, answer questionnaires, and take a few tests, what
              SelfOS learns about you shows up here.
            </Text>
            {canStartSession ? (
              <Button variant="secondary" onClick={() => navigate('/sessions')}>
                <MessageCircle size={16} aria-hidden="true" />
                Start a session
              </Button>
            ) : null}
          </Stack>
        </Card>
      );
    }

    return (
      <Stack gap={4}>
        {approvedOwn.length > 0 ? (
          <Card className={styles.hero}>
            <div className={styles.portrait}>
              {portraitLead ? (
                <>
                  <Markdown>{portraitLead}</Markdown>
                  {hasMorePortrait && portraitInsight ? (
                    <button
                      type="button"
                      className={styles.readFull}
                      onClick={() => openInsight(portraitInsight.id, { name: 'overview' })}
                    >
                      Read your full portrait →
                    </button>
                  ) : null}
                </>
              ) : (
                <Text tone="secondary">
                  A picture of you is taking shape — the more you reflect, the fuller it gets.
                </Text>
              )}
            </div>
            <div className={styles.knows}>
              <span className={styles.knowsLabel}>How well it knows you</span>
              <span className={styles.knowsValue}>{knows.label}</span>
              <span className={styles.meter} aria-hidden="true">
                {[1, 2, 3].map((i) => (
                  <span key={i} className={i <= knows.level ? styles.meterOn : styles.meterOff} />
                ))}
              </span>
              <Text size="xs" tone="tertiary">
                {overview.total} {overview.total === 1 ? 'thing' : 'things'} learned
              </Text>
            </div>
          </Card>
        ) : null}

        {reviewCount > 0 ? (
          <div className={styles.callout}>
            <Sparkles size={18} aria-hidden="true" className={styles.calloutIcon} />
            <Text size="sm" className={styles.calloutText}>
              {drafts.length > 0 ? (
                <>
                  <strong>
                    {drafts.length} new {drafts.length === 1 ? 'insight' : 'insights'}
                  </strong>{' '}
                  to review
                </>
              ) : null}
              {drafts.length > 0 && proposals.length > 0 ? ', and ' : null}
              {proposals.length > 0 ? (
                <>
                  <strong>
                    {proposals.length} {proposals.length === 1 ? 'pair' : 'pairs'}
                  </strong>{' '}
                  that may be duplicates
                </>
              ) : null}
              .
            </Text>
            <Button variant="primary" onClick={() => setView({ name: 'review' })}>
              Review
            </Button>
          </div>
        ) : null}

        <div className={styles.searchRow}>
          <div className={styles.searchBox}>
            <Search size={15} aria-hidden="true" className={styles.searchIcon} />
            <TextInput
              value={query}
              aria-label="Search memory"
              placeholder="Search what SelfOS knows…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button variant="secondary" onClick={() => void onRefresh()} disabled={refreshing}>
            <RefreshCw size={14} aria-hidden="true" /> {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>

        {refreshNote ? <Banner tone="info">{refreshNote}</Banner> : null}

        {q ? (
          <Stack gap={2}>
            <Text size="sm" tone="tertiary">
              {searchResults.length} {searchResults.length === 1 ? 'result' : 'results'}
            </Text>
            <div className={styles.insightList}>
              {searchResults.map((insight) => (
                <InsightRow
                  key={insight.id}
                  insight={insight}
                  onOpen={() => openInsight(insight.id, { name: 'overview' })}
                />
              ))}
            </div>
          </Stack>
        ) : (
          <>
            {areas.length > 0 ? (
              <Stack gap={3}>
                <div className={styles.sectionHead}>
                  <Heading level={3} className={styles.groupTitle}>
                    By life area
                  </Heading>
                  <span className={styles.groupCount}>
                    {areas.length} {areas.length === 1 ? 'area' : 'areas'}
                  </span>
                </div>
                <div className={styles.tileGrid}>
                  {areas.map((summary) => (
                    <LifeAreaTile
                      key={summary.area}
                      summary={summary}
                      onOpen={() => setView({ name: 'area', area: summary.area })}
                    />
                  ))}
                </div>
              </Stack>
            ) : null}

            {trendSeries.length > 0 || responseCount > 0 ? (
              <div className={styles.duo}>
                {trendSeries.length > 0 ? (
                  <Card className={styles.panel}>
                    <div className={styles.panelHead}>
                      <LineChartIcon size={16} aria-hidden="true" />
                      <span className={styles.panelName}>Mood &amp; energy</span>
                    </div>
                    <Text size="sm" tone="tertiary">
                      How your mood and energy have moved across analyzed sessions — a gentle
                      reflection, not a measure.
                    </Text>
                    <LineChart
                      series={trendSeries}
                      ariaLabel="Your mood and energy across analyzed sessions over time"
                      yMin={-1}
                      yMax={1}
                    />
                  </Card>
                ) : null}
                {responseCount > 0 ? (
                  <button
                    type="button"
                    className={`${styles.panel} ${styles.panelButton}`}
                    onClick={() => setView({ name: 'responses' })}
                  >
                    <div className={styles.panelHead}>
                      <ClipboardList size={16} aria-hidden="true" />
                      <span className={styles.panelName}>From questionnaires you sent</span>
                    </div>
                    <Text size="sm" tone="tertiary">
                      What you learned from others’ answers — about them, informing your coaching.
                    </Text>
                    <Text size="sm">
                      {responseCount} {responseCount === 1 ? 'insight' : 'insights'} ·{' '}
                      {recipientGroups.map((g) => g.name).join(', ')}
                    </Text>
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </Stack>
    );
  };

  return (
    <div className={styles.layout}>
      <Stack gap={2}>
        <Heading level={2}>Memory</Heading>
        <Text tone="secondary">What SelfOS understands about you.</Text>
        {lastReconciledAt && view.name === 'overview' ? (
          <Text size="sm" tone="tertiary" aria-live="polite">
            Memory last tidied {relativeDate(lastReconciledAt)}.
          </Text>
        ) : null}
      </Stack>

      {view.name === 'overview'
        ? renderOverview()
        : view.name === 'area'
          ? renderArea(view.area)
          : view.name === 'insight'
            ? renderInsightView(view.insightId, view.back)
            : view.name === 'review'
              ? renderReview()
              : renderResponses()}

      <CrisisFooter />
    </div>
  );
}

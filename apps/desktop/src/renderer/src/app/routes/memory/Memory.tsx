import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, MessageCircle, RefreshCw, Search } from 'lucide-react';
import type { Insight, InsightSource, Relationship } from '@shared/schemas';
import { LIFE_AREAS } from '@shared/schemas';
import { availableRelationshipTypesFor } from '../../availableRelationshipTypes';
import { useInsightStore } from '../../../stores/insightStore';
import { useGoalStore } from '../../../stores/goalStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { aiUnavailableMessage } from '../../AiUnavailableNotice';
import { useConversationStore } from '../../../stores/conversationStore';
import { useDreamStore } from '../../../stores/dreamStore';
import {
  Banner,
  Button,
  Card,
  Heading,
  LineChart,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from '../../../design-system/components';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { InsightCard } from './InsightCard';
import { GoalCard } from './GoalCard';
import { RelationshipInsightsCard } from './RelationshipInsightsCard';
import { StatsSummary } from './StatsSummary';
import { confidenceStats, overviewStats, sharingStats } from './stats';
import { buildTrendSeries } from './trends';
import styles from './Memory.module.css';

type SourceFilter = 'all' | InsightSource;
type ConfidenceFilter = 'all' | 'high' | 'medium' | 'low';

const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'All sources' },
  { value: 'intake', label: 'Onboarding' },
  { value: 'session', label: 'Sessions' },
  { value: 'dream', label: 'Dreams' },
  { value: 'questionnaire', label: 'Questionnaires' },
];

function matchesText(insight: Insight, q: string): boolean {
  if (!q) return true;
  const hay = [insight.summary, ...insight.facts.map((f) => f.text)].join(' ').toLowerCase();
  return hay.includes(q);
}

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

/**
 * "Memory" — the active person's living view of what SelfOS has learned (20-memory-dashboard, redesigned in
 * 54-memory-redesign). A summary strip + an "About you" / "Partners" toggle: "About you" is their OWN data
 * (search/filters, drafts, goals, trends, insights by life-area); "Partners" shows AI relationship insights
 * per partner. A partner's shared data feeds the AI's context + that synthesis but is NEVER shown raw here —
 * sharing is context, not display (§1).
 */
export function Memory(): JSX.Element {
  const navigate = useNavigate();
  const insights = useInsightStore((s) => s.insights);
  const outbound = useInsightStore((s) => s.outbound);
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
  const goals = useGoalStore((s) => s.goals);
  const loadGoals = useGoalStore((s) => s.load);
  const lastReconciledAt = useInsightStore((s) => s.lastReconciledAt);
  const proposals = useInsightStore((s) => s.proposals);
  const loadReconcileState = useInsightStore((s) => s.loadReconcileState);
  const resolveProposal = useInsightStore((s) => s.resolveProposal);

  const [view, setView] = useState<'you' | 'relationships'>('you');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [confidence, setConfidence] = useState<ConfidenceFilter>('all');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [relationships, setRelationships] = useState<Relationship[]>([]);

  useEffect(() => {
    void load();
    void loadPeople();
    void loadGoals();
    void loadReconcileState();
    void window.selfos?.relationshipsList?.().then((rels) => setRelationships(rels ?? []));
  }, [load, loadPeople, loadGoals, loadReconcileState]);

  // The relationship types in the person's graph — offered by an AI-inferred fact's sharing picker (44 §3.4).
  const availableTypes = useMemo(
    () => availableRelationshipTypesFor(activePersonId, relationships),
    [activePersonId, relationships],
  );

  // Active goals (open/in-progress — `stale` derives from these) above; closed (done/let go) fold into a
  // collapsed history. The store returns newest-first.
  const activeGoals = useMemo(
    () =>
      goals.filter((g) => g.status === 'open' || g.status === 'inProgress' || g.status === 'stale'),
    [goals],
  );
  const closedGoals = useMemo(
    () => goals.filter((g) => g.status === 'done' || g.status === 'abandoned'),
    [goals],
  );

  const liveConversationIds = useMemo(
    () => new Set(conversations.map((c) => c.id)),
    [conversations],
  );
  const liveDreamIds = useMemo(() => new Set(dreams.map((d) => d.id)), [dreams]);

  // A session/dream insight whose source no longer exists shows "original source removed" (§3.3/§3.7).
  // AppShell loads the conversation/dream stores on the active-person change before this mounts, so the
  // "removed" state reflects the loaded lists (the dashboard re-renders when they arrive).
  const sourceRemoved = (insight: Insight): boolean => {
    if (insight.source === 'session' && insight.provenance.conversationId) {
      return !liveConversationIds.has(insight.provenance.conversationId);
    }
    if (insight.source === 'dream' && insight.provenance.dreamId) {
      return !liveDreamIds.has(insight.provenance.dreamId);
    }
    return false;
  };

  const q = query.trim().toLowerCase();
  // Only the person's OWN insights are ever displayed (54): a related person's shared facts feed the AI's
  // context + the relationship synthesis, but are NEVER shown raw — sharing is context, not display.
  const own = insights.filter((i) => i.subjectPersonId === activePersonId);

  // The viewer's PARTNER relationships (the `partner` edge is symmetric) → the "Partners" view's cards.
  const partners = useMemo(() => {
    if (!activePersonId) return [] as { id: string; name: string }[];
    const ids = new Set<string>();
    for (const r of relationships) {
      if (r.type !== 'partner') continue;
      if (r.fromPersonId === activePersonId) ids.add(r.toPersonId);
      else if (r.toPersonId === activePersonId) ids.add(r.fromPersonId);
    }
    return [...ids]
      .map((id) => ({ id, name: people.find((p) => p.id === id)?.displayName }))
      .filter((p): p is { id: string; name: string } => p.name !== undefined);
  }, [relationships, activePersonId, people]);

  const passesFilters = (insight: Insight): boolean =>
    matchesText(insight, q) &&
    (source === 'all' || insight.source === source) &&
    (confidence === 'all' || insight.confidence === confidence) &&
    (!flaggedOnly || insight.facts.some((f) => f.flaggedInaccurate));

  const filteredOwn = own.filter((i) => passesFilters(i));
  const drafts = filteredOwn.filter((i) => !i.approved);
  const approvedOwn = filteredOwn.filter((i) => i.approved);

  // Who a sent-questionnaire insight is ABOUT (#129): the recipient of a questionnaire you sent — resolved
  // from the enriched provenance (a household person id → their name; else an external name). A self
  // check-in carries no `about*` (the bridge only stamps a non-self recipient), so it reads as `null` and
  // stays in the life-area cards. These insights inform YOUR coaching (subject = you) but their facts
  // describe THEIR answers, so they get their own "Responses to your questionnaires" section instead of
  // masquerading as "about you" facts.
  const responseAbout = (insight: Insight): { key: string; name: string } | null => {
    if (insight.source !== 'questionnaire') return null;
    const pid = insight.provenance.aboutPersonId;
    if (pid) return { key: pid, name: people.find((p) => p.id === pid)?.displayName ?? 'someone' };
    const name = insight.provenance.aboutName;
    return name ? { key: `ext:${name}`, name } : null;
  };

  // Stats summarize the WHOLE memory (own approved), independent of the current filters/search (§3.2).
  const ownApprovedAll = own.filter((i) => i.approved);
  const overviewSummary = overviewStats(ownApprovedAll);
  const confidenceSummary = confidenceStats(ownApprovedAll);
  const sharingSummary = sharingStats(outbound);
  const showStats = loaded && ownApprovedAll.length > 0;

  // Split approved own insights: responses to questionnaires YOU sent (about the recipient — #129) get their
  // own section; everything genuinely about you fills the life-area cards.
  const responseInsights = approvedOwn.filter((i) => responseAbout(i) !== null);
  const aboutYouApproved = approvedOwn.filter((i) => responseAbout(i) === null);

  // Group responses by the person who answered (recipient), newest first within each.
  const byRecipient = new Map<string, { key: string; name: string; insights: Insight[] }>();
  for (const insight of responseInsights) {
    const about = responseAbout(insight);
    if (!about) continue;
    const entry = byRecipient.get(about.key) ?? { key: about.key, name: about.name, insights: [] };
    entry.insights.push(insight);
    byRecipient.set(about.key, entry);
  }
  const recipientGroups = [...byRecipient.values()].sort((a, b) => a.name.localeCompare(b.name));

  // Group the person's own approved insights by their primary life-area (categories[0]; 'Other' if untagged).
  const byArea = new Map<string, Insight[]>();
  for (const insight of aboutYouApproved) {
    const area = insight.categories[0] ?? 'Other';
    byArea.set(area, [...(byArea.get(area) ?? []), insight]);
  }
  const orderedAreas = LIFE_AREAS.filter((a) => byArea.has(a));

  const trendSeries = activePersonId ? buildTrendSeries(insights, activePersonId) : [];

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    setRefreshNote(null);
    try {
      const result = await refresh();
      if (result.ok) {
        const proposed = result.proposedCount ?? 0;
        setRefreshNote(
          `Memory refreshed — ${result.reconciledCount ?? 0} updated${proposed ? `, ${proposed} merge${proposed === 1 ? '' : 's'} to review below` : ''}.`,
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

  const nothingShown = loaded && drafts.length === 0 && approvedOwn.length === 0;
  const anyOwn = own.length > 0;
  const showToggle = loaded && (anyOwn || partners.length > 0);

  return (
    <div className={styles.layout}>
      <Stack gap={2}>
        <Heading level={2}>Memory</Heading>
        <Text tone="secondary">What SelfOS understands about you — and your relationships.</Text>
        {lastReconciledAt ? (
          <Text size="sm" tone="tertiary" aria-live="polite">
            Memory last tidied {relativeDate(lastReconciledAt)}.
          </Text>
        ) : null}
      </Stack>

      {showStats ? (
        <StatsSummary
          overview={overviewSummary}
          confidence={confidenceSummary}
          sharing={sharingSummary}
          onManageSharing={() => navigate('/memory/sharing')}
        />
      ) : null}

      {showToggle ? (
        <SegmentedControl
          aria-label="Memory view"
          options={[
            { value: 'you', label: 'About you' },
            { value: 'relationships', label: 'Partners' },
          ]}
          value={view}
          onChange={setView}
        />
      ) : null}

      {view === 'relationships' ? (
        <Stack gap={3}>
          <Text size="sm" tone="tertiary">
            Insight about you and your partners — drawn from what they share, shown as insight,
            never their raw answers.
          </Text>
          {partners.length === 0 ? (
            <Card>
              <Text tone="secondary">
                Add a partner in People, and relationship insights about the two of you will appear
                here.
              </Text>
            </Card>
          ) : (
            partners.map((p) => (
              <RelationshipInsightsCard
                key={p.id}
                partnerId={p.id}
                partnerName={p.name}
                canManageAi={canManageAi}
              />
            ))
          )}
        </Stack>
      ) : (
        <>
          {anyOwn ? (
            <div className={styles.controls}>
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
                  <RefreshCw size={14} aria-hidden="true" />{' '}
                  {refreshing ? 'Refreshing…' : 'Refresh'}
                </Button>
              </div>
              <div className={styles.filterRow}>
                <Select
                  aria-label="Filter by source"
                  value={source}
                  onChange={(event) => setSource(event.target.value as SourceFilter)}
                >
                  {SOURCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Filter by confidence"
                  value={confidence}
                  onChange={(event) => setConfidence(event.target.value as ConfidenceFilter)}
                >
                  <option value="all">Any confidence</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </Select>
                <span className={styles.flaggedToggle}>
                  <Switch
                    checked={flaggedOnly}
                    aria-label="Show only flagged"
                    onChange={setFlaggedOnly}
                  />
                  <Text size="sm" aria-hidden="true">
                    Flagged only
                  </Text>
                </span>
              </div>
            </div>
          ) : null}

          {refreshNote ? <Banner tone="info">{refreshNote}</Banner> : null}

          {trendSeries.length > 0 ? (
            <details className={styles.trends} open>
              <summary className={styles.trendsSummary}>Trends</summary>
              <div className={styles.trendsBody}>
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
              </div>
            </details>
          ) : null}

          {loaded && !anyOwn ? (
            <Card>
              <Stack gap={3} align="center">
                <Brain size={24} aria-hidden="true" />
                <Text tone="secondary">
                  Insights appear here after your sessions, dreams, and questionnaires are analyzed
                  — your own view of what SelfOS is learning about you. Start a session to begin.
                </Text>
                {canStartSession ? (
                  <Button variant="secondary" onClick={() => navigate('/sessions')}>
                    <MessageCircle size={16} aria-hidden="true" />
                    Start a session
                  </Button>
                ) : null}
              </Stack>
            </Card>
          ) : null}

          {drafts.length > 0 || proposals.length > 0 ? (
            <section className={styles.group} aria-label="Needs your review">
              <Heading level={3} className={styles.groupTitle}>
                Needs your review
              </Heading>
              <Stack gap={3}>
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
                        <Button
                          variant="ghost"
                          onClick={() => void resolveProposal(proposal.id, 'keepBoth')}
                        >
                          Keep both
                        </Button>
                      </div>
                    </Stack>
                  </Card>
                ))}
                {drafts.length > 0 ? (
                  <Text size="sm" tone="tertiary">
                    Drafts wait here until you approve them — they don’t inform your coaching yet.
                  </Text>
                ) : null}
                {drafts.map((insight) => (
                  <InsightCard
                    key={insight.id}
                    insight={insight}
                    subjectName="you"
                    isOwn
                    {...(availableTypes ? { availableTypes } : {})}
                  />
                ))}
              </Stack>
            </section>
          ) : null}

          {goals.length > 0 || anyOwn ? (
            <section className={styles.group} aria-label="Goals & commitments">
              <Heading level={3} className={styles.groupTitle}>
                Goals &amp; commitments
              </Heading>
              {goals.length === 0 ? (
                <Card>
                  <Text tone="secondary">
                    Goals you mention in sessions show up here so SelfOS can help you follow
                    through.
                  </Text>
                </Card>
              ) : (
                <Stack gap={3}>
                  {activeGoals.map((goal) => (
                    <GoalCard key={goal.id} goal={goal} />
                  ))}
                  {closedGoals.length > 0 ? (
                    <details className={styles.trends}>
                      <summary className={styles.trendsSummary}>
                        Completed &amp; closed ({closedGoals.length})
                      </summary>
                      <div className={styles.trendsBody}>
                        <Stack gap={3}>
                          {closedGoals.map((goal) => (
                            <GoalCard key={goal.id} goal={goal} />
                          ))}
                        </Stack>
                      </div>
                    </details>
                  ) : null}
                </Stack>
              )}
            </section>
          ) : null}

          {orderedAreas.map((area) => {
            const areaInsights = byArea.get(area) ?? [];
            return (
              <section key={area} className={styles.group} aria-label={area}>
                <Heading level={3} className={styles.groupTitle}>
                  {area} <span className={styles.groupCount}>({areaInsights.length})</span>
                </Heading>
                <Stack gap={3}>
                  {areaInsights.map((insight) => (
                    <InsightCard
                      key={insight.id}
                      insight={insight}
                      subjectName="you"
                      isOwn
                      sourceRemoved={sourceRemoved(insight)}
                      {...(availableTypes ? { availableTypes } : {})}
                    />
                  ))}
                </Stack>
              </section>
            );
          })}

          {recipientGroups.length > 0 ? (
            <section className={styles.group} aria-label="Responses to your questionnaires">
              <Heading level={3} className={styles.groupTitle}>
                Responses to your questionnaires
              </Heading>
              <Text size="sm" tone="tertiary">
                What you learned from questionnaires you sent — these reflect their answers, not
                you.
              </Text>
              <Stack gap={4}>
                {recipientGroups.map((group) => (
                  <div key={group.key} className={styles.responseGroup}>
                    <h4 className={styles.responseName}>{group.name}</h4>
                    <Stack gap={3}>
                      {group.insights.map((insight) => (
                        <InsightCard
                          key={insight.id}
                          insight={insight}
                          subjectName="you"
                          isOwn
                          aboutName={group.name}
                          sourceRemoved={sourceRemoved(insight)}
                          {...(availableTypes ? { availableTypes } : {})}
                        />
                      ))}
                    </Stack>
                  </div>
                ))}
              </Stack>
            </section>
          ) : null}

          {!nothingShown ? null : (
            <Card>
              <Text tone="secondary">No insights match your filters.</Text>
            </Card>
          )}
        </>
      )}

      <CrisisFooter />
    </div>
  );
}

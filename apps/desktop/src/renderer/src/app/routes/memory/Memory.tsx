import { useEffect, useMemo, useState } from 'react';
import { Brain, RefreshCw, Search } from 'lucide-react';
import type { Insight, InsightSource } from '@shared/schemas';
import { LIFE_AREAS } from '@shared/schemas';
import { useInsightStore } from '../../../stores/insightStore';
import { useGoalStore } from '../../../stores/goalStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useConversationStore } from '../../../stores/conversationStore';
import { useDreamStore } from '../../../stores/dreamStore';
import {
  Banner,
  Button,
  Card,
  Heading,
  LineChart,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from '../../../design-system/components';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { InsightCard } from './InsightCard';
import { GoalCard } from './GoalCard';
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
 * "Memory" — the active person's living view of what SelfOS has learned about them (20-memory-dashboard §3).
 * The bridge scopes the list to their own insights + relationships' shareable facts (§5.1). Header with
 * search + Refresh + filters; a "Needs your review" section for drafts; a Trends section; then their own
 * insights grouped by life-area, and a read-only section for what people they relate to have shared.
 */
export function Memory(): JSX.Element {
  const insights = useInsightStore((s) => s.insights);
  const loaded = useInsightStore((s) => s.loaded);
  const load = useInsightStore((s) => s.load);
  const refresh = useInsightStore((s) => s.refresh);
  const people = usePeopleStore((s) => s.people);
  const loadPeople = usePeopleStore((s) => s.load);
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);
  const conversations = useConversationStore((s) => s.conversations);
  const dreams = useDreamStore((s) => s.dreams);
  const goals = useGoalStore((s) => s.goals);
  const loadGoals = useGoalStore((s) => s.load);
  const lastReconciledAt = useInsightStore((s) => s.lastReconciledAt);
  const proposals = useInsightStore((s) => s.proposals);
  const loadReconcileState = useInsightStore((s) => s.loadReconcileState);
  const resolveProposal = useInsightStore((s) => s.resolveProposal);

  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [subject, setSubject] = useState<string>('all'); // 'all' | 'you' | a related person id
  const [confidence, setConfidence] = useState<ConfidenceFilter>('all');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  useEffect(() => {
    void load();
    void loadPeople();
    void loadGoals();
    void loadReconcileState();
  }, [load, loadPeople, loadGoals, loadReconcileState]);

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

  const nameOf = (id: string): string => people.find((p) => p.id === id)?.displayName ?? 'someone';
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
  const own = insights.filter((i) => i.subjectPersonId === activePersonId);
  const related = insights.filter((i) => i.subjectPersonId !== activePersonId);
  const relatedSubjects = [...new Set(related.map((i) => i.subjectPersonId))];

  const passesFilters = (insight: Insight): boolean =>
    matchesText(insight, q) &&
    (source === 'all' || insight.source === source) &&
    (confidence === 'all' || insight.confidence === confidence) &&
    (!flaggedOnly || insight.facts.some((f) => f.flaggedInaccurate));

  const subjectOk = (insight: Insight): boolean => {
    if (subject === 'all') return true;
    if (subject === 'you') return insight.subjectPersonId === activePersonId;
    return insight.subjectPersonId === subject;
  };

  const filteredOwn = own.filter((i) => passesFilters(i) && subjectOk(i));
  const filteredRelated = related.filter((i) => passesFilters(i) && subjectOk(i));
  const drafts = filteredOwn.filter((i) => !i.approved);
  const approvedOwn = filteredOwn.filter((i) => i.approved);

  // Group the person's own approved insights by their primary life-area (categories[0]; 'Other' if untagged).
  const byArea = new Map<string, Insight[]>();
  for (const insight of approvedOwn) {
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
        setRefreshNote('Turn on AI in Settings to refresh memory.');
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

  const nothingShown =
    loaded && drafts.length === 0 && approvedOwn.length === 0 && filteredRelated.length === 0;
  const anyInsights = own.length > 0 || related.length > 0;

  return (
    <div className={styles.layout}>
      <Stack gap={2}>
        <Heading level={2}>Memory</Heading>
        <Text tone="secondary">
          What SelfOS understands about you — and the people you relate to.
        </Text>
        {lastReconciledAt ? (
          <Text size="sm" tone="tertiary" aria-live="polite">
            Memory last tidied {relativeDate(lastReconciledAt)}.
          </Text>
        ) : null}
      </Stack>

      {anyInsights ? (
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
              <RefreshCw size={14} aria-hidden="true" /> {refreshing ? 'Refreshing…' : 'Refresh'}
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
              aria-label="Filter by subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            >
              <option value="all">Everyone</option>
              <option value="you">You</option>
              {relatedSubjects.map((id) => (
                <option key={id} value={id}>
                  {nameOf(id)}
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

      {loaded && !anyInsights ? (
        <Card>
          <Stack gap={2} align="center">
            <Brain size={24} aria-hidden="true" />
            <Text tone="secondary">
              Nothing here yet. As you have sessions, log dreams, and answer questionnaires, what
              SelfOS learns about you shows up here.
            </Text>
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
                subjectName={nameOf(insight.subjectPersonId)}
                isOwn
              />
            ))}
          </Stack>
        </section>
      ) : null}

      {goals.length > 0 || anyInsights ? (
        <section className={styles.group} aria-label="Goals & commitments">
          <Heading level={3} className={styles.groupTitle}>
            Goals &amp; commitments
          </Heading>
          {goals.length === 0 ? (
            <Card>
              <Text tone="secondary">
                Goals you mention in sessions show up here so SelfOS can help you follow through.
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

      {trendSeries.length > 0 ? (
        <details className={styles.trends}>
          <summary className={styles.trendsSummary}>Trends</summary>
          <div className={styles.trendsBody}>
            <Text size="sm" tone="tertiary">
              How your mood and energy have moved across analyzed sessions — a gentle reflection,
              not a measure.
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

      {orderedAreas.map((area) => (
        <section key={area} className={styles.group} aria-label={area}>
          <Heading level={3} className={styles.groupTitle}>
            {area}
          </Heading>
          <Stack gap={3}>
            {(byArea.get(area) ?? []).map((insight) => (
              <InsightCard
                key={insight.id}
                insight={insight}
                subjectName="you"
                isOwn
                sourceRemoved={sourceRemoved(insight)}
              />
            ))}
          </Stack>
        </section>
      ))}

      {filteredRelated.length > 0 ? (
        <section className={styles.group} aria-label="About people you relate to">
          <Heading level={3} className={styles.groupTitle}>
            About people you relate to
          </Heading>
          <Text size="sm" tone="tertiary">
            What the people in your life have chosen to share — read-only.
          </Text>
          <Stack gap={3}>
            {filteredRelated.map((insight) => (
              <InsightCard
                key={insight.id}
                insight={insight}
                subjectName={nameOf(insight.subjectPersonId)}
                isOwn={false}
              />
            ))}
          </Stack>
        </section>
      ) : null}

      {!nothingShown || !anyInsights ? null : (
        <Card>
          <Text tone="secondary">No insights match your filters.</Text>
        </Card>
      )}

      <CrisisFooter />
    </div>
  );
}

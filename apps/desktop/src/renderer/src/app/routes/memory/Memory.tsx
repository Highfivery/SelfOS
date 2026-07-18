import { useEffect, useMemo, useRef, useState } from 'react';
import { Brain, MessageCircle, RefreshCw, Search, Sparkles } from 'lucide-react';
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
  Collapsible,
  Heading,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '../../../design-system/components';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { InsightCard } from './InsightCard';
import { LifeAreaSection } from './LifeAreaSection';
import { PortraitHero } from './PortraitHero';
import { StatsStrip } from './StatsStrip';
import { TrendsCard } from './TrendsCard';
import { ResponsesBand, type RecipientGroup } from './ResponsesBand';
import { memorySections } from './sections';
import { confidenceStats, overviewStats } from './stats';
import { knowsYouRead } from './overview';
import styles from './Memory.module.css';

/** A calm relative date for the "Memory last tidied …" signal + the stats strip (39 §3.2). */
function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';
  const days = Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function matchesText(insight: Insight, q: string): boolean {
  const hay = [insight.summary, ...insight.facts.map((f) => f.text)].join(' ').toLowerCase();
  return hay.includes(q);
}

const CONFIDENCE_SHORT: Record<number, string> = { 3: 'High', 2: 'Medium', 1: 'Low', 0: '—' };

/**
 * "Memory" (62-memory-insights-redesign, on 20/44/54/57) — the active person's flattened, edit-in-place view
 * of what SelfOS understands about them. The page opens with a stats strip + a review callout + the portrait
 * hero + "how you've been" + questionnaire responses, then **collapsible life-area sections** whose insights
 * are edited in place (a card pencil + per-line pencils) — no drill-down. All sections start collapsed;
 * sensitive areas always start collapsed (§3.2). Purely "about you"; Goals + partner sharing live elsewhere
 * (57). Deterministic reads (no AI spend); the portrait reuses the onboarding-portrait insight.
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
  const activePersonName = useSessionStore((s) => s.activePerson?.displayName ?? '');
  const canManageAi = useSessionStore((s) => s.can('settings.manage'));
  const canStartSession = useSessionStore((s) => s.can('sessions.own'));
  const conversations = useConversationStore((s) => s.conversations);
  const dreams = useDreamStore((s) => s.dreams);
  const lastReconciledAt = useInsightStore((s) => s.lastReconciledAt);
  const proposals = useInsightStore((s) => s.proposals);
  const loadReconcileState = useInsightStore((s) => s.loadReconcileState);
  const resolveProposal = useInsightStore((s) => s.resolveProposal);

  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [openAreas, setOpenAreas] = useState<Set<string>>(new Set());
  const [openResponses, setOpenResponses] = useState<Set<string>>(new Set());
  const [reviewOpen, setReviewOpen] = useState(false);
  const [listView, setListView] = useState(false);
  const scrollTo = useRef<string | null>(null);

  useEffect(() => {
    void load();
    void loadPeople();
    void loadReconcileState();
    void window.selfos?.relationshipsList?.().then((rels) => setRelationships(rels ?? []));
  }, [load, loadPeople, loadReconcileState]);

  // Reset the expanded state + search on a fresh nav to Memory or an active-person change (57 §3.6).
  useEffect(() => {
    setOpenAreas(new Set());
    setOpenResponses(new Set());
    setReviewOpen(false);
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

  const sourceRemoved = (insight: Insight): boolean => {
    if (insight.source === 'session' && insight.provenance.conversationId)
      return !liveConversationIds.has(insight.provenance.conversationId);
    if (insight.source === 'dream' && insight.provenance.dreamId)
      return !liveDreamIds.has(insight.provenance.dreamId);
    return false;
  };

  // Only the person's OWN insights are ever displayed (54); related shared facts feed context, never shown raw.
  const own = insights.filter((i) => i.subjectPersonId === activePersonId);
  const drafts = own.filter((i) => !i.approved);
  const approvedOwn = own.filter((i) => i.approved);

  // A sent-questionnaire insight is ABOUT the recipient (#129) — its own "responses" band, not the sections.
  const responseAbout = (insight: Insight): { key: string; name: string } | null => {
    if (insight.source !== 'questionnaire') return null;
    const pid = insight.provenance.aboutPersonId;
    if (pid) return { key: pid, name: people.find((p) => p.id === pid)?.displayName ?? 'someone' };
    const name = insight.provenance.aboutName;
    return name ? { key: `ext:${name}`, name } : null;
  };

  const responseInsights = approvedOwn.filter((i) => responseAbout(i) !== null);
  const aboutYouApproved = approvedOwn.filter((i) => responseAbout(i) === null);
  const portraitInsight = approvedOwn.find((i) => i.source === 'intake');
  // The hero shows the portrait's NARRATIVE; its facts still live in the life-area sections as a card with the
  // summary hidden (§3.4) — so the narrative isn't duplicated, but the facts stay viewable + searchable.
  const sectionInsights = aboutYouApproved;

  const recipientGroups = useMemo<RecipientGroup[]>(() => {
    const byRecipient = new Map<string, RecipientGroup>();
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

  const sections = useMemo(() => memorySections(sectionInsights), [sectionInsights]);
  const overview = overviewStats(aboutYouApproved);
  const knows = knowsYouRead(confidenceStats(aboutYouApproved));

  // Deep-link from a Sent questionnaire's "View in Memory" (08 §3.1): open the target insight's section (or
  // responses recipient) + scroll to it. Keyed on `loaded` (not the arrays) so it fires once per navigation.
  useEffect(() => {
    const id = (location.state as { insightId?: string } | null)?.insightId;
    if (!id || !loaded) return;
    const insight = own.find((i) => i.id === id);
    if (!insight) return;
    const about = responseAbout(insight);
    if (about) setOpenResponses((prev) => new Set(prev).add(about.key));
    else setOpenAreas((prev) => new Set(prev).add(insight.categories[0] ?? 'Other'));
    scrollTo.current = `insight-${id}`;
  }, [activePersonId, location.key, loaded]);

  // Once the target section is open + rendered, scroll the card into view (reduced-motion respected by the OS).
  useEffect(() => {
    if (!scrollTo.current) return;
    const el = document.getElementById(scrollTo.current);
    if (el) {
      if (typeof el.scrollIntoView === 'function')
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      scrollTo.current = null;
    }
  });

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

  const toggle = (setter: typeof setOpenAreas, key: string, open: boolean): void =>
    setter((prev) => {
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });

  const renderInsightCard = (insight: Insight): JSX.Element => {
    const about = responseAbout(insight);
    return (
      <div
        key={insight.id}
        id={`insight-${insight.id}`}
        // The portrait (many grouped facts) spans the full grid row so it never lopsides a column.
        className={insight.source === 'intake' ? styles.fullSpanCard : undefined}
      >
        <InsightCard
          insight={insight}
          subjectName="you"
          isOwn
          sourceRemoved={sourceRemoved(insight)}
          hideSummary={insight.source === 'intake'}
          {...(about ? { aboutName: about.name } : {})}
          {...(availableTypes ? { availableTypes } : {})}
        />
      </div>
    );
  };

  return (
    <div className={styles.layout}>
      <Stack gap={2}>
        <Heading level={2}>Memory</Heading>
        <Text tone="secondary">
          What SelfOS understands about you — edit anything that isn’t right.
        </Text>
        {lastReconciledAt ? (
          <Text size="sm" tone="tertiary" aria-live="polite">
            Memory last tidied {relativeDate(lastReconciledAt)}.
          </Text>
        ) : null}
      </Stack>

      {loaded && !anyOwn ? (
        <Card>
          <Stack gap={3} align="center">
            <Brain size={24} aria-hidden="true" />
            <Text tone="secondary">
              As you have sessions, log dreams, answer questionnaires, and take a few tests, what
              SelfOS learns about you shows up here.
            </Text>
            {canStartSession ? (
              <Button variant="secondary" onClick={() => navigate('/sessions')}>
                <MessageCircle size={16} aria-hidden="true" /> Start a session
              </Button>
            ) : null}
          </Stack>
        </Card>
      ) : (
        <Stack gap={4}>
          {anyOwn ? (
            <StatsStrip
              total={overview.total}
              confidence={CONFIDENCE_SHORT[knows.level] ?? '—'}
              areaCount={sections.length}
              {...(lastReconciledAt ? { tidied: relativeDate(lastReconciledAt) } : {})}
            />
          ) : null}

          {reviewCount > 0 ? (
            <Collapsible
              className={styles.callout}
              headerClassName={styles.calloutHead}
              open={reviewOpen}
              onOpenChange={setReviewOpen}
              header={
                <>
                  <Sparkles size={18} aria-hidden="true" className={styles.calloutIcon} />
                  <Text size="sm" className={styles.calloutText}>
                    {drafts.length > 0
                      ? `${drafts.length} new ${drafts.length === 1 ? 'insight' : 'insights'} to review`
                      : ''}
                    {drafts.length > 0 && proposals.length > 0 ? ', ' : ''}
                    {proposals.length > 0
                      ? `${proposals.length} possible ${proposals.length === 1 ? 'duplicate' : 'duplicates'}`
                      : ''}
                  </Text>
                </>
              }
            >
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
                <div className={styles.cardGrid}>{drafts.map(renderInsightCard)}</div>
              ) : null}
            </Collapsible>
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
            <Stack gap={3}>
              <Text size="sm" tone="tertiary">
                {searchResults.length} {searchResults.length === 1 ? 'result' : 'results'}
              </Text>
              {searchResults.length > 0 ? (
                <div className={styles.cardGrid}>{searchResults.map(renderInsightCard)}</div>
              ) : (
                <Text tone="secondary">Nothing matches “{query.trim()}”.</Text>
              )}
            </Stack>
          ) : (
            <>
              {portraitInsight ? (
                <PortraitHero
                  initial={(activePersonName || 'You').charAt(0).toUpperCase()}
                  summary={portraitInsight.summary}
                  knows={knows}
                  onEditAnswers={() => navigate('/onboarding')}
                />
              ) : null}

              {activePersonId && overview.total > 0 ? (
                <TrendsCard insights={insights} personId={activePersonId} />
              ) : null}

              {recipientGroups.length > 0 ? (
                <ResponsesBand
                  groups={recipientGroups}
                  openKeys={openResponses}
                  onOpenChange={(key, open) => toggle(setOpenResponses, key, open)}
                  renderCards={(items) => (
                    <div className={styles.cardGrid}>{items.map(renderInsightCard)}</div>
                  )}
                />
              ) : null}

              {sections.length > 0 ? (
                <Stack gap={2}>
                  <div className={styles.sectionsHead}>
                    <Heading level={3} className={styles.sectionsTitle}>
                      By life area
                    </Heading>
                    <SegmentedControl
                      options={[
                        { value: 'grid' as const, label: '2 columns' },
                        { value: 'list' as const, label: 'List' },
                      ]}
                      value={listView ? 'list' : 'grid'}
                      onChange={(v) => setListView(v === 'list')}
                      aria-label="Insight card layout"
                    />
                  </div>
                  {sections.map((section) => (
                    <LifeAreaSection
                      key={section.area}
                      section={section}
                      open={openAreas.has(section.area)}
                      onOpenChange={(open) => toggle(setOpenAreas, section.area, open)}
                    >
                      <div className={`${styles.cardGrid} ${listView ? styles.list : ''}`}>
                        {section.insights.map(renderInsightCard)}
                      </div>
                    </LifeAreaSection>
                  ))}
                </Stack>
              ) : null}
            </>
          )}
        </Stack>
      )}

      <CrisisFooter />
    </div>
  );
}

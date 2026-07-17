import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronDown,
  ClipboardList,
  Inbox as InboxIcon,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import { validateQuestionnaire } from '@selfos/core/questionnaires';
import type { InboxItem } from '@shared/channels';
import type { Recipient } from '@shared/schemas';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { useInboxStore } from '../../../stores/inboxStore';
import { useAutoCheckinStore } from '../../../stores/autoCheckinStore';
import { Banner, Button, Card, Heading, Text } from '../../../design-system/components';
import { InboxAnswer } from '../inbox/InboxAnswer';
import { receivedStatus } from '../inbox/inboxStatus';
import { QuestionnaireBuilder, type BuilderSeed } from './QuestionnaireBuilder';
import { NewQuestionnaireStart } from './NewQuestionnaireStart';
import { SuggestedPanel } from './SuggestedPanel';
import { AutoCheckinsPanel } from './AutoCheckinsPanel';
import { SentCard } from './SentCard';
import { ReceivedCard } from './ReceivedCard';
import {
  matchesQuery,
  SENT_GROUPS,
  sentStatusOf,
  sortSent,
  type SentEntry,
  type SentSort,
  type SentStatus,
} from './sentGrouping';
import styles from './Questionnaires.module.css';

type Selection =
  | { mode: 'none' }
  | { mode: 'start'; seed?: BuilderSeed }
  | {
      mode: 'new';
      seed?: BuilderSeed;
      recipient?: Recipient;
      compat: boolean;
      fromSuggestion?: { recipientPersonId: string; suggestionId: string };
    }
  | { mode: 'edit'; id: string; share?: boolean; view?: 'results' }
  | { mode: 'suggested' }
  | { mode: 'answer'; assignmentId: string };

/** How many cards a group/section shows before "Show more" (08 §3.1 pagination). */
const PAGE_SIZE = 6;

const DOT_CLASS: Record<SentStatus, string> = {
  draft: styles.dotDraft ?? '',
  awaiting: styles.dotAwaiting ?? '',
  answered: styles.dotAnswered ?? '',
  analyzed: styles.dotAnalyzed ?? '',
};

/** A short status chip for received filtering. */
function receivedFilterMatch(item: InboxItem, filter: string): boolean {
  if (filter === 'all') return true;
  const label = receivedStatus(item).label;
  if (filter === 'new') return label === 'New';
  if (filter === 'inProgress') return label === 'In progress';
  if (filter === 'submitted') return label === 'Submitted';
  return true;
}

/**
 * The Questionnaires landing (08-questionnaires §3.1/§3.3): a three-tab surface — "Sent" (your authored
 * questionnaires, grouped by status with search/filter/sort + pagination), "Received" (sent to you), and
 * "Auto check-ins" (the automation config, no longer buried at the bottom). Opening a card drops into a
 * full-width detail view (builder or answering pane).
 */
export function Questionnaires(): JSX.Element {
  const questionnaires = useQuestionnaireStore((s) => s.questionnaires);
  const sendStates = useQuestionnaireStore((s) => s.sendStates);
  const sentOverview = useQuestionnaireStore((s) => s.sentOverview);
  const loaded = useQuestionnaireStore((s) => s.loaded);
  const load = useQuestionnaireStore((s) => s.load);
  const remove = useQuestionnaireStore((s) => s.remove);
  const setFavorite = useQuestionnaireStore((s) => s.setFavorite);
  const analyze = useQuestionnaireStore((s) => s.analyze);
  const loadTypes = useQuestionnaireStore((s) => s.loadTypes);
  const deleteSuggestion = useQuestionnaireStore((s) => s.deleteSuggestion);

  const inboxItems = useInboxStore((s) => s.items);
  const inboxLoaded = useInboxStore((s) => s.loaded);
  const loadInbox = useInboxStore((s) => s.load);
  const setInboxFavorite = useInboxStore((s) => s.setFavorite);

  // Auto check-ins config drives the third tab: it only appears when the person can use auto check-ins
  // (the bridge returns a null config otherwise, 63 §3.1). Loaded here so the tab shows without opening it.
  const autoConfig = useAutoCheckinStore((s) => s.config);
  const autoLoaded = useAutoCheckinStore((s) => s.loaded);
  const loadAuto = useAutoCheckinStore((s) => s.load);
  const autoAvailable = autoLoaded && autoConfig !== null;

  const location = useLocation();
  // A seed opens a prefilled builder; `startNew` (the Home quick-action) opens a blank start step directly
  // (60 §3.1.2 — link to the action, not the list).
  const navState = location.state as { seed?: BuilderSeed; startNew?: boolean } | null;
  const [selection, setSelection] = useState<Selection>(
    navState?.seed
      ? { mode: 'start', seed: navState.seed }
      : navState?.startNew
        ? { mode: 'start' }
        : { mode: 'none' },
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Which top-level tab is showing (§3.1 redesign): your Sent library, questionnaires Received by you, or
  // the Auto check-ins config. Session state — defaults to Sent.
  const [tab, setTab] = useState<'sent' | 'received' | 'auto'>('sent');
  // Collapse (status groups) and "show more" expansion. Session state — resets when you leave the page.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggleIn = (setter: typeof setCollapsed, key: string): void =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Toolbars.
  const [sentSearch, setSentSearch] = useState('');
  const [sentFilter, setSentFilter] = useState<'all' | SentStatus>('all');
  const [sentSort, setSentSort] = useState<SentSort>('answered');
  const [recvSearch, setRecvSearch] = useState('');
  const [recvFilter, setRecvFilter] = useState('all');

  const removeSuggestion = (from?: { recipientPersonId: string; suggestionId: string }): void => {
    if (!from) return;
    void deleteSuggestion(from.recipientPersonId, from.suggestionId);
  };

  const closeDetail = useCallback((): void => {
    setSelection({ mode: 'none' });
    void load();
    void loadInbox();
  }, [load, loadInbox]);

  const onDeleteFromList = async (id: string): Promise<void> => {
    setConfirmDeleteId(null);
    setDeleteError(null);
    try {
      await remove(id);
      setSelection((s) => (s.mode === 'edit' && s.id === id ? { mode: 'none' } : s));
    } catch {
      setDeleteError(
        'You don’t have permission to delete that one — it may have already been sent by someone else.',
      );
    }
  };

  const handleAnalyze = async (questionnaireId: string, assignmentId: string): Promise<void> => {
    setAnalyzingId(questionnaireId);
    setAnalyzeError(null);
    try {
      const result = await analyze(assignmentId);
      // Surface a calm message on failure (AI off / over budget / denied) — never fail silently.
      if (!result.ok) {
        setAnalyzeError(
          ('message' in result && result.message) || 'Couldn’t analyze those responses right now.',
        );
      }
    } finally {
      setAnalyzingId(null);
    }
  };

  useEffect(() => {
    void load();
    void loadTypes();
    void loadInbox();
    void loadAuto();
  }, [load, loadTypes, loadInbox, loadAuto]);

  // If the Auto tab is showing and auto check-ins stops being available (e.g. switching to a person without
  // it — the component doesn't remount), fall back to Sent so the content area is never left blank.
  useEffect(() => {
    if (tab === 'auto' && !autoAvailable) setTab('sent');
  }, [tab, autoAvailable]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const focusId = params.get('focus');
    if (!focusId) return;
    setSelection({
      mode: 'edit',
      id: focusId,
      ...(params.get('view') === 'results' ? { view: 'results' as const } : {}),
    });
  }, [location.search, location.key]);

  const selected =
    selection.mode === 'edit' ? (questionnaires.find((q) => q.id === selection.id) ?? null) : null;
  const detailOpen = selection.mode !== 'none';

  // Assemble the sent entries once, then filter/group/sort.
  const entries: SentEntry[] = useMemo(
    () =>
      questionnaires.map((q) => ({
        questionnaire: q,
        ...(sendStates[q.id] ? { sendState: sendStates[q.id] } : {}),
        ...(sentOverview[q.id] ? { overview: sentOverview[q.id] } : {}),
        isDraft: !sendStates[q.id] && validateQuestionnaire(q).length > 0,
      })),
    [questionnaires, sendStates, sentOverview],
  );
  const filteredSent = entries.filter(
    (e) =>
      matchesQuery(e.questionnaire, sentSearch) &&
      (sentFilter === 'all' || sentStatusOf(e) === sentFilter),
  );
  const groups = SENT_GROUPS.map((g) => ({
    ...g,
    entries: sortSent(
      filteredSent.filter((e) => sentStatusOf(e) === g.status),
      sentSort,
    ),
  })).filter((g) => g.entries.length > 0);

  const received = inboxItems.filter((i) => !i.fromSelf);
  const filteredReceived = received
    .filter(
      (i) =>
        (i.title.toLowerCase().includes(recvSearch.trim().toLowerCase()) || !recvSearch.trim()) &&
        receivedFilterMatch(i, recvFilter),
    )
    .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));

  const hasSent = entries.length > 0;
  const hasReceived = received.length > 0;
  // Received questionnaires you still have to answer — drives the amber accent on the Received tab count.
  const receivedToAnswer = received.filter((i) => i.answerable).length;

  const buildDuplicateSeed = (id: string): BuilderSeed | null => {
    const q = questionnaires.find((x) => x.id === id);
    if (!q) return null;
    return { title: `${q.title} (copy)`, type: q.type, questions: q.questions };
  };

  const chev = (key: string): JSX.Element => (
    <ChevronDown
      size={16}
      aria-hidden="true"
      className={`${styles.chev} ${collapsed.has(key) ? styles.chevCollapsed : ''}`}
    />
  );

  // The WAI-ARIA tabs pattern: roving tabindex (only the active tab is in the tab order) + arrow/Home/End
  // move + activate focus across the currently-visible tabs.
  const visibleTabs: ('sent' | 'received' | 'auto')[] = [
    'sent',
    'received',
    ...(autoAvailable ? (['auto'] as const) : []),
  ];
  const onTabKeyDown = (e: KeyboardEvent): void => {
    const idx = visibleTabs.indexOf(tab);
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % visibleTabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + visibleTabs.length) % visibleTabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = visibleTabs.length - 1;
    else return;
    e.preventDefault();
    const key = visibleTabs[next];
    if (!key) return;
    setTab(key);
    document.getElementById(`qtab-${key}`)?.focus();
  };

  return (
    <div className={styles.page} data-view={detailOpen ? 'detail' : 'list'}>
      {!detailOpen ? (
        <>
          <div className={styles.header}>
            <div>
              <Heading level={2}>Questionnaires</Heading>
              <Text tone="secondary">Ask the people in your life. See what’s come back.</Text>
            </div>
            <div className={styles.headerActions}>
              <Button variant="secondary" onClick={() => setSelection({ mode: 'suggested' })}>
                <Sparkles size={16} aria-hidden="true" />
                Suggested
              </Button>
              <Button variant="primary" onClick={() => setSelection({ mode: 'start' })}>
                <Plus size={16} aria-hidden="true" />
                New
              </Button>
            </div>
          </div>

          {deleteError ? <Banner tone="warning">{deleteError}</Banner> : null}
          {analyzeError ? <Banner tone="warning">{analyzeError}</Banner> : null}

          <div className={styles.tabs} role="tablist" aria-label="Questionnaires">
            <button
              type="button"
              role="tab"
              id="qtab-sent"
              aria-controls="qpanel-sent"
              aria-selected={tab === 'sent'}
              tabIndex={tab === 'sent' ? 0 : -1}
              className={`${styles.tab} ${tab === 'sent' ? styles.tabActive : ''}`}
              onClick={() => setTab('sent')}
              onKeyDown={onTabKeyDown}
            >
              Sent
              {entries.length > 0 ? (
                <span className={styles.tabCount}>{entries.length}</span>
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              id="qtab-received"
              aria-controls="qpanel-received"
              aria-selected={tab === 'received'}
              tabIndex={tab === 'received' ? 0 : -1}
              className={`${styles.tab} ${tab === 'received' ? styles.tabActive : ''}`}
              onClick={() => setTab('received')}
              onKeyDown={onTabKeyDown}
            >
              Received
              {received.length > 0 ? (
                <span
                  className={`${styles.tabCount} ${receivedToAnswer > 0 ? styles.tabCountAttn : ''}`}
                >
                  {received.length}
                </span>
              ) : null}
            </button>
            {autoAvailable ? (
              <button
                type="button"
                role="tab"
                id="qtab-auto"
                aria-controls="qpanel-auto"
                aria-selected={tab === 'auto'}
                tabIndex={tab === 'auto' ? 0 : -1}
                className={`${styles.tab} ${tab === 'auto' ? styles.tabActive : ''}`}
                onClick={() => setTab('auto')}
                onKeyDown={onTabKeyDown}
              >
                Auto check-ins
                <span
                  className={`${styles.autoDot} ${autoConfig?.enabled ? styles.autoDotOn : ''}`}
                  title={autoConfig?.enabled ? 'On' : 'Off'}
                  aria-hidden="true"
                />
              </button>
            ) : null}
          </div>

          {tab === 'sent' ? (
            <section
              className={styles.section}
              role="tabpanel"
              id="qpanel-sent"
              aria-label="Sent questionnaires"
            >
              <div className={styles.toolbar}>
                <span className={styles.tbSearch}>
                  <Search size={15} aria-hidden="true" />
                  <input
                    aria-label="Search sent questionnaires"
                    placeholder="Search"
                    value={sentSearch}
                    onChange={(e) => setSentSearch(e.target.value)}
                  />
                </span>
                <span className={styles.tbSpacer} aria-hidden="true" />
                <select
                  className={styles.tbSelect}
                  aria-label="Filter sent by status"
                  value={sentFilter}
                  onChange={(e) => setSentFilter(e.target.value as 'all' | SentStatus)}
                >
                  <option value="all">All statuses</option>
                  <option value="draft">Drafts</option>
                  <option value="awaiting">Awaiting</option>
                  <option value="answered">Answered</option>
                  <option value="analyzed">Analyzed</option>
                </select>
                <select
                  className={styles.tbSelect}
                  aria-label="Sort sent questionnaires"
                  value={sentSort}
                  onChange={(e) => setSentSort(e.target.value as SentSort)}
                >
                  <option value="answered">Recently answered</option>
                  <option value="analyzed">Recently analyzed</option>
                  <option value="recent">Recently sent</option>
                  <option value="title">Title A–Z</option>
                </select>
              </div>

              {!hasSent ? (
                loaded ? (
                  <Card>
                    <div className={styles.emptyState}>
                      <ClipboardList size={24} aria-hidden="true" />
                      <Text tone="secondary">
                        No questionnaires yet. Use <strong>New</strong> above to create one and
                        gather honest input from the people in your life — or{' '}
                        <strong>Suggested</strong> to let the coach propose one worth sending.
                      </Text>
                    </div>
                  </Card>
                ) : null
              ) : groups.length === 0 ? (
                <Text tone="tertiary">No questionnaires match your search.</Text>
              ) : (
                groups.map((g) => {
                  const groupKey = `grp:${g.status}`;
                  const groupCollapsed = collapsed.has(groupKey);
                  const groupExpanded = expanded.has(groupKey);
                  const visible = groupExpanded ? g.entries : g.entries.slice(0, PAGE_SIZE);
                  return (
                    <div className={styles.group} key={g.status}>
                      <button
                        type="button"
                        className={styles.groupHead}
                        aria-expanded={!groupCollapsed}
                        onClick={() => toggleIn(setCollapsed, groupKey)}
                      >
                        {chev(groupKey)}
                        <span className={`${styles.groupDot} ${DOT_CLASS[g.status]}`} />
                        <span className={styles.groupLabel}>{g.label}</span>
                        <span className={styles.groupCount}>{g.entries.length}</span>
                      </button>
                      {!groupCollapsed ? (
                        <>
                          <div className={styles.grid}>
                            {visible.map((e) => {
                              const q = e.questionnaire;
                              return (
                                <SentCard
                                  key={q.id}
                                  questionnaire={q}
                                  {...(e.overview ? { overview: e.overview } : {})}
                                  {...(e.sendState ? { sendState: e.sendState } : {})}
                                  isDraft={e.isDraft}
                                  confirmingDelete={confirmDeleteId === q.id}
                                  analyzing={analyzingId === q.id}
                                  onOpen={() => setSelection({ mode: 'edit', id: q.id })}
                                  onToggleFavorite={() => void setFavorite(q.id, !q.favorite)}
                                  {...(e.sendState && !e.sendState.answered
                                    ? {
                                        onShare: () =>
                                          setSelection({ mode: 'edit', id: q.id, share: true }),
                                      }
                                    : {})}
                                  onDuplicate={() => {
                                    const seed = buildDuplicateSeed(q.id);
                                    if (seed) setSelection({ mode: 'start', seed });
                                  }}
                                  onAnalyze={(assignmentId) =>
                                    void handleAnalyze(q.id, assignmentId)
                                  }
                                  onDelete={() => setConfirmDeleteId(q.id)}
                                  onConfirmDelete={() => void onDeleteFromList(q.id)}
                                  onCancelDelete={() => setConfirmDeleteId(null)}
                                />
                              );
                            })}
                          </div>
                          {g.entries.length > visible.length ? (
                            <button
                              type="button"
                              className={styles.showMore}
                              onClick={() => toggleIn(setExpanded, groupKey)}
                            >
                              Show {g.entries.length - visible.length} more
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  );
                })
              )}
            </section>
          ) : null}

          {tab === 'received' ? (
            <section
              className={styles.section}
              role="tabpanel"
              id="qpanel-received"
              aria-label="Received questionnaires"
            >
              {hasReceived ? (
                <div className={styles.toolbar}>
                  <span className={styles.tbSearch}>
                    <Search size={15} aria-hidden="true" />
                    <input
                      aria-label="Search received questionnaires"
                      placeholder="Search"
                      value={recvSearch}
                      onChange={(e) => setRecvSearch(e.target.value)}
                    />
                  </span>
                  <span className={styles.tbSpacer} aria-hidden="true" />
                  <select
                    className={styles.tbSelect}
                    aria-label="Filter received by status"
                    value={recvFilter}
                    onChange={(e) => setRecvFilter(e.target.value)}
                  >
                    <option value="all">All statuses</option>
                    <option value="new">New</option>
                    <option value="inProgress">In progress</option>
                    <option value="submitted">Submitted</option>
                  </select>
                </div>
              ) : null}

              {!hasReceived ? (
                inboxLoaded ? (
                  <Card>
                    <div className={styles.emptyState}>
                      <InboxIcon size={24} aria-hidden="true" />
                      <Text tone="secondary">
                        Nothing sent to you yet. When someone sends you a questionnaire — or SelfOS
                        creates a check-in for you — it’ll show up here.
                      </Text>
                    </div>
                  </Card>
                ) : null
              ) : filteredReceived.length === 0 ? (
                <Text tone="tertiary">No questionnaires match your search.</Text>
              ) : (
                <>
                  <div className={styles.grid}>
                    {(expanded.has('sec:received')
                      ? filteredReceived
                      : filteredReceived.slice(0, PAGE_SIZE)
                    ).map((item) => (
                      <ReceivedCard
                        key={item.assignmentId}
                        item={item}
                        onOpen={() =>
                          setSelection({ mode: 'answer', assignmentId: item.assignmentId })
                        }
                        onToggleFavorite={() =>
                          void setInboxFavorite(item.assignmentId, !item.favorite)
                        }
                      />
                    ))}
                  </div>
                  {filteredReceived.length > PAGE_SIZE && !expanded.has('sec:received') ? (
                    <button
                      type="button"
                      className={styles.showMore}
                      onClick={() => toggleIn(setExpanded, 'sec:received')}
                    >
                      Show {filteredReceived.length - PAGE_SIZE} more
                    </button>
                  ) : null}
                </>
              )}
            </section>
          ) : null}

          {tab === 'auto' && autoAvailable ? (
            <div role="tabpanel" id="qpanel-auto" aria-labelledby="qtab-auto">
              <AutoCheckinsPanel />
            </div>
          ) : null}
        </>
      ) : (
        <div className={styles.detail}>
          <button type="button" className={styles.back} onClick={closeDetail}>
            <ArrowLeft size={16} aria-hidden="true" />
            Questionnaires
          </button>
          {selection.mode === 'suggested' ? (
            <SuggestedPanel
              onCreate={(create) =>
                setSelection({
                  mode: 'new',
                  seed: create.seed,
                  recipient: { kind: 'person', personId: create.recipientPersonId },
                  compat: false,
                  fromSuggestion: {
                    recipientPersonId: create.recipientPersonId,
                    suggestionId: create.suggestionId,
                  },
                })
              }
            />
          ) : selection.mode === 'start' ? (
            <NewQuestionnaireStart
              onCancel={closeDetail}
              onChosen={(choice) =>
                setSelection({
                  mode: 'new',
                  ...(selection.seed ? { seed: selection.seed } : {}),
                  ...(choice.recipient ? { recipient: choice.recipient } : {}),
                  compat: choice.compat,
                })
              }
            />
          ) : selection.mode === 'new' ? (
            <QuestionnaireBuilder
              key={selection.seed ? 'new-seeded' : 'new'}
              questionnaire={null}
              compat={selection.compat}
              {...(selection.recipient ? { initialRecipient: selection.recipient } : {})}
              {...(selection.seed ? { seed: selection.seed } : {})}
              {...(selection.fromSuggestion
                ? { onCreated: () => removeSuggestion(selection.fromSuggestion) }
                : {})}
              onDuplicate={(seed) => setSelection({ mode: 'start', seed })}
              onDone={closeDetail}
            />
          ) : selection.mode === 'answer' ? (
            <InboxAnswer
              key={selection.assignmentId}
              assignmentId={selection.assignmentId}
              onDone={closeDetail}
            />
          ) : selected ? (
            <QuestionnaireBuilder
              key={selected.id}
              questionnaire={selected}
              {...(selection.mode === 'edit' && selection.share ? { initialShare: true } : {})}
              {...(selection.mode === 'edit' && selection.view === 'results'
                ? { initialView: 'results' as const }
                : {})}
              onDuplicate={(seed) => setSelection({ mode: 'start', seed })}
              onDone={closeDetail}
            />
          ) : (
            <div className={styles.empty}>
              <Text tone="tertiary">Select a questionnaire, or create a new one.</Text>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

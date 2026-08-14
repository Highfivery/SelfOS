import {
  Banner,
  Button,
  Card,
  Heading,
  Inline,
  Markdown,
  Stack,
  Text,
  TextInput,
} from '../../../design-system/components';
import { useInsightStore } from '../../../stores/insightStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useStoryStore } from '../../../stores/storyStore';
import { aiUnavailableMessage } from '../../AiUnavailableNotice';
import styles from './Books.module.css';
import { aggregateCrisisSignal } from '@selfos/core/coaching';
import { manuscriptMetrics } from '@selfos/core/story-metrics';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { BookManifest, StoryBookBundle } from '@shared/schemas';
import { BookSwitcher } from './BookSwitcher';
import { ChaptersTab } from './ChaptersTab';
import { CompletenessMeter } from './CompletenessMeter';
import { CoverPanel } from './CoverPanel';
import { DangerZone } from './DangerZone';
import { InterviewTab } from './InterviewTab';
import { MatterEditor } from './MatterEditor';
import { NeedsYou } from './NeedsYou';
import { ShareReadersPanel } from './ShareReadersPanel';
import { SharedWithYou } from './SharedWithYou';
import { StorySettingsPanel } from './StorySettingsPanel';
import { PeopleTab } from './PeopleTab';
import { TimelinePanel } from './TimelinePanel';
import { StudioKebab } from './StudioKebab';
import { TitleWorkshop } from './TitleWorkshop';
import { TodoSheet } from './TodoSheet';
import { LENGTH_OPTIONS, stylesForType } from './bookConfigOptions';
import { driftCards } from './driftCards';
import { STUDIO_TABS, TAB_LABEL, isStudioTab } from './studioTabs';
import type { StudioTab } from './studioTabs';

export function StudioLayout({
  bundle,
  books,
  onSwitchBook,
  onStartNewBook,
  onBackToShelf,
  onOpenChapter,
  onReadBook,
  aiUnavailable = false,
}: {
  bundle: StoryBookBundle;
  /** Every book the active person owns (§19.2) — drives the shelf switcher in the hero. */
  books: BookManifest[];
  onSwitchBook: (bookId: string) => void;
  onStartNewBook: () => void;
  /** Back to the shelf (§3.1) — a book is one of several now, not the whole section. */
  onBackToShelf: () => void;
  onOpenChapter: (chapterId: string) => void;
  onReadBook: () => void;
  /** AI unavailable (no key / off) — drives the honest refresh copy (never "turn on AI" when it IS on). */
  aiUnavailable?: boolean;
}): JSX.Element {
  const generateChapters = useStoryStore((s) => s.generateChapters);
  const [workshop, setWorkshop] = useState(false);
  const refreshBook = useStoryStore((s) => s.refreshBook);
  const proposals = useStoryStore((s) => s.proposals);
  const loadProposals = useStoryStore((s) => s.loadProposals);
  const resolveProposal = useStoryStore((s) => s.resolveProposal);
  const completeness = useStoryStore((s) => s.completeness);
  const loadCompleteness = useStoryStore((s) => s.loadCompleteness);
  const runInterviewCheck = useStoryStore((s) => s.runInterviewCheck);
  const update = useStoryStore((s) => s.update);
  const todos = useStoryStore((s) => s.todos);
  const loadTodos = useStoryStore((s) => s.loadTodos);
  const exclusions = useStoryStore((s) => s.exclusions);
  const loadExclusions = useStoryStore((s) => s.loadExclusions);
  const newMaterial = useStoryStore((s) => s.newMaterial);
  const loadNewMaterial = useStoryStore((s) => s.loadNewMaterial);
  const acceptMaterial = useStoryStore((s) => s.acceptMaterial);
  const declineMaterial = useStoryStore((s) => s.declineMaterial);
  const finishEdition = useStoryStore((s) => s.finishEdition);
  const reopenBook = useStoryStore((s) => s.reopenBook);
  const progress = useStoryStore((s) => s.progress);
  const busy = useStoryStore((s) => s.chaptersGenerating);
  const imageUrls = useStoryStore((s) => s.imageUrls);
  const getImageUrl = useStoryStore((s) => s.getImageUrl);
  const loadImages = useStoryStore((s) => s.loadImages);

  const { manifest, outline, chapters } = bundle;
  const bookId = manifest.id;

  // Tab routing: the URL is the deep-linkable source of truth, mirrored into state so it also works with no
  // Route context (RTL renders <Story/> directly). Clicking a tab updates both.
  // `/books/<bookId>/<tab>` — segment 0 is the book, segment 1 the tab.
  const bookTypes = useStoryStore((s) => s.bookTypes);
  const bookTypeView = bookTypes.find((bt) => bt.id === manifest.type);
  const typeLabel = bookTypeView?.label ?? bundle.manifest.type;
  const segments = (useParams()['*'] ?? '').split('/').filter(Boolean);
  const routeTab = segments[1] ?? '';
  const navigate = useNavigate();
  const [tab, setTab] = useState<StudioTab>(isStudioTab(routeTab) ? routeTab : 'chapters');
  useEffect(() => {
    if (isStudioTab(routeTab)) setTab(routeTab);
  }, [routeTab]);
  const goTab = (t: StudioTab): void => {
    setTab(t);
    navigate(
      t === 'chapters' ? `/books/${bundle.manifest.id}` : `/books/${bundle.manifest.id}/${t}`,
    );
  };

  const [error, setError] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [interviewBusy, setInterviewBusy] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null); // non-null while renaming
  const [todoSheetOpen, setTodoSheetOpen] = useState(false);
  const canManageAi = useSessionStore((s) => s.can('settings.manage'));

  useEffect(() => {
    void loadProposals(bookId);
    void loadCompleteness(bookId);
    void loadTodos(bookId);
    void loadExclusions(bookId);
    void loadImages(bookId);
    void loadNewMaterial(bookId);
  }, [
    bookId,
    loadProposals,
    loadCompleteness,
    loadTodos,
    loadExclusions,
    loadImages,
    loadNewMaterial,
  ]);

  // The crisis-quiet state (§8.2/§13.4): while the person's own signals show recurring distress, the
  // biographer's auto cadences pause host-side — SURFACE that instead of letting the pause read as broken.
  // Renderer-computed from the person's own approved insights (the Home CrisisSupportBanner precedent).
  const activePersonIdForCrisis = useSessionStore((s) => s.activePerson?.id);
  const insights = useInsightStore((s) => s.insights);
  useEffect(() => {
    void useInsightStore.getState().load();
  }, [activePersonIdForCrisis]);
  const crisisQuiet = useMemo(() => {
    const own = insights.filter((i) => i.approved && i.subjectPersonId === activePersonIdForCrisis);
    return aggregateCrisisSignal({ insights: own, nightmareNudge: false, now: new Date() })
      .recurring;
  }, [insights, activePersonIdForCrisis]);

  // Resolve the data URLs the chapter cards use as their background: each chapter's own illustration where it
  // has one, otherwise the book cover — so the grid gets richer as art is added (§3.1 redesign).
  useEffect(() => {
    const ids = new Set<string>();
    if (manifest.coverImageId) ids.add(manifest.coverImageId);
    for (const c of chapters) {
      const first = c.imagePlacements[0]?.imageId;
      if (first) ids.add(first);
    }
    for (const id of ids) if (!imageUrls[id]) void getImageUrl(bookId, id);
  }, [bookId, manifest.coverImageId, chapters, imageUrls, getImageUrl]);

  const outlineChapters = outline ? outline.parts.flatMap((p) => p.chapters) : [];
  const writtenById = new Map(
    chapters.filter((c) => c.markdown.trim().length > 0).map((c) => [c.id, c]),
  );
  const writtenInOrder = outlineChapters
    .map((c) => writtenById.get(c.id))
    .filter((c): c is (typeof chapters)[number] => Boolean(c));
  const pending = outlineChapters.filter((c) => !writtenById.has(c.id)).length;
  const metrics = manuscriptMetrics(chapters);
  // Only chapters with PROSE can have "new material to fold in" (72 §5.4). A never-written shell is stamped
  // `stale` by `chapterShell`, so this used to report unwritten chapters as needing a refresh — Ben's book
  // said "34 chapters have new material" when 11 of them had never been written at all. Unwritten chapters
  // are already surfaced honestly by `pending` + the "Not yet written" cards.
  // What the book has fallen out of step with (72 §4.4) — new material that could go in, and chapters the
  // author's own edits left behind. Proposals, never a status: nothing is rewritten until they say so.
  const drift = driftCards(newMaterial, chapters);
  const staleCount = drift.length;
  const toReview = writtenInOrder.filter((c) => c.status === 'new' || c.status === 'updated');
  const openTodos = todos.filter((t) => t.status === 'open' || t.status === 'questionsSent');
  const firstWritten = writtenInOrder[0];

  // A chapter-write in progress for THIS book → show the rich progress inline in the Chapters tab.
  const chapterProgress =
    progress && progress.scope === 'chapters' && progress.bookId === bookId ? progress : null;

  const doRefresh = async (): Promise<void> => {
    setError(null);
    setRefreshNotice(null);
    const res = await refreshBook(bookId, { auto: false });
    await loadProposals(bookId);
    const bits: string[] = [];
    if (res.rewritten > 0)
      bits.push(
        `Brought ${res.rewritten} chapter${res.rewritten === 1 ? '' : 's'} up to date with what’s new.`,
      );
    // Honest reasons (§8.2): a pass that left stale chapters behind says WHY — the budget, the weekly cap,
    // or AI being off — never a wrong "turn on AI" when the real cause was the budget.
    if (res.budgetReached) {
      // The budget stopped the pass — name the count only when chapters actually remain stale (a pass that
      // rewrote everything it could before hitting the budget leaves none, so don't invent "some").
      bits.push(
        res.staled > 0
          ? `The AI budget for this period is used up — ${res.staled} chapter${res.staled === 1 ? '' : 's'} with new material will update next period.`
          : 'The AI budget for this period is used up — any remaining updates will pick up next period.',
      );
    } else if (res.capped) {
      bits.push(
        'Your biographer has already rewritten its weekly allowance of chapters — the rest update next week.',
      );
    } else if (res.rewritten === 0 && res.staled > 0) {
      // No flag → either AI is unavailable (the bridge ran mark-stale only) or the rewrites failed.
      bits.push(
        `${res.staled} chapter${res.staled === 1 ? ' has' : 's have'} new material to fold in — ${
          aiUnavailable
            ? canManageAi
              ? 'turn on AI in Settings → AI to update ' + (res.staled === 1 ? 'it.' : 'them.')
              : 'ask the person who set up this household to turn on AI.'
            : 'the update didn’t finish; try again in a moment.'
        }`,
      );
    }
    if (res.proposalsAdded)
      bits.push(
        `${res.proposalsAdded} suggested change${res.proposalsAdded === 1 ? '' : 's'} to review below.`,
      );
    setRefreshNotice(bits.length > 0 ? bits.join(' ') : 'This book is up to date.');
  };

  // What this book is COUNTED in — pages for a picture book, chapters for everything else (72 §3.1). The
  // shelf has said "11 of 32 pages" since P5; the workspace saying "2 chapters" about the same book was the
  // app disagreeing with itself about what the thing is made of.
  const unit = bookTypeView?.unit ?? { one: 'chapter', many: 'chapters' };
  // A pair-owned book's `personId` is the pairKey (`a~b`); the other id is the partner.
  const householdPeople = usePeopleStore((s) => s.people);
  const loadHousehold = usePeopleStore((s) => s.load);
  useEffect(() => {
    // Only a shared book needs a name for its partner; every other book never reads this.
    if (bookTypeView?.sharedWithPartner) void loadHousehold();
  }, [bookTypeView?.sharedWithPartner, loadHousehold]);
  const sharedPartnerName = (() => {
    if (!bookTypeView?.sharedWithPartner) return null;
    const other = manifest.personId.split('~').find((id) => id !== activePersonIdForCrisis);
    return householdPeople.find((p) => p.id === other)?.displayName ?? null;
  })();
  const countUnit = (n: number): string => `${n} ${n === 1 ? unit.one : unit.many}`;
  const chips = [
    manifest.config.voice === 'first' ? 'First person' : 'Third person',
    stylesForType(bookTypeView?.stylePresets).find((s) => s.value === manifest.config.style)
      ?.label ?? manifest.config.style,
    // A page book's length is its page count, which the count chip already states — "Full length" beside
    // "16 pages" is a second, contradicting answer to the same question.
    ...(unit.one === 'page'
      ? []
      : [
          `${LENGTH_OPTIONS.find((l) => l.value === manifest.config.length)?.label ?? manifest.config.length} length`,
        ]),
    countUnit(chapters.length),
    // The one book with a second author. Both partners write and read it, so saying who is not decoration —
    // it is the difference between a private draft and something another person is reading (72 §5.8).
    ...(sharedPartnerName ? [`Shared with ${sharedPartnerName}`] : []),
  ];

  return (
    <div className={styles.studio}>
      {/* ---- Hero: the book's identity ---- */}
      <div className={styles.hero}>
        <div className={styles.heroCover}>
          <CoverPanel
            bookId={bookId}
            {...(manifest.coverImageId ? { coverImageId: manifest.coverImageId } : {})}
            permitsLikeness={bookTypeView?.castPolicy === 'childrenAsHeroes'}
          />
        </div>
        <div className={styles.heroBody}>
          <div className={styles.heroEyebrowRow}>
            {/* The book's OWN type. This read "Your story · Biography" for every book — wrong for a
                memoir, a dream book or an erotica the moment more than one type existed (72 §3.2). */}
            <span className={styles.partEyebrow}>{typeLabel}</span>
            <button type="button" className={styles.backToShelf} onClick={onBackToShelf}>
              ← All books
            </button>
            <BookSwitcher
              books={books}
              currentId={bookId}
              onSwitch={onSwitchBook}
              onStartNew={onStartNewBook}
            />
          </div>
          {titleDraft === null ? (
            <div className={styles.heroTitleRow}>
              <Heading level={1}>{manifest.title}</Heading>
              <button
                type="button"
                className={styles.sourcesToggle}
                aria-label="Rename this book"
                onClick={() => setTitleDraft(manifest.title)}
              >
                Rename
              </button>
              {!aiUnavailable ? (
                <button
                  type="button"
                  className={styles.sourcesToggle}
                  onClick={() => setWorkshop((w) => !w)}
                >
                  Title workshop
                </button>
              ) : null}
            </div>
          ) : (
            <Inline gap={2}>
              <div className={styles.grow}>
                <TextInput
                  value={titleDraft}
                  aria-label="Book title"
                  onChange={(e) => setTitleDraft(e.target.value)}
                />
              </div>
              <Button
                variant="primary"
                disabled={titleDraft.trim().length === 0}
                onClick={async () => {
                  const next = titleDraft.trim();
                  if (next && next !== manifest.title) await update(bookId, { title: next });
                  setTitleDraft(null);
                }}
              >
                Save
              </Button>
              <Button variant="ghost" onClick={() => setTitleDraft(null)}>
                Cancel
              </Button>
            </Inline>
          )}
          {manifest.essence ? (
            <div className={styles.heroEssence}>
              <Markdown>{manifest.essence}</Markdown>
            </div>
          ) : null}
          {workshop && !aiUnavailable ? (
            <TitleWorkshop bookId={bookId} onDone={() => setWorkshop(false)} />
          ) : null}
          <div className={styles.heroChips}>
            {chips.map((c) => (
              <span key={c} className={styles.chip}>
                {c}
              </span>
            ))}
          </div>
          {staleCount > 0 ? (
            <Text size="sm" tone="tertiary">
              {staleCount} chapter{staleCount === 1 ? ' has' : 's have'} new material to fold in.
            </Text>
          ) : null}
          {crisisQuiet ? (
            <Text size="sm" tone="tertiary">
              Your biographer is resting while things are heavy — support comes first. The book
              waits for you; nothing is lost.
            </Text>
          ) : null}
          {completeness && chapters.length > 0 ? <CompletenessMeter c={completeness} /> : null}
          {metrics.totalWords > 0 ? (
            <Text size="sm" tone="tertiary">
              {metrics.totalWords.toLocaleString()} words across {metrics.writtenCount} written{' '}
              {metrics.writtenCount === 1 ? unit.one : unit.many}
              {metrics.writtenCount > 1
                ? ` · about ${metrics.averageWords.toLocaleString()} words each`
                : ''}
              .
            </Text>
          ) : null}

          {error ? <Banner tone="danger">{error}</Banner> : null}
          {refreshNotice ? <Banner tone="info">{refreshNotice}</Banner> : null}

          {chapters.length > 0 ? (
            <div className={styles.heroActions}>
              {firstWritten ? (
                <Button variant="primary" onClick={onReadBook}>
                  Read your story
                </Button>
              ) : null}
              <Button disabled={busy} onClick={() => void doRefresh()}>
                {busy ? 'Checking…' : 'Refresh from what’s new'}
                {staleCount > 0 ? <span className={styles.actionBadge}>{staleCount}</span> : null}
              </Button>
              <StudioKebab
                onExport={() => goTab('sharing')}
                onShare={() => goTab('sharing')}
                onRename={() => setTitleDraft(manifest.title)}
                onSettings={() => goTab('settings')}
                finished={manifest.lifecycle === 'finished'}
                onFinish={async () => {
                  setError(null);
                  const res = await finishEdition(bookId);
                  if (!res.ok) setError(res.message ?? 'That didn’t go through.');
                }}
                onReopen={() => void reopenBook(bookId)}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* ---- Needs you: pending decisions, gathered (hidden when caught up) ---- */}
      <NeedsYou
        unitOne={unit.one}
        unitMany={unit.many}
        proposals={proposals}
        drift={drift}
        busy={busy}
        toReviewCount={toReview.length}
        openTodoCount={openTodos.length}
        onReview={() => {
          if (toReview[0]) onOpenChapter(toReview[0].id);
        }}
        onOpenTodos={() => setTodoSheetOpen(true)}
        onApprove={async (id) => {
          setError(null);
          const r = await resolveProposal(bookId, id, 'approve');
          if (!r.ok && r.message) setError(r.message);
        }}
        onDismiss={(id) => void resolveProposal(bookId, id, 'dismiss')}
        onWeaveIn={async (chapterId) => {
          setError(null);
          const r = await acceptMaterial(bookId, chapterId);
          if (!r.ok && r.message) setError(r.message);
        }}
        onNotNow={(chapterId) => void declineMaterial(bookId, chapterId)}
      />

      {/* ---- Tabs ---- */}
      <div className={styles.tabs} role="tablist" aria-label="This book">
        {STUDIO_TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
            onClick={() => goTab(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === 'chapters' ? (
        <ChaptersTab
          bundle={bundle}
          chapterProgress={chapterProgress}
          pending={pending}
          isPageBook={bookTypeView?.unit.one === 'page'}
          onOpenChapter={onOpenChapter}
          onWrite={async () => {
            setError(null);
            const res = await generateChapters(bookId);
            if (!res.ok) setError(res.message);
            else if (res.budgetReached && res.message) setError(res.message);
          }}
        />
      ) : null}

      {tab === 'timeline' ? <TimelinePanel bundle={bundle} /> : null}
      {tab === 'people' ? (
        <PeopleTab bookId={bookId} castPolicy={bookTypeView?.castPolicy ?? 'realNames'} />
      ) : null}

      {tab === 'interview' ? (
        <InterviewTab
          bookId={bookId}
          parts={(bundle.outline?.parts ?? []).map((p) => ({ id: p.id, title: p.title }))}
          completeness={completeness}
          busy={interviewBusy}
          onFind={async () => {
            setInterviewBusy(true);
            try {
              // Honest outcomes (§8.2): AI-off, the weekly cap, the back-off, and crisis each explain
              // themselves — never a vague "check back later" for a state the person could act on.
              const res = await runInterviewCheck(bookId);
              switch (res.outcome) {
                case 'minted':
                  return 'Your biographer sent a few questions to your Inbox to fill a gap.';
                case 'openCheckin':
                  return 'You already have questions from your biographer waiting in your Inbox.';
                case 'noGaps':
                  return 'Nothing new to ask right now — your story is well covered.';
                case 'aiOff':
                  return aiUnavailableMessage({ canManageAi });
                case 'crisis':
                  return 'Your biographer is resting while things are heavy — support comes first.';
                case 'throttled':
                  if (res.throttleReason === 'weeklyCap')
                    return 'Your biographer has already taken stock twice this week — try again in a few days.';
                  if (res.throttleReason === 'backoff')
                    return 'The last questions expired unanswered, so your biographer is giving it a rest for now.';
                  return 'No new questions right now — check back later.';
                default:
                  return 'No new questions right now — check back later.';
              }
            } finally {
              setInterviewBusy(false);
            }
          }}
        />
      ) : null}

      {tab === 'sharing' ? (
        <ShareReadersPanel
          bookId={bookId}
          authorPersonId={manifest.personId}
          {...(manifest.publishedAt ? { publishedAt: manifest.publishedAt } : {})}
        />
      ) : null}

      {tab === 'settings' ? (
        <div className={styles.settingsTab}>
          <MatterEditor bookId={bookId} {...(manifest.matter ? { matter: manifest.matter } : {})} />
          <StorySettingsPanel
            bookId={bookId}
            config={manifest.config}
            {...(bookTypeView ? { stylePresets: bookTypeView.stylePresets } : {})}
          />
          {exclusions.length > 0 ? (
            <Card>
              <Stack gap={2}>
                <Heading level={2}>Never written about</Heading>
                <Text tone="secondary" size="sm">
                  Excluded everywhere, forever — until you allow it again.
                </Text>
                {exclusions.map((item) => {
                  const label = item.note ?? item.value;
                  return (
                    <div key={item.id} className={styles.markRow}>
                      <Text size="sm">{label}</Text>
                      <button
                        type="button"
                        className={styles.sourcesToggle}
                        aria-label={`Allow writing about ${label} again`}
                        onClick={() => void useStoryStore.getState().unexclude(bookId, item.id)}
                      >
                        Allow again
                      </button>
                    </div>
                  );
                })}
              </Stack>
            </Card>
          ) : null}
          <DangerZone bookId={bookId} title={manifest.title} />
        </div>
      ) : null}

      <SharedWithYou />

      {todoSheetOpen ? (
        <TodoSheet bookId={bookId} todos={openTodos} onClose={() => setTodoSheetOpen(false)} />
      ) : null}
    </div>
  );
}

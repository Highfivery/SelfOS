import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { wordDiff } from '@selfos/core/story-diff';
import {
  Banner,
  Button,
  Card,
  Field,
  Heading,
  Inline,
  Markdown,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  type SegmentOption,
} from '../../../design-system/components';
import { ImageStylePicker } from '../../../settings/ImageStyleControl';
import { useSessionStore } from '../../../stores/sessionStore';
import { useStoryStore } from '../../../stores/storyStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useInsightStore } from '../../../stores/insightStore';
import { useStoryRefresh } from '../../notifications/useStoryRefresh';
import { useStoryInterview } from '../../notifications/useStoryInterview';
import { useSetting } from '../../../settings/useSetting';
import { aiKeyResolved } from '../../aiAvailability';
import { AiUnavailableNotice, aiUnavailableMessage } from '../../AiUnavailableNotice';
import { CrisisFooter } from '../sessions/CrisisFooter';
import { aggregateCrisisSignal } from '@selfos/core/coaching';
import { ImageProgress } from './ImageProgress';
import { drawnFromChips, specimenFor } from './begin';
import { downscaleImage } from '../sessions/downscaleImage';
import { AdminOnlyBadge } from '../../../design-system/components';
import type {
  BookConfig,
  ChapterMarkup,
  ChapterVersion,
  StoryChapterHistoryView,
  BookMatter,
  CommentIntent,
  StoryBookBundle,
  StoryCompleteness,
  StoryCompletenessStage,
  StoryPartCoverage,
  StoryDraftProgress,
  StoryReaderView,
  StoryTodoEntry,
  StructuralProposal,
  TextAnchor,
} from '@shared/schemas';
import styles from './Story.module.css';

type Voice = BookConfig['voice'];
type Style = BookConfig['style'];
type Length = BookConfig['length'];

const VOICE_OPTIONS: SegmentOption<Voice>[] = [
  { value: 'third', label: 'Third person' },
  { value: 'first', label: 'First person' },
];
// Styles have grown past what a SegmentedControl can hold at phone width (§12 — no horizontal scroll), so the
// style picker is a full-width Select with a one-line hint for the chosen register.
const STYLE_CHOICES: { value: Style; label: string; hint: string }[] = [
  { value: 'literary', label: 'Literary', hint: 'Vivid, image-led prose with deliberate rhythm.' },
  { value: 'warm', label: 'Warm', hint: 'Plain, tender, dinner-table narration.' },
  { value: 'plain', label: 'Plain', hint: 'Direct, unadorned, concrete; short sentences.' },
  {
    value: 'journalistic',
    label: 'Journalistic',
    hint: 'Reportorial and evidence-led; clear and propulsive.',
  },
  {
    value: 'reflective',
    label: 'Reflective',
    hint: 'Essayistic and meditative; interior and thoughtful.',
  },
  {
    value: 'cinematic',
    label: 'Cinematic',
    hint: 'Scene-forward and dramatic; vivid set-pieces.',
  },
  { value: 'poetic', label: 'Poetic', hint: 'Lyrical and image-dense; heightened rhythm.' },
];
const LENGTH_OPTIONS: SegmentOption<Length>[] = [
  { value: 'concise', label: 'Concise' },
  { value: 'standard', label: 'Standard' },
  { value: 'full', label: 'Full' },
];
// The commission (§13.3) renders length as three cards with reading-terms sublabels.
const LENGTH_CARDS: { value: Length; label: string; sub: string }[] = [
  { value: 'concise', label: 'Concise', sub: 'A short read — a handful of focused chapters.' },
  { value: 'standard', label: 'Standard', sub: 'A full evening — a dozen or so chapters.' },
  { value: 'full', label: 'Full', sub: 'The whole story — as many chapters as it takes.' },
];

function Labeled({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <Stack gap={2}>
      <Text size="sm" tone="secondary">
        {label}
      </Text>
      {children}
    </Stack>
  );
}

export function Story(): JSX.Element {
  const activePersonId = useSessionStore((s) => s.activePerson?.id);
  const personName = useSessionStore((s) => s.activePerson?.displayName ?? '');
  const books = useStoryStore((s) => s.books);
  const bundle = useStoryStore((s) => s.bundle);
  const loaded = useStoryStore((s) => s.loaded);
  const progress = useStoryStore((s) => s.progress);
  const load = useStoryStore((s) => s.load);
  const open = useStoryStore((s) => s.open);
  const createAndDraft = useStoryStore((s) => s.createAndDraft);
  const draftBook = useStoryStore((s) => s.draftBook);
  const readerView = useStoryStore((s) => s.readerView);
  const closeSharedBook = useStoryStore((s) => s.closeSharedBook);
  const ownReader = useStoryStore((s) => s.ownReader);
  const openOwnBook = useStoryStore((s) => s.openOwnBook);
  const clearOwnReader = useStoryStore((s) => s.clearOwnReader);
  const setReadPosition = useStoryStore((s) => s.setReadPosition);
  const getImageUrl = useStoryStore((s) => s.getImageUrl);

  const navigate = useNavigate();
  // The read route: `/story/read` (front matter) or `/story/read/<chapterId>` — the immersive Book view (§13.5).
  const splat = useParams()['*'] ?? '';
  const readMode = splat === 'read' || splat.startsWith('read/');
  const routeChapterId = splat.startsWith('read/') ? splat.slice('read/'.length) : null;

  const [mode, setMode] = useState<'idle' | 'setup'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null); // the open chapter's id (editor), or null
  const [sharedChapterId, setSharedChapterId] = useState<string | null>(null); // shared-reader page

  // AI readiness for the BEGIN flow (§8.2 honest states): commissioning a book is the app's largest single
  // AI spend, so the invitation/commission must gate on the resolved key + the ai.enabled setting instead of
  // letting the create succeed and the draft strand the person on NeedsOutline with a role-blind error.
  // `null` = still checking (render nothing rather than flash the wrong state — the CoverPanel lesson).
  const [aiEnabled] = useSetting('ai.enabled');
  const [keyReady, setKeyReady] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    setKeyReady(null);
    void aiKeyResolved('anthropic').then((ok) => {
      if (live) setKeyReady(ok);
    });
    return () => {
      live = false;
    };
  }, [activePersonId]);
  const aiUnavailable = keyReady === false || aiEnabled === false;

  // The automatic living-book refresh cadence (§3.4) — nudges the bridge (daily-throttled + capped) for the
  // open book if its autoRefresh is on. Silent: it just re-stamps stale badges / weaves in new material.
  useStoryRefresh(bundle?.manifest.id ?? null, bundle?.manifest.config.autoRefresh ?? false);
  // The autonomous interview cadence (§3.7) — nudges the bridge (7-day-throttled + capped + ≤1 open) to gap-pass
  // the book + mint a story check-in when warranted. Silent: check-ins land gently in the Inbox.
  useStoryInterview(bundle?.manifest.id ?? null, bundle?.manifest.config.autoRefresh ?? false);

  useEffect(() => {
    void load();
  }, [load, activePersonId]);

  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setMode('idle');
    setError(null);
    setReading(null);
  }, [activePersonId]);

  // Open the first book once loaded so returning lands on it — but never while a draft is running (so it
  // can't race the create → draft sequence or open a book into a dead-end mid-generation).
  useEffect(() => {
    const first = books[0];
    if (loaded && first && !bundle && !progress) void open(first.id);
  }, [loaded, books, bundle, progress, open]);

  // Load the owner's own-book reader view when on the read route (and not editing). Re-runs when the editor
  // closes (`reading` → null) so returning from an edit shows the fresh prose. Clears it when leaving the route.
  const bookId = bundle?.manifest.id;
  useEffect(() => {
    if (readMode && !reading && bookId) void openOwnBook(bookId);
    if (!readMode) clearOwnReader();
  }, [readMode, reading, bookId, openOwnBook, clearOwnReader]);

  if (!loaded) return <div className={styles.page} aria-busy="true" />;

  // Reading a book someone shared with you takes over the surface (the published head, read-only) — the same
  // immersive reader, unified (§13.5).
  if (readerView) {
    return (
      <div className={styles.page}>
        <BookReader
          view={readerView}
          owner={false}
          chapterId={sharedChapterId}
          onNavigate={setSharedChapterId}
          onExit={() => {
            setSharedChapterId(null);
            closeSharedBook();
          }}
          resolveImage={async (imageId) => {
            const img = await window.selfos?.storyReadSharedImage({
              authorPersonId: readerView.authorPersonId,
              bookId: readerView.bookId,
              imageId,
            });
            return img ? `data:${img.mime};base64,${img.dataBase64}` : null;
          }}
        />
      </div>
    );
  }

  // A create-and-draft is in progress (§3.2) — the rich, full-screen writing screen (no book to show yet).
  // It survives navigation (the draft runs in main; the progress stream keeps this current). The
  // chapter-write from the overview (`scope: 'chapters'`) shows the SAME progress inline instead (below).
  if (progress && progress.scope === 'create') {
    return (
      <div className={styles.page}>
        <DraftProgress
          p={progress}
          outline={bundle?.outline ?? null}
          {...(bundle?.manifest.essence ? { essence: bundle.manifest.essence } : {})}
          onBrowse={() => navigate('/')}
        />
      </div>
    );
  }

  if (bundle) {
    if (bundle.outline) {
      // Editing a chapter (the markup surface) takes priority — it's reached from the reader's "Edit" or a
      // needs-you action, and returning to it (from within the reader) must show the editor.
      const openChapter = reading ? bundle.chapters.find((c) => c.id === reading) : undefined;
      if (openChapter) {
        return (
          <div className={styles.page}>
            <ChapterReader bundle={bundle} chapter={openChapter} onBack={() => setReading(null)} />
            <CrisisFooter />
          </div>
        );
      }
      // The immersive Book view (§13.5) — the owner reading their own draft head.
      if (readMode) {
        if (!ownReader) return <div className={styles.page} aria-busy="true" />;
        return (
          <div className={styles.page}>
            <BookReader
              view={ownReader.view}
              owner
              chapterId={routeChapterId}
              lastChapterId={ownReader.lastChapterId}
              onNavigate={(id) => navigate(id ? `/story/read/${id}` : '/story/read')}
              onExit={() => navigate('/story')}
              onEditChapter={(id) => setReading(id)}
              onSetPosition={(id) => setReadPosition(ownReader.view.bookId, id)}
              resolveImage={(imageId) => getImageUrl(ownReader.view.bookId, imageId)}
            />
          </div>
        );
      }
      return (
        <div className={styles.page}>
          <StudioLayout
            bundle={bundle}
            onOpenChapter={setReading}
            onReadBook={() => navigate('/story/read')}
            aiUnavailable={aiUnavailable}
          />
          <CrisisFooter />
        </div>
      );
    }
    // A book exists but has no outline yet — a draft that hasn't run, or one that failed. Offer to draft (or
    // retry) it, and surface any error, so it's never a silent dead-end.
    return (
      <div className={styles.page}>
        {aiUnavailable ? <AiUnavailableNotice /> : null}
        <NeedsOutline
          bundle={bundle}
          error={error}
          aiUnavailable={aiUnavailable}
          onGenerate={async () => {
            setError(null);
            const res = await draftBook(bundle.manifest.id);
            if (!res.ok && res.message) setError(res.message);
          }}
        />
        <CrisisFooter />
      </div>
    );
  }

  if (mode === 'setup') {
    return (
      <div className={styles.page}>
        {aiUnavailable ? <AiUnavailableNotice /> : null}
        <StorySetup
          titleHint={personName ? `e.g. The Story of ${personName}` : 'e.g. The Story of a Life'}
          personNameForPreview={personName}
          aiUnavailable={aiUnavailable}
          onCancel={() => setMode('idle')}
          onCreate={async (title, config) => {
            setError(null);
            setMode('idle');
            // Create AND draft the whole book in one flow — no outline-review gate. The draft screen shows
            // immediately (progress is seeded), and the finished book lands ready to edit.
            const res = await createAndDraft({ type: 'biography', title, config });
            if (!res.ok && res.message) setError(res.message);
          }}
        />
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <CrisisFooter />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {aiUnavailable ? <AiUnavailableNotice /> : null}
      <StoryInvitation
        onBegin={() => setMode('setup')}
        error={error}
        beginDisabled={aiUnavailable}
      />
      <SharedWithYou />
      <CrisisFooter />
    </div>
  );
}

/**
 * The invitation (§13.3) — the no-book empty state: the book as hero, the three-step promise, a "Drawn from"
 * chip row with real (deterministic, no-AI) counts of the material the biographer will draw from, the privacy
 * line, and "Begin your book". The "Shared with you" shelf renders below (the whole surface for a person who
 * only has books shared with them).
 */
function StoryInvitation({
  onBegin,
  error,
  beginDisabled = false,
}: {
  onBegin: () => void;
  error: string | null;
  /** True when AI is unavailable (no key / AI off) — the commission can't draft, so Begin is disabled and
   *  the role-aware AiUnavailableNotice above explains how to enable it (§8.2 honest states). */
  beginDisabled?: boolean;
}): JSX.Element {
  const corpusStats = useStoryStore((s) => s.corpusStats);
  const loadCorpusStats = useStoryStore((s) => s.loadCorpusStats);
  useEffect(() => {
    void loadCorpusStats();
  }, [loadCorpusStats]);

  const chips = corpusStats ? drawnFromChips(corpusStats) : [];

  return (
    <Card>
      <div className={styles.invitation}>
        <div className={styles.invitationCover} aria-hidden="true">
          <span className={styles.invitationCoverKicker}>A Biography</span>
          <span className={styles.invitationCoverTitle}>Your Story</span>
        </div>
        <div className={styles.invitationBody}>
          <Heading level={1}>Your life, written as a book</Heading>
          <Text tone="secondary">
            A biographer that reads everything you’ve shared with SelfOS and writes your story —
            chapter by chapter, in your voice. It keeps writing as your life grows.
          </Text>
          <div className={styles.promiseRow}>
            <div className={styles.promiseStep}>
              <span className={styles.promiseTitle}>It reads</span>
              <Text size="sm" tone="secondary">
                everything you’ve shared — nothing you haven’t.
              </Text>
            </div>
            <div className={styles.promiseStep}>
              <span className={styles.promiseTitle}>It writes</span>
              <Text size="sm" tone="secondary">
                a true, book-length life story from it.
              </Text>
            </div>
            <div className={styles.promiseStep}>
              <span className={styles.promiseTitle}>It keeps writing</span>
              <Text size="sm" tone="secondary">
                folding in new chapters as you go.
              </Text>
            </div>
          </div>
          {chips.length > 0 ? (
            <div className={styles.drawnFrom}>
              <Text size="sm" tone="tertiary">
                Drawn from
              </Text>
              <div className={styles.drawnChipRow}>
                {chips.map((chip) => (
                  <span key={chip} className={styles.drawnChip}>
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <Text size="sm" tone="secondary">
            Written from your private vault — nobody sees it until you choose to share.
          </Text>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <Inline>
            <Button variant="primary" disabled={beginDisabled} onClick={onBegin}>
              Begin your book
            </Button>
          </Inline>
        </div>
      </div>
    </Card>
  );
}

function StorySetup({
  titleHint,
  personNameForPreview,
  aiUnavailable = false,
  onCreate,
  onCancel,
}: {
  titleHint: string;
  personNameForPreview: string;
  /** AI unavailable → the create-and-draft CTA is disabled (the notice above the card explains why). */
  aiUnavailable?: boolean;
  onCreate: (title: string, config: BookConfig) => void | Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [voice, setVoice] = useState<Voice>('third');
  const [style, setStyle] = useState<Style>('warm');
  const [length, setLength] = useState<Length>('full');

  // "How your biographer will sound" — the specimen re-renders per style × voice (§13.3).
  const specimen = specimenFor('biography', { style, voice });

  return (
    <Card>
      <Stack gap={4}>
        <Stack gap={2}>
          <Heading level={2}>Commission your book</Heading>
          <Text tone="secondary">
            Your biographer reads everything it knows about you unless you exclude it later. Choose
            how it should read — and see how it will sound.
          </Text>
        </Stack>

        <div className={styles.commission}>
          {/* The form. */}
          <div className={styles.commissionForm}>
            <Labeled label="Title (optional)">
              <Stack gap={1}>
                <TextInput
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-label="Title"
                  placeholder={titleHint}
                />
                <Text size="sm" tone="secondary">
                  Leave blank and your biographer will suggest a title from your story — you can
                  rename it before it starts writing.
                </Text>
              </Stack>
            </Labeled>
            <Labeled label="Narrative voice">
              <SegmentedControl
                options={VOICE_OPTIONS}
                value={voice}
                onChange={setVoice}
                aria-label="Narrative voice"
              />
            </Labeled>
            <Labeled label="Style">
              <div className={styles.styleGallery} role="radiogroup" aria-label="Style">
                {STYLE_CHOICES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    role="radio"
                    aria-checked={style === s.value}
                    aria-label={s.label}
                    aria-describedby={`style-hint-${s.value}`}
                    className={`${styles.styleCard} ${style === s.value ? styles.styleCardOn : ''}`}
                    onClick={() => setStyle(s.value)}
                  >
                    <span className={styles.styleCardName}>{s.label}</span>
                    <span id={`style-hint-${s.value}`} className={styles.styleCardHint}>
                      {s.hint}
                    </span>
                  </button>
                ))}
              </div>
            </Labeled>
            <Labeled label="Length">
              <div className={styles.lengthCards} role="radiogroup" aria-label="Length">
                {LENGTH_CARDS.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    role="radio"
                    aria-checked={length === l.value}
                    aria-label={l.label}
                    aria-describedby={`length-hint-${l.value}`}
                    className={`${styles.lengthCard} ${length === l.value ? styles.lengthCardOn : ''}`}
                    onClick={() => setLength(l.value)}
                  >
                    <span className={styles.styleCardName}>{l.label}</span>
                    <span id={`length-hint-${l.value}`} className={styles.styleCardHint}>
                      {l.sub}
                    </span>
                  </button>
                ))}
              </div>
            </Labeled>
          </div>

          {/* The live preview rail. */}
          <aside className={styles.commissionPreview} aria-label="Preview">
            <div className={styles.previewCover} aria-hidden="true">
              <span className={styles.previewCoverKicker}>A Biography</span>
              <span className={styles.previewCoverTitle}>{title.trim() || titleHint}</span>
              {personNameForPreview ? (
                <span className={styles.previewCoverBy}>{personNameForPreview}</span>
              ) : null}
            </div>
            <div className={styles.previewSpecimen}>
              <Text size="sm" tone="tertiary">
                How your biographer will sound
              </Text>
              {specimen ? <p className={styles.previewSpecimenText}>{specimen}</p> : null}
            </div>
          </aside>
        </div>

        <Text size="sm" tone="secondary">
          Roughly 10–20 minutes to write the first draft — you can keep using SelfOS while it works.
        </Text>
        <Inline justify="flex-end">
          <Button onClick={onCancel}>Cancel</Button>
          {/* Honest label (§8.2): this click commissions the WHOLE first draft (outline + every chapter),
              the app's largest single AI run — not just an outline. */}
          <Button
            variant="primary"
            disabled={aiUnavailable}
            onClick={() => onCreate(title.trim(), { voice, style, length, autoRefresh: true })}
          >
            Write my book
          </Button>
        </Inline>
      </Stack>
    </Card>
  );
}

function NeedsOutline({
  bundle,
  error,
  aiUnavailable = false,
  onGenerate,
}: {
  bundle: StoryBookBundle;
  error: string | null;
  /** AI unavailable → drafting can only fail; disable the CTA (the notice above explains how to enable). */
  aiUnavailable?: boolean;
  onGenerate: () => void | Promise<void>;
}): JSX.Element {
  const remove = useStoryStore((s) => s.remove);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Stack gap={4}>
      <Heading level={1}>{bundle.manifest.title}</Heading>
      <Text tone="secondary">
        Your outline hasn’t been drafted yet. When you’re ready, your biographer will read
        everything it knows and propose the shape of your book.
      </Text>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Inline justify="space-between">
        <Button
          variant="primary"
          disabled={busy || aiUnavailable}
          onClick={async () => {
            setBusy(true);
            await onGenerate();
            setBusy(false);
          }}
        >
          {error ? 'Try again' : 'Draft the outline'}
        </Button>
        {confirmDelete ? (
          <Inline>
            <Button variant="danger" onClick={() => void remove(bundle.manifest.id)}>
              Delete
            </Button>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          </Inline>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
            Delete book
          </Button>
        )}
      </Inline>
    </Stack>
  );
}

/** mm:ss for a millisecond duration. */
function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A soft "about N left" from the observed pace (only once ≥1 chapter is done, so it's real, not guessed). */
function estimateRemaining(elapsedMs: number, done: number, total: number): string | null {
  if (done < 1 || total <= done) return null;
  const perChapter = elapsedMs / done;
  const leftSec = Math.round((perChapter * (total - done)) / 1000);
  if (leftSec <= 15) return 'almost done';
  if (leftSec < 90) return `about ${leftSec} sec left`;
  return `about ${Math.round(leftSec / 60)} min left`;
}

/**
 * The create-and-draft progress screen (§3.2) — real per-chapter progress with a live timer + estimate, and a
 * clear "you can keep working, this continues in the background" note. Driven by the store's `progress` (which
 * is fed by the main-side stream and survives navigation), so returning to /story mid-draft shows live status.
 */
function DraftProgress({
  p,
  outline = null,
  essence,
  onBrowse,
}: {
  p: StoryDraftProgress & { startedAt: number };
  outline?: StoryBookBundle['outline'] | null;
  essence?: string;
  onBrowse?: () => void;
}): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const writing = p.phase === 'writing';
  const total = p.chaptersTotal;
  const done = p.chaptersDone;
  const elapsed = now - p.startedAt;
  const pct = writing && total > 0 ? Math.min(99, 15 + (done / total) * 84) : 8;
  const eta = writing ? estimateRemaining(elapsed, done, total) : null;
  const phaseLabel = writing
    ? p.currentTitle
      ? `Writing “${p.currentTitle}” — chapter ${Math.min(done + 1, total)} of ${total}`
      : `Writing your chapters — ${done} of ${total}`
    : 'Reading everything you’ve shared, and shaping the outline…';

  // The outline reveals itself as it lands (the foundations pass) — chapters in order, marked done/current/
  // upcoming from the progress stream. A calm two-column list; falls back to anonymous dots before it lands.
  const chapters = outline
    ? outline.parts.flatMap((part) => part.chapters).sort((a, b) => a.order - b.order)
    : [];

  return (
    <Card>
      <Stack gap={4}>
        <Inline gap={3}>
          <div className={styles.draftIcon} aria-hidden="true">
            <span className={styles.draftSpinner} />
          </div>
          <Stack gap={1}>
            <Heading level={2}>Writing your story</Heading>
            <Text tone="secondary" size="sm" aria-live="polite">
              {phaseLabel}
            </Text>
          </Stack>
        </Inline>

        {essence ? <p className={styles.draftEssence}>{essence}</p> : null}

        <Stack gap={2}>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            {...(writing && total > 0 ? { 'aria-valuenow': Math.round(pct) } : {})}
            aria-label="Writing progress"
          >
            <div
              className={writing ? styles.progressFill : styles.progressIndeterminate}
              style={writing ? { width: `${pct}%` } : undefined}
            />
          </div>
          <Inline justify="space-between">
            <Text size="sm" tone="secondary">
              {fmtDuration(elapsed)} elapsed
            </Text>
            <Text size="sm" tone="secondary">
              {eta ?? (writing ? 'estimating…' : 'this takes a moment')}
            </Text>
          </Inline>
        </Stack>

        {chapters.length > 0 ? (
          <ol className={styles.draftOutline} aria-label="Chapters">
            {chapters.map((chapter, i) => {
              const state = i < done ? 'done' : i === done && writing ? 'current' : 'upcoming';
              return (
                <li key={chapter.id} className={styles.draftOutlineItem} data-state={state}>
                  <span className={styles.draftOutlineMark} aria-hidden="true">
                    {state === 'done' ? '✓' : state === 'current' ? '✎' : '·'}
                  </span>
                  <span className={styles.draftOutlineTitle}>{chapter.title}</span>
                </li>
              );
            })}
          </ol>
        ) : writing && total > 0 ? (
          <div className={styles.progressDots} aria-hidden="true">
            {Array.from({ length: total }, (_, i) => (
              <span
                key={i}
                className={
                  i < done
                    ? `${styles.dot} ${styles.dotDone}`
                    : i === done
                      ? `${styles.dot} ${styles.dotCurrent}`
                      : styles.dot
                }
              />
            ))}
          </div>
        ) : null}

        <div className={styles.draftNote}>
          <Text size="sm">
            You don’t have to watch — your biographer keeps writing in the background. We’ll have
            your book ready when you come back.
          </Text>
          {onBrowse ? (
            <button type="button" className={styles.draftBrowse} onClick={onBrowse}>
              Browse SelfOS ›
            </button>
          ) : null}
        </div>
      </Stack>
    </Card>
  );
}

/**
 * The book cover (§3.8, Phase H). Reuses the spec-13 distill→render image flow behind the ONE shared image
 * consent (`dreams.imageGenerationEnabled`) + the OpenAI key. A cover is symbolic — never a portrait of the
 * subject (the service enforces name-free/no-likeness). When AI images aren't set up, a calm setup note
 * appears instead of a button that could only fail — owner sees the Settings path, a member is pointed at
 * the owner (41 §3.3). An existing cover always stays viewable/removable even if AI is later turned off.
 */
function CoverPanel({
  bookId,
  coverImageId,
}: {
  bookId: string;
  coverImageId?: string;
}): JSX.Element {
  const isAdmin = useSessionStore((s) => s.can('budgets.manage'));
  const canManageAi = useSessionStore((s) => s.can('settings.manage'));
  const [consent] = useSetting('dreams.imageGenerationEnabled');
  const [aiEnabled] = useSetting('ai.enabled');
  const generateImage = useStoryStore((s) => s.generateImage);
  const getImageUrl = useStoryStore((s) => s.getImageUrl);
  const deleteImage = useStoryStore((s) => s.deleteImage);

  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setError(null);
    setConfirmRemove(false);
    void (async () => {
      const has = await aiKeyResolved('openai');
      const url = coverImageId ? await getImageUrl(bookId, coverImageId) : null;
      setHasKey(Boolean(has));
      setCoverUrl(url);
      setLoading(false);
    })();
  }, [bookId, coverImageId, getImageUrl]);

  const ready = consent === true && aiEnabled !== false && hasKey;

  const create = async (): Promise<void> => {
    setBusy(true);
    setGenerating(true);
    setError(null);
    // No per-image style — every image uses the single global style (Settings → Images, §3.8).
    const res = await generateImage(bookId, { kind: 'cover' });
    if (res.ok) {
      const url = await getImageUrl(bookId, res.image.id);
      setCoverUrl(url);
      setCost(typeof res.costUsd === 'number' ? res.costUsd : null);
    } else {
      setError(res.message);
    }
    setGenerating(false);
    setBusy(false);
  };

  return (
    <Card>
      <Stack gap={2}>
        <Heading level={2}>Cover</Heading>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {coverUrl ? (
          <img className={styles.coverImage} src={coverUrl} alt={`Cover for this book`} />
        ) : (
          <Text tone="secondary" size="sm">
            A symbolic cover for your story — evocative art, never a literal portrait.
          </Text>
        )}
        {generating ? (
          <ImageProgress id={`story:${bookId}:cover`} label="Creating your cover" />
        ) : null}
        {ready ? (
          <Stack gap={2}>
            <Inline>
              <Button disabled={busy} onClick={create}>
                {busy ? 'Creating…' : coverUrl ? 'Regenerate cover' : 'Create a cover'}
              </Button>
              {coverUrl && coverImageId ? (
                confirmRemove ? (
                  <Inline>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        await deleteImage(bookId, coverImageId);
                        setCoverUrl(null);
                        setCost(null);
                        setConfirmRemove(false);
                        setBusy(false);
                      }}
                    >
                      Remove cover
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
                      Keep
                    </Button>
                  </Inline>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirmRemove(true)}>
                    Remove
                  </Button>
                )
              ) : null}
              {isAdmin && cost !== null ? (
                <Text tone="secondary" size="sm">
                  <AdminOnlyBadge /> ~${cost.toFixed(3)}
                </Text>
              ) : null}
            </Inline>
          </Stack>
        ) : loading ? null : (
          <Text tone="secondary" size="sm">
            {canManageAi
              ? 'Turn on AI image generation and add your OpenAI key in Settings → Images to create a cover.'
              : 'Ask the person who set up this household to turn on AI image generation.'}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

/**
 * Photos (§3.7, Phase H2). Upload personal photos (downscaled + EXIF-stripped in the renderer, spec 45);
 * each can be analyzed by Claude vision → a caption + 2–4 questions to answer, and every answer persists to
 * the interview corpus so the biographer can draw on it. A photo is NEVER an image-generation input — it's
 * only ever read by vision. Uploading needs no consent (it's the author's own photo); analyzing needs the
 * Claude key (the app already requires AI), so a failed analyze surfaces its reason calmly.
 */
function PhotosPanel({ bookId }: { bookId: string }): JSX.Element {
  const images = useStoryStore((s) => s.images);
  const imageUrls = useStoryStore((s) => s.imageUrls);
  const photoAnswers = useStoryStore((s) => s.photoAnswers);
  const loadImages = useStoryStore((s) => s.loadImages);
  const loadPhotoAnswers = useStoryStore((s) => s.loadPhotoAnswers);
  const getImageUrl = useStoryStore((s) => s.getImageUrl);
  const uploadPhoto = useStoryStore((s) => s.uploadPhoto);
  const analyzePhoto = useStoryStore((s) => s.analyzePhoto);
  const answerPhoto = useStoryStore((s) => s.answerPhoto);
  const deleteImage = useStoryStore((s) => s.deleteImage);

  const [busy, setBusy] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-photo vision questions (ephemeral) + a per-question draft answer, keyed by image id.
  const [questions, setQuestions] = useState<Record<string, string[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const photos = images.filter((i) => i.kind === 'uploaded');

  useEffect(() => {
    void loadImages(bookId);
    void loadPhotoAnswers(bookId);
  }, [bookId, loadImages, loadPhotoAnswers]);

  // Resolve a data URL for every uploaded photo not yet cached.
  useEffect(() => {
    for (const p of photos) {
      if (!imageUrls[p.id]) void getImageUrl(bookId, p.id);
    }
  }, [bookId, photos, imageUrls, getImageUrl]);

  const onPick = async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const scaled = await downscaleImage(file);
      const entry = await uploadPhoto(bookId, scaled.mime, scaled.base64);
      if (entry) await getImageUrl(bookId, entry.id);
      else setError('That image couldn’t be added.');
    } catch {
      setError('Couldn’t read that image. Try a different photo.');
    }
    setBusy(false);
  };

  const analyze = async (imageId: string): Promise<void> => {
    setBusy(true);
    setAnalyzingId(imageId);
    setError(null);
    const res = await analyzePhoto(bookId, imageId);
    if (res.ok) setQuestions((q) => ({ ...q, [imageId]: res.analysis.questions }));
    else setError(res.message);
    setAnalyzingId(null);
    setBusy(false);
  };

  return (
    <Card>
      <Stack gap={2}>
        <Inline justify="space-between">
          <Heading level={2}>Photos</Heading>
          <Button variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Working…' : 'Add a photo'}
          </Button>
        </Inline>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className={styles.hiddenFile}
          aria-label="Add a photo"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onPick(file);
            e.target.value = ''; // allow re-selecting the same file
          }}
        />
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {photos.length === 0 ? (
          <Text tone="secondary" size="sm">
            Add a photo and your biographer can ask about the memory behind it — the answers become
            part of your story. Photos are never used to generate art.
          </Text>
        ) : (
          <div className={styles.photoGrid}>
            {photos.map((p) => {
              const answered = photoAnswers.filter((a) => a.imageId === p.id);
              const asked = questions[p.id] ?? [];
              const url = imageUrls[p.id];
              return (
                <div key={p.id} className={styles.photoCard}>
                  {url ? (
                    <img
                      className={styles.photoCardImg}
                      src={url}
                      alt={p.caption ?? 'Uploaded photo'}
                    />
                  ) : (
                    <div className={styles.photoCardImgFallback} aria-hidden="true" />
                  )}
                  <div className={styles.photoCardBody}>
                    {p.caption ? (
                      <Text size="sm" weight={500}>
                        {p.caption}
                      </Text>
                    ) : (
                      <Text size="sm" tone="tertiary">
                        No caption yet
                      </Text>
                    )}
                    {answered.length > 0 ? (
                      <span className={styles.photoAnsweredChip}>
                        {answered.length} {answered.length === 1 ? 'memory' : 'memories'} captured
                      </span>
                    ) : null}
                    {answered.map((a, i) => (
                      <Text key={`ans-${i}`} tone="secondary" size="sm">
                        <strong>{a.question}</strong> {a.answer}
                      </Text>
                    ))}
                    {analyzingId === p.id ? (
                      <ImageProgress id={`photo:${bookId}:${p.id}`} kind="vision" />
                    ) : null}
                    {asked.map((q) => (
                      <Field key={q} label={q}>
                        {(fieldProps) => (
                          <Inline>
                            <TextInput
                              {...fieldProps}
                              value={drafts[`${p.id}:${q}`] ?? ''}
                              onChange={(e) =>
                                setDrafts((d) => ({ ...d, [`${p.id}:${q}`]: e.target.value }))
                              }
                              placeholder="Your answer…"
                            />
                            <Button
                              disabled={busy || !(drafts[`${p.id}:${q}`] ?? '').trim()}
                              onClick={async () => {
                                const answer = (drafts[`${p.id}:${q}`] ?? '').trim();
                                if (!answer) return;
                                await answerPhoto(bookId, p.id, q, answer);
                                setDrafts((d) => {
                                  const next = { ...d };
                                  delete next[`${p.id}:${q}`];
                                  return next;
                                });
                                setQuestions((qs) => ({
                                  ...qs,
                                  [p.id]: (qs[p.id] ?? []).filter((x) => x !== q),
                                }));
                              }}
                            >
                              Save answer
                            </Button>
                          </Inline>
                        )}
                      </Field>
                    ))}
                    <Inline gap={2} className={styles.photoCardActions}>
                      <Button variant="ghost" disabled={busy} onClick={() => analyze(p.id)}>
                        {p.caption ? 'Ask more' : 'Caption & ask about this'}
                      </Button>
                      <button
                        type="button"
                        className={styles.sourcesToggle}
                        aria-label="Remove this photo"
                        onClick={() => void deleteImage(bookId, p.id)}
                      >
                        Remove
                      </button>
                    </Inline>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Stack>
    </Card>
  );
}

/**
 * Story settings (§3.8/§13.4) — the Settings tab's Writing + Images groups, where the person configures THIS
 * book: its writing (voice, tone, length, auto-refresh) and its own image look (style + direction, independent
 * of the app-wide dream-image style). All persist to `BookConfig` via `storyUpdate`; writing changes steer
 * FUTURE rewrites (existing chapters keep their text until re-drafted/refreshed). A `draft` mirror avoids a
 * stale-closure lost update across quick successive changes; the notes textarea persists on blur.
 */
function StorySettingsPanel({
  bookId,
  config,
}: {
  bookId: string;
  config: BookConfig;
}): JSX.Element {
  const update = useStoryStore((s) => s.update);
  const [globalStyle] = useSetting('dreams.imageStyle');
  const [draft, setDraft] = useState<BookConfig>(config);
  useEffect(() => setDraft(config), [config]);
  const [notes, setNotes] = useState(config.imageStyleNotes ?? '');
  useEffect(() => setNotes(config.imageStyleNotes ?? ''), [config.imageStyleNotes]);

  const saveField = (patch: Partial<BookConfig>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    void update(bookId, { config: next });
  };
  const saveNotes = (): void => {
    if ((config.imageStyleNotes ?? '') === notes) return;
    const next = { ...draft, imageStyleNotes: notes };
    setDraft(next);
    void update(bookId, { config: next });
  };

  const styleHint = STYLE_CHOICES.find((s) => s.value === draft.style)?.hint ?? '';
  // Show what images will actually use: this book's own style, or the global fallback until one is chosen.
  const effectiveImageStyle = draft.imageStyle ?? globalStyle ?? '';

  return (
    <>
      <Card>
        <Stack gap={3}>
          <Heading level={2}>Writing</Heading>
          <Text size="sm" tone="secondary">
            Steers every future rewrite — existing chapters keep their text until they’re re-drafted
            or refreshed.
          </Text>
          <Field label="Narrative voice">
            {(p) => (
              <Select
                {...p}
                value={draft.voice}
                onChange={(e) => saveField({ voice: e.target.value as Voice })}
              >
                {VOICE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Tone">
            {(p) => (
              <Select
                {...p}
                value={draft.style}
                onChange={(e) => saveField({ style: e.target.value as Style })}
              >
                {STYLE_CHOICES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {styleHint ? (
            <Text size="sm" tone="secondary">
              {styleHint}
            </Text>
          ) : null}
          <Field label="Length">
            {(p) => (
              <Select
                {...p}
                value={draft.length}
                onChange={(e) => saveField({ length: e.target.value as Length })}
              >
                {LENGTH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Inline justify="space-between" align="start">
            <Stack gap={1}>
              <Text size="sm" weight={500}>
                Auto-refresh
              </Text>
              <Text size="sm" tone="secondary">
                Rewrite chapters that fall out of date, on a gentle weekly cadence.
              </Text>
            </Stack>
            <Switch
              checked={draft.autoRefresh}
              onChange={(v) => saveField({ autoRefresh: v })}
              aria-label="Auto-refresh stale chapters"
            />
          </Inline>
        </Stack>
      </Card>

      <Card>
        <Stack gap={3}>
          <Heading level={2}>Images</Heading>
          <Text size="sm" tone="secondary">
            The look for this book’s cover and chapter illustrations — independent of your dream
            images (which have their own style in Settings → Images).
          </Text>
          <Stack gap={1}>
            <Text size="sm" weight={500}>
              Image style
            </Text>
            <ImageStylePicker
              value={effectiveImageStyle}
              onChange={(v) => saveField({ imageStyle: v })}
            />
          </Stack>
          <Field label="Style direction (optional)">
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                maxLength={300}
                value={notes}
                placeholder="muted earth tones, soft focus, golden-hour light…"
                onChange={(e) => setNotes(e.target.value)}
                onBlur={saveNotes}
              />
            )}
          </Field>
        </Stack>
      </Card>
    </>
  );
}

const PART_WORDS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];
function partLabel(index: number): string {
  return `Part ${PART_WORDS[index] ?? index + 1}`;
}

/** The status pill on a chapter card: reviewed → done, generating/stale → in-progress, else new/updated. */
function chapterBadge(status: string): { label: string; cls: string } {
  if (status === 'reviewed') return { label: 'Reviewed', cls: styles.chBadgeDone ?? '' };
  if (status === 'generating') return { label: 'Writing…', cls: styles.chBadgeWip ?? '' };
  if (status === 'stale') return { label: 'New material', cls: styles.chBadgeWip ?? '' };
  if (status === 'updated') return { label: 'Updated', cls: '' };
  return { label: 'New', cls: '' };
}

/** A deterministic background crop per card, so cover-backed cards (which all share the one cover) aren't
 *  pixel-identical. A chapter's own illustration is centered instead (it's already unique). */
function coverPosition(seed: number): string {
  const x = 25 + ((seed * 37) % 50);
  const y = 30 + ((seed * 53) % 45);
  return `${x}% ${y}%`;
}

// The Studio's five tabs (§13.2). `chapters` is the default; each is a real sub-route (`/story/<tab>`), so a
// tab deep-links + survives reload, while an internal mirror drives rendering (works with no Route, e.g. RTL).
const STUDIO_TABS = ['chapters', 'photos', 'interview', 'sharing', 'settings'] as const;
type StudioTab = (typeof STUDIO_TABS)[number];
const TAB_LABEL: Record<StudioTab, string> = {
  chapters: 'Chapters',
  photos: 'Photos',
  interview: 'Interview',
  sharing: 'Sharing',
  settings: 'Settings',
};
function isStudioTab(v: string): v is StudioTab {
  return (STUDIO_TABS as readonly string[]).includes(v);
}

/**
 * The Studio (§13.2/§13.4) — the control room for a living book: one hero owning the book's identity, a
 * "Needs you" strip that gathers every pending decision (and vanishes when you're caught up), and five tabs
 * for everything else. Reuses the existing panels (cover, photos, settings, share, matter, exclusions) — this
 * is a re-architecture of the surface, not the mechanics (§3 is unchanged). The chapter reader (§3.3) is still
 * reached by opening a chapter card; the immersive Book view is a later slice (R2/R3).
 */
function StudioLayout({
  bundle,
  onOpenChapter,
  onReadBook,
  aiUnavailable = false,
}: {
  bundle: StoryBookBundle;
  onOpenChapter: (chapterId: string) => void;
  onReadBook: () => void;
  /** AI unavailable (no key / off) — drives the honest refresh copy (never "turn on AI" when it IS on). */
  aiUnavailable?: boolean;
}): JSX.Element {
  const generateChapters = useStoryStore((s) => s.generateChapters);
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
  const progress = useStoryStore((s) => s.progress);
  const busy = useStoryStore((s) => s.chaptersGenerating);
  const imageUrls = useStoryStore((s) => s.imageUrls);
  const getImageUrl = useStoryStore((s) => s.getImageUrl);
  const loadImages = useStoryStore((s) => s.loadImages);

  const { manifest, outline, chapters } = bundle;
  const bookId = manifest.id;

  // Tab routing: the URL is the deep-linkable source of truth, mirrored into state so it also works with no
  // Route context (RTL renders <Story/> directly). Clicking a tab updates both.
  const routeTab = (useParams()['*'] ?? '').split('/')[0] ?? '';
  const navigate = useNavigate();
  const [tab, setTab] = useState<StudioTab>(isStudioTab(routeTab) ? routeTab : 'chapters');
  useEffect(() => {
    if (isStudioTab(routeTab)) setTab(routeTab);
  }, [routeTab]);
  const goTab = (t: StudioTab): void => {
    setTab(t);
    navigate(t === 'chapters' ? '/story' : `/story/${t}`);
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
  }, [bookId, loadProposals, loadCompleteness, loadTodos, loadExclusions, loadImages]);

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
  const staleCount = chapters.filter((c) => c.status === 'stale').length;
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
    setRefreshNotice(bits.length > 0 ? bits.join(' ') : 'Your story is up to date.');
  };

  const chips = [
    manifest.config.voice === 'first' ? 'First person' : 'Third person',
    STYLE_CHOICES.find((s) => s.value === manifest.config.style)?.label ?? manifest.config.style,
    `${LENGTH_OPTIONS.find((l) => l.value === manifest.config.length)?.label ?? manifest.config.length} length`,
    `${chapters.length} chapter${chapters.length === 1 ? '' : 's'}`,
  ];

  return (
    <div className={styles.studio}>
      {/* ---- Hero: the book's identity ---- */}
      <div className={styles.hero}>
        <div className={styles.heroCover}>
          <CoverPanel
            bookId={bookId}
            {...(manifest.coverImageId ? { coverImageId: manifest.coverImageId } : {})}
          />
        </div>
        <div className={styles.heroBody}>
          <span className={styles.partEyebrow}>Your story · Biography</span>
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
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* ---- Needs you: pending decisions, gathered (hidden when caught up) ---- */}
      <NeedsYou
        proposals={proposals}
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
      />

      {/* ---- Tabs ---- */}
      <div className={styles.tabs} role="tablist" aria-label="Your story">
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
            {t === 'photos' ? <TabCount bookId={bookId} kind="photos" /> : null}
          </button>
        ))}
      </div>

      {tab === 'chapters' ? (
        <ChaptersTab
          bundle={bundle}
          chapterProgress={chapterProgress}
          pending={pending}
          onOpenChapter={onOpenChapter}
          onWrite={async () => {
            setError(null);
            const res = await generateChapters(bookId);
            if (!res.ok) setError(res.message);
            else if (res.budgetReached && res.message) setError(res.message);
          }}
        />
      ) : null}

      {tab === 'photos' ? <PhotosPanel bookId={bookId} /> : null}

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
          <StorySettingsPanel bookId={bookId} config={manifest.config} />
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

/** A small live count next to a tab label (currently only Photos). Reads the store's images index. */
function TabCount({ bookId, kind }: { bookId: string; kind: 'photos' }): JSX.Element | null {
  const images = useStoryStore((s) => s.images);
  const loadImages = useStoryStore((s) => s.loadImages);
  useEffect(() => {
    void loadImages(bookId);
  }, [bookId, loadImages]);
  const n = images.filter((i) => i.kind === 'uploaded').length;
  if (kind === 'photos' && n > 0) return <span className={styles.tabBadge}>{n}</span>;
  return null;
}

/** The Chapters tab: the cover-backed card grid grouped by part, the "write the remaining N" bar rendered
 *  inside the part that owns the unwritten shells, and the inline write-progress. */
function ChaptersTab({
  bundle,
  chapterProgress,
  pending,
  onOpenChapter,
  onWrite,
}: {
  bundle: StoryBookBundle;
  chapterProgress: (StoryDraftProgress & { startedAt: number }) | null;
  pending: number;
  onOpenChapter: (chapterId: string) => void;
  onWrite: () => void | Promise<void>;
}): JSX.Element {
  const imageUrls = useStoryStore((s) => s.imageUrls);
  const { manifest, outline, chapters } = bundle;
  const outlineChapters = outline ? outline.parts.flatMap((p) => p.chapters) : [];

  if (!outline) return <div />;
  const firstUnwrittenPart = outline.parts.findIndex((p) =>
    p.chapters.some((c) => !chapters.some((w) => w.id === c.id && w.markdown.trim().length > 0)),
  );

  return (
    <Stack gap={5}>
      {outline.parts.map((part, pi) => {
        const partWritten = part.chapters.filter((c) =>
          chapters.some((w) => w.id === c.id && w.markdown.trim().length > 0),
        ).length;
        const partReviewed = part.chapters.filter((c) =>
          chapters.some((w) => w.id === c.id && w.status === 'reviewed'),
        ).length;
        const partUnwritten = part.chapters.length - partWritten;
        const progressLabel =
          partUnwritten > 0
            ? `${partReviewed} of ${part.chapters.length} reviewed · ${partUnwritten} unwritten`
            : `${partReviewed} of ${part.chapters.length} reviewed`;
        return (
          <section className={styles.partSection} key={part.id}>
            <div className={styles.partHead}>
              <span className={styles.partEyebrow}>{partLabel(pi)}</span>
              <Heading level={2}>{part.title}</Heading>
              <span className={styles.partCount}>{progressLabel}</span>
            </div>
            {/* The write action / live write-progress lives inside the FIRST part that still has unwritten
                shells (§13.3) — so it sits where the work is, not floating above the whole grid. */}
            {firstUnwrittenPart === pi && chapterProgress ? (
              <DraftProgress p={chapterProgress} />
            ) : firstUnwrittenPart === pi && pending > 0 ? (
              <div className={styles.writeBar}>
                <Text size="sm">
                  {chapters.length > 0
                    ? `${pending} approved chapter${pending === 1 ? " isn't" : "s aren't"} written yet.`
                    : 'Your outline is ready.'}
                </Text>
                <Button variant="primary" onClick={() => void onWrite()}>
                  {chapters.length > 0
                    ? `Write the remaining ${pending} chapter${pending === 1 ? '' : 's'}`
                    : 'Write your chapters'}
                </Button>
              </div>
            ) : null}
            <div className={styles.chapterGrid}>
              {part.chapters.map((chapter) => {
                const written = chapters.find(
                  (c) => c.id === chapter.id && c.markdown.trim().length > 0,
                );
                const num = outlineChapters.findIndex((c) => c.id === chapter.id) + 1;
                const numLabel = num > 0 ? `Chapter ${num}` : 'Chapter';
                if (!written) {
                  return (
                    <div key={chapter.id} className={styles.notYetCard}>
                      <span className={styles.chNum}>{numLabel}</span>
                      <span className={styles.notYetTitle}>{chapter.title}</span>
                      <span>Not yet written</span>
                    </div>
                  );
                }
                const ownIllustration = written.imagePlacements[0]?.imageId;
                const imageId = ownIllustration ?? manifest.coverImageId;
                const url = imageId ? imageUrls[imageId] : undefined;
                const badge = chapterBadge(written.status);
                return (
                  <button
                    key={chapter.id}
                    type="button"
                    className={`${styles.chapterCard} ${url ? '' : styles.chapterCardFallback}`}
                    style={
                      url
                        ? {
                            backgroundImage: `url("${url}")`,
                            backgroundPosition: ownIllustration ? 'center' : coverPosition(num),
                          }
                        : undefined
                    }
                    onClick={() => onOpenChapter(chapter.id)}
                  >
                    <span className={`${styles.chBadge} ${badge.cls}`}>
                      <span className={styles.chDot} aria-hidden="true" />
                      {badge.label}
                    </span>
                    <span className={styles.chapterCardBody}>
                      <span className={styles.chNum}>{numLabel}</span>
                      <span className={styles.chTitle}>{chapter.title}</span>
                      <span className={styles.chReveal}>Read ›</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </Stack>
  );
}

/** Describe a 0..1 part-coverage score as words (§9 — never colour/height alone). */
function coverageWord(score: number): string {
  if (score >= 0.8) return 'richly told';
  if (score >= 0.5) return 'taking shape';
  if (score > 0) return 'thin';
  return 'not yet begun';
}

/**
 * The life map (§13.6.4) — one row per outline part (chronological), a coverage bar + a word for how richly
 * told that era is (the text equivalent, §9), dashed when an open gap targets it.
 */
function LifeMap({
  parts,
  coverage,
}: {
  parts: { id: string; title: string }[];
  coverage: StoryPartCoverage[];
}): JSX.Element | null {
  if (parts.length === 0) return null;
  const byPart = new Map(coverage.map((c) => [c.partId, c.score]));
  return (
    <div
      className={styles.lifeMap}
      role="group"
      aria-label="Life map — how richly told each part is"
    >
      {parts.map((part) => {
        const score = byPart.get(part.id) ?? 0;
        return (
          <div key={part.id} className={styles.lifeRow}>
            <Text size="sm" className={styles.lifeTitle}>
              {part.title}
            </Text>
            <div
              className={styles.lifeTrack}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(score * 100)}
              aria-valuetext={coverageWord(score)}
              aria-label={part.title}
            >
              <div className={styles.lifeFill} style={{ width: `${Math.max(4, score * 100)}%` }} />
            </div>
            <Text size="sm" tone="tertiary" className={styles.lifeWord}>
              {coverageWord(score)}
            </Text>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The Interview tab (§13.4/§13.6) — the completeness stage + the life map + the biographer's gap invitations
 * ("Ask me about this"), the open check-in, and the answered history. The gaps + coverage render FREE (no AI);
 * "Find what's missing" runs the metered pass.
 */
function InterviewTab({
  bookId,
  parts,
  completeness,
  busy,
  onFind,
}: {
  bookId: string;
  parts: { id: string; title: string }[];
  completeness: StoryCompleteness | null;
  busy: boolean;
  onFind: () => Promise<string>;
}): JSX.Element {
  const gaps = useStoryStore((s) => s.gaps);
  const loadGaps = useStoryStore((s) => s.loadGaps);
  const askGap = useStoryStore((s) => s.askGap);
  const answered = useStoryStore((s) => s.answeredCheckIns);
  const loadAnswered = useStoryStore((s) => s.loadAnsweredCheckIns);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);

  useEffect(() => {
    void loadGaps(bookId);
    void loadAnswered(bookId);
  }, [bookId, loadGaps, loadAnswered]);

  const hasOpenCheckin = gaps?.hasOpenCheckin ?? false;

  return (
    <Stack gap={3}>
      <Card>
        <Stack gap={3}>
          <Heading level={2}>What’s missing</Heading>
          {completeness ? (
            <Text tone="secondary" size="sm">
              Your story is <strong>{COMPLETENESS_STAGE[completeness.stage].toLowerCase()}</strong>.
              Your biographer looks for the thin eras and the scenes it hasn’t heard, and can send
              you a few questions to fill them.
            </Text>
          ) : (
            <Text tone="secondary" size="sm">
              Your biographer can look for the gaps in your story and send you a few questions to
              fill them.
            </Text>
          )}
          <LifeMap parts={parts} coverage={gaps?.partCoverage ?? []} />
          {notice ? <Banner tone="info">{notice}</Banner> : null}
          <Inline>
            {/* Single-flight EVERY mint affordance (§13.6.5): while any find/ask is in flight, disable the rest,
                or a fast second click could mint a second open check-in before the ≤1 flag catches up. */}
            <Button
              variant="primary"
              disabled={busy || asking !== null}
              onClick={async () => setNotice(await onFind())}
            >
              {busy ? 'Looking…' : 'Find what’s missing'}
            </Button>
          </Inline>
        </Stack>
      </Card>

      {gaps && gaps.gaps.length > 0 ? (
        <Card>
          <Stack gap={3}>
            <Heading level={3}>Worth telling next</Heading>
            {hasOpenCheckin ? (
              <Banner tone="info">
                A check-in from your biographer is already open — answer it before asking for more.
              </Banner>
            ) : null}
            <Stack gap={2}>
              {gaps.gaps.map((gap) => (
                <div key={gap.id} className={styles.gapRow}>
                  <div className={styles.gapText}>
                    <Text size="sm" weight={500}>
                      {gap.label}
                    </Text>
                    <Text size="sm" tone="tertiary">
                      {gap.focus}
                    </Text>
                  </div>
                  <Button
                    disabled={hasOpenCheckin || busy || asking !== null}
                    onClick={async () => {
                      setAsking(gap.id);
                      setNotice(null);
                      const res = await askGap(bookId, gap.id);
                      setAsking(null);
                      setNotice(
                        res.ok
                          ? 'Your biographer sent a few questions to your Inbox.'
                          : res.message,
                      );
                    }}
                  >
                    {asking === gap.id ? 'Asking…' : 'Ask me about this'}
                  </Button>
                </div>
              ))}
            </Stack>
          </Stack>
        </Card>
      ) : null}

      {answered.length > 0 ? (
        <Card>
          <Stack gap={2}>
            <Heading level={3}>Answered</Heading>
            <Text tone="tertiary" size="sm">
              The biographer questions you’ve answered — each one wove new material into your story.
            </Text>
            <Stack gap={1}>
              {answered.map((c) => (
                <div key={c.assignmentId} className={styles.markRow}>
                  <Text size="sm">{c.title}</Text>
                  <Text size="sm" tone="tertiary">
                    {c.wroteIntoChapterTitle
                      ? `wove into “${c.wroteIntoChapterTitle}”`
                      : new Date(c.answeredAt).toLocaleDateString()}
                  </Text>
                </div>
              ))}
            </Stack>
          </Stack>
        </Card>
      ) : null}

      <Text tone="tertiary" size="sm">
        Questions arrive in your Inbox under “Your biographer”. Answering them weaves new material
        into your story.
      </Text>
    </Stack>
  );
}

/** The "Needs you" strip (§13.4) — one card per pending decision. Self-hides entirely when you're caught up
 *  (replaced by a calm "all caught up" line). */
function NeedsYou({
  proposals,
  toReviewCount,
  openTodoCount,
  onReview,
  onOpenTodos,
  onApprove,
  onDismiss,
}: {
  proposals: StructuralProposal[];
  toReviewCount: number;
  openTodoCount: number;
  onReview: () => void;
  onOpenTodos: () => void;
  onApprove: (proposalId: string) => void | Promise<void>;
  onDismiss: (proposalId: string) => void;
}): JSX.Element {
  const nothing = proposals.length === 0 && toReviewCount === 0 && openTodoCount === 0;
  if (nothing) {
    return (
      <div className={styles.caughtUp}>
        <Text size="sm" tone="secondary">
          ✓ Nothing needs you — your story is up to date.
        </Text>
      </div>
    );
  }
  const count = proposals.length + (toReviewCount > 0 ? 1 : 0) + (openTodoCount > 0 ? 1 : 0);
  return (
    <div className={styles.needs}>
      <div className={styles.needsHead}>
        <span className={styles.partEyebrow}>Needs you</span>
        <Text size="sm" tone="tertiary">
          {count} thing{count === 1 ? '' : 's'} · this clears as you go
        </Text>
      </div>
      <div className={styles.needsGrid}>
        {proposals.map((p) => (
          <div key={p.id} className={styles.needCard}>
            <span className={styles.needKindWarn}>Suggested change</span>
            <Text size="sm" className={styles.needTitle}>
              {proposalSummary(p)}
            </Text>
            {p.rationale ? (
              <Text size="sm" tone="tertiary">
                {p.rationale}
              </Text>
            ) : null}
            <Inline gap={2}>
              <Button variant="primary" onClick={() => void onApprove(p.id)}>
                Approve
              </Button>
              <button
                type="button"
                className={styles.sourcesToggle}
                aria-label="Dismiss this suggestion"
                onClick={() => onDismiss(p.id)}
              >
                Later
              </button>
            </Inline>
          </div>
        ))}
        {toReviewCount > 0 ? (
          <div className={styles.needCard}>
            <span className={styles.needKind}>To review</span>
            <Text size="sm" className={styles.needTitle}>
              {toReviewCount} newly written chapter{toReviewCount === 1 ? '' : 's'}
            </Text>
            <Text size="sm" tone="tertiary">
              Read {toReviewCount === 1 ? 'it' : 'them'} and mark “Looks good” to share.
            </Text>
            <Inline>
              <Button onClick={onReview}>Review ›</Button>
            </Inline>
          </div>
        ) : null}
        {openTodoCount > 0 ? (
          <div className={styles.needCard}>
            <span className={styles.needKind}>To-dos</span>
            <Text size="sm" className={styles.needTitle}>
              {openTodoCount} open
            </Text>
            <Text size="sm" tone="tertiary">
              Your reminders and the notes you’ve handed your biographer.
            </Text>
            <Inline>
              <button type="button" className={styles.sourcesToggle} onClick={onOpenTodos}>
                View ›
              </button>
            </Inline>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The book-level "To do" roll-up (§3.3.2), in a right-hand sheet opened from the Needs-you strip. */
function TodoSheet({
  bookId,
  todos,
  onClose,
}: {
  bookId: string;
  todos: StoryTodoEntry[];
  onClose: () => void;
}): JSX.Element {
  const updateMark = useStoryStore((s) => s.updateMark);
  const loadTodos = useStoryStore((s) => s.loadTodos);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={styles.sheetWrap}>
      <div className={styles.sheetBackdrop} onClick={onClose} aria-hidden="true" />
      <aside className={styles.sheetPanel} role="dialog" aria-label="To do">
        <div className={styles.sheetHead}>
          <Heading level={2}>To do</Heading>
          <button
            type="button"
            className={styles.sourcesToggle}
            aria-label="Close"
            onClick={onClose}
          >
            ✕ Close
          </button>
        </div>
        <div className={styles.sheetBody}>
          {todos.map((t) => (
            <div key={t.id} className={styles.markRow}>
              <Text size="sm">
                {TODO_KIND_LABEL[t.kind] ?? 'To-do'}: {t.text}
              </Text>
              {t.kind === 'remind' && t.status === 'open' ? (
                <button
                  type="button"
                  className={styles.sourcesToggle}
                  onClick={async () => {
                    await updateMark(bookId, t.chapterId, t.id, { status: 'done' });
                    await loadTodos(bookId);
                  }}
                >
                  Mark done
                </button>
              ) : (
                <Text size="sm" tone="secondary">
                  {t.status === 'questionsSent'
                    ? 'Questions sent'
                    : 'Folds into your next revision'}
                </Text>
              )}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

/** The hero's "more" menu (§13.4) — a compact popover with a backdrop catcher (no clipping). */
function StudioKebab({
  onExport,
  onShare,
  onRename,
  onSettings,
}: {
  onExport: () => void;
  onShare: () => void;
  onRename: () => void;
  onSettings: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className={styles.kebabWrap}>
      <button
        type="button"
        className={styles.kebabButton}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open ? (
        <>
          <div className={styles.kebabBackdrop} onClick={() => setOpen(false)} aria-hidden="true" />
          <div className={styles.kebabMenu} role="menu">
            <button
              type="button"
              role="menuitem"
              className={styles.kebabItem}
              onClick={pick(onShare)}
            >
              Share &amp; readers
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.kebabItem}
              onClick={pick(onExport)}
            >
              Export…
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.kebabItem}
              onClick={pick(onRename)}
            >
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.kebabItem}
              onClick={pick(onSettings)}
            >
              Book settings…
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** The Settings tab's Danger zone (§13.6.6/§13.6.7): rewrite-from-scratch + delete, each behind an honest
 *  consequences dialog; delete arms only when the book's title is typed. */
function DangerZone({ bookId, title }: { bookId: string; title: string }): JSX.Element {
  const remove = useStoryStore((s) => s.remove);
  const rewriteFromScratch = useStoryStore((s) => s.rewriteFromScratch);
  const [dialog, setDialog] = useState<'rewrite' | 'delete' | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (): void => {
    setDialog(null);
    setConfirmText('');
  };

  // Esc closes the open dialog (the app's ChangeVaultDialog/TogetherStartDialog convention).
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);

  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2}>Danger zone</Heading>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <div className={styles.dangerRow}>
          <Stack gap={1}>
            <Text size="sm" weight={500}>
              Rewrite from scratch
            </Text>
            <Text size="sm" tone="secondary">
              A fresh outline and fresh chapters from everything you’ve shared since. Keeps your
              photos, exclusions and interview answers; discards your edits, pins and marks.
            </Text>
          </Stack>
          <Button variant="ghost" onClick={() => setDialog('rewrite')}>
            Rewrite from scratch…
          </Button>
        </div>
        <div className={styles.dangerRow}>
          <Stack gap={1}>
            <Text size="sm" weight={500}>
              Delete this book
            </Text>
            <Text size="sm" tone="secondary">
              Removes the book, its images and its published copies. Readers lose access
              immediately. This cannot be undone.
            </Text>
          </Stack>
          <Button variant="ghost" onClick={() => setDialog('delete')}>
            Delete this book…
          </Button>
        </div>
      </Stack>

      {dialog ? (
        <div className={styles.dialogWrap}>
          <div className={styles.dialogBackdrop} onClick={close} aria-hidden="true" />
          <div
            className={styles.dialog}
            role="dialog"
            aria-label={dialog === 'rewrite' ? 'Rewrite from scratch' : 'Delete this book'}
          >
            {dialog === 'rewrite' ? (
              <Stack gap={3}>
                <Heading level={3}>Rewrite “{title}” from scratch?</Heading>
                <Text size="sm" tone="secondary">
                  Your biographer re-reads everything and writes a fresh outline and fresh chapters.
                </Text>
                <ul className={styles.dzList}>
                  <li>
                    <span className={styles.dzKeep}>Keeps</span> your photos, captions and answers
                  </li>
                  <li>
                    <span className={styles.dzKeep}>Keeps</span> your exclusions, title, voice &amp;
                    style
                  </li>
                  <li>
                    <span className={styles.dzLose}>Discards</span> every chapter, edit, pin and
                    pending mark
                  </li>
                  <li>
                    <span className={styles.dzLose}>Readers</span> keep the published copy until you
                    share again
                  </li>
                </ul>
                <Inline justify="flex-end">
                  <Button variant="ghost" autoFocus onClick={close}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      close();
                      const res = await rewriteFromScratch(bookId);
                      if (!res.ok && res.message) setError(res.message);
                      setBusy(false);
                    }}
                  >
                    Rewrite from scratch
                  </Button>
                </Inline>
              </Stack>
            ) : (
              <Stack gap={3}>
                <Heading level={3}>Delete “{title}”?</Heading>
                <ul className={styles.dzList}>
                  <li>
                    <span className={styles.dzLose}>Deletes</span> every chapter, image, photo,
                    answer and mark
                  </li>
                  <li>
                    <span className={styles.dzLose}>Readers</span> lose access to the published copy
                    now
                  </li>
                  <li>
                    <span className={styles.dzLose}>Cannot</span> be undone
                  </li>
                </ul>
                <Field label={`Type the book’s title to confirm`}>
                  {(p) => (
                    <TextInput
                      {...p}
                      autoFocus
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder={title}
                    />
                  )}
                </Field>
                <Inline justify="flex-end">
                  <Button variant="ghost" onClick={close}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    disabled={confirmText.trim() !== title.trim()}
                    onClick={() => void remove(bookId)}
                  >
                    Delete forever
                  </Button>
                </Inline>
              </Stack>
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/** A reader's read state (§13.6.8), joined author-side from their receipt. */
function readerReadLabel(read?: { openedAt: string; upToDate: boolean }): string {
  if (!read) return 'Hasn’t opened it yet';
  if (read.upToDate) return 'Read the latest';
  return `Opened ${new Date(read.openedAt).toLocaleDateString()} · older version`;
}

/**
 * The export dialog (§13.6.1) — a centered `role="dialog"` (the app's hand-rolled pattern): pick a format
 * (Markdown / PDF) and which head (the live Draft, or the Published version once shared), then export OUTSIDE
 * the encrypted vault. A never-published book can still export its draft.
 */
function ExportDialog({
  bookId,
  published,
  onClose,
}: {
  bookId: string;
  published: boolean;
  onClose: () => void;
}): JSX.Element {
  const exportMarkdown = useStoryStore((s) => s.exportMarkdown);
  const exportPdf = useStoryStore((s) => s.exportPdf);
  const [format, setFormat] = useState<'markdown' | 'pdf'>('markdown');
  const [head, setHead] = useState<'draft' | 'published'>(published ? 'published' : 'draft');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const doExport = async (): Promise<void> => {
    setBusy(true);
    setResult(null);
    const path =
      format === 'markdown' ? await exportMarkdown(bookId, head) : await exportPdf(bookId, head);
    setBusy(false);
    if (path) setResult(`Saved to ${path} — this file leaves your encrypted vault.`);
    else setResult('Nothing to export yet, or the save was cancelled.');
  };

  return (
    <div
      className={styles.exportOverlay}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <Card
        className={styles.exportCard}
        role="dialog"
        aria-modal="true"
        aria-label="Export your story"
        onClick={(e) => e.stopPropagation()}
      >
        <Stack gap={4}>
          <Heading level={3}>Export your story</Heading>
          <Stack gap={1}>
            <Text size="sm" weight={600}>
              Format
            </Text>
            <SegmentedControl
              value={format}
              onChange={setFormat}
              aria-label="Export format"
              options={[
                { value: 'markdown', label: 'Markdown' },
                { value: 'pdf', label: 'PDF' },
              ]}
            />
          </Stack>
          <Stack gap={1}>
            <Text size="sm" weight={600}>
              Which version
            </Text>
            <SegmentedControl
              value={head}
              onChange={setHead}
              aria-label="Which version to export"
              options={[
                { value: 'draft', label: 'Working draft' },
                { value: 'published', label: 'Published' },
              ]}
            />
            <Text size="sm" tone="secondary">
              {head === 'draft'
                ? 'Every chapter you’ve written so far — no need to share first.'
                : published
                  ? 'Exactly what your readers see — the chapters you’ve marked “Looks good”.'
                  : 'You haven’t shared this book yet, so there’s no published version to export.'}
            </Text>
          </Stack>
          {result ? <Banner tone="info">{result}</Banner> : null}
          <Inline gap={2} align="center">
            <Button
              variant="primary"
              disabled={busy || (head === 'published' && !published)}
              aria-busy={busy}
              autoFocus
              onClick={() => void doExport()}
            >
              {busy ? 'Exporting…' : 'Export'}
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Close
            </Button>
          </Inline>
        </Stack>
      </Card>
    </div>
  );
}

/** The "Share & readers" panel (§3.5): publish (Reviewed chapters → the published head) + grant/revoke readers.
 *  Readers never see the working draft — only what's been marked "Looks good". */
function ShareReadersPanel({
  bookId,
  publishedAt,
  authorPersonId,
}: {
  bookId: string;
  publishedAt?: string;
  authorPersonId: string;
}): JSX.Element {
  const publish = useStoryStore((s) => s.publish);
  const readers = useStoryStore((s) => s.readers);
  const loadReaders = useStoryStore((s) => s.loadReaders);
  const grantReader = useStoryStore((s) => s.grantReader);
  const revokeReader = useStoryStore((s) => s.revokeReader);
  const readerFeatured = useStoryStore((s) => s.readerFeatured);
  const people = usePeopleStore((s) => s.people);
  const loadPeople = usePeopleStore((s) => s.load);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState('');
  const [featured, setFeatured] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    void loadReaders(bookId);
    void loadPeople();
  }, [bookId, loadReaders, loadPeople]);

  const readerIds = new Set(readers.map((r) => r.personId));
  const candidates = people.filter((p) => p.id !== authorPersonId && !readerIds.has(p.id));
  const candidateName = people.find((p) => p.id === candidate)?.displayName ?? '';

  return (
    <Card>
      <Stack gap={2}>
        <Heading level={2}>Share &amp; readers</Heading>
        <Text tone="secondary" size="sm">
          Readers see only the chapters you’ve marked “Looks good” — never your working draft.
          Sharing updates re-publishes those chapters.
        </Text>
        {notice ? <Banner tone="info">{notice}</Banner> : null}
        <Inline>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setNotice(null);
              const res = await publish(bookId);
              setNotice(
                res.ok
                  ? `Shared ${res.publishedChapters} chapter${res.publishedChapters === 1 ? '' : 's'} with your readers.`
                  : res.message,
              );
              setBusy(false);
            }}
          >
            {busy ? 'Sharing…' : publishedAt ? 'Share updates' : 'Publish & choose readers'}
          </Button>
          {/* Export is always available (§13.6.1 — the draft head exports without publishing). */}
          <Button variant="ghost" onClick={() => setExportOpen(true)}>
            Export…
          </Button>
          {publishedAt ? (
            <Text tone="secondary" size="sm">
              Last shared {new Date(publishedAt).toLocaleDateString()}
            </Text>
          ) : null}
        </Inline>
        {exportOpen ? (
          <ExportDialog
            bookId={bookId}
            published={Boolean(publishedAt)}
            onClose={() => setExportOpen(false)}
          />
        ) : null}

        {readers.length > 0 ? (
          <Stack gap={1}>
            {readers.map((r) => (
              <div key={r.personId} className={styles.markRow}>
                <Text size="sm">
                  {r.displayName}
                  <Text as="span" tone="tertiary" size="sm">
                    {' · '}
                    {readerReadLabel(r.read)}
                  </Text>
                </Text>
                <button
                  type="button"
                  className={styles.sourcesToggle}
                  aria-label={`Remove ${r.displayName} as a reader`}
                  onClick={() => void revokeReader(bookId, r.personId)}
                >
                  Remove
                </button>
              </div>
            ))}
          </Stack>
        ) : null}

        {candidates.length > 0 ? (
          <Stack gap={1}>
            <Inline>
              <Select
                value={candidate}
                aria-label="Add a reader"
                onChange={async (e) => {
                  const id = e.target.value;
                  setCandidate(id);
                  setFeatured(id ? await readerFeatured(bookId, id) : false);
                }}
              >
                <option value="">Add a reader…</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </Select>
              <Button
                variant="ghost"
                disabled={!candidate}
                onClick={async () => {
                  await grantReader(bookId, candidate);
                  setCandidate('');
                  setFeatured(false);
                }}
              >
                Add as reader
              </Button>
            </Inline>
            {featured && candidateName ? (
              <Text tone="secondary" size="sm">
                {candidateName} appears in this book — they’ll be able to read what you’ve written
                about them.
              </Text>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}

/** The front/back matter editor (§3.6) — the person's own dedication, epigraph, and acknowledgments. */
function MatterEditor({ bookId, matter }: { bookId: string; matter?: BookMatter }): JSX.Element {
  const update = useStoryStore((s) => s.update);
  const [dedication, setDedication] = useState(matter?.dedication ?? '');
  const [epigraph, setEpigraph] = useState(matter?.epigraph ?? '');
  const [acknowledgments, setAcknowledgments] = useState(matter?.acknowledgments ?? '');
  const [saved, setSaved] = useState(false);
  const touch = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setSaved(false);
  };
  return (
    <Card>
      <Stack gap={2}>
        <Heading level={2}>Dedication &amp; acknowledgments</Heading>
        <Text tone="secondary" size="sm">
          Your own words for the opening and closing pages — added to what readers see. Optional.
        </Text>
        <Field label="Dedication">
          {(p) => (
            <Textarea
              {...p}
              value={dedication}
              rows={2}
              placeholder="For…"
              onChange={(e) => touch(setDedication)(e.target.value)}
            />
          )}
        </Field>
        <Field label="Epigraph">
          {(p) => (
            <Textarea
              {...p}
              value={epigraph}
              rows={2}
              placeholder="A line or quote to open with…"
              onChange={(e) => touch(setEpigraph)(e.target.value)}
            />
          )}
        </Field>
        <Field label="Acknowledgments">
          {(p) => (
            <Textarea
              {...p}
              value={acknowledgments}
              rows={3}
              placeholder="With thanks to…"
              onChange={(e) => touch(setAcknowledgments)(e.target.value)}
            />
          )}
        </Field>
        <Inline>
          <Button
            onClick={async () => {
              await update(bookId, {
                matter: {
                  ...(dedication.trim() ? { dedication: dedication.trim() } : {}),
                  ...(epigraph.trim() ? { epigraph: epigraph.trim() } : {}),
                  ...(acknowledgments.trim() ? { acknowledgments: acknowledgments.trim() } : {}),
                },
              });
              setSaved(true);
            }}
          >
            Save
          </Button>
          {saved ? (
            <Text tone="secondary" size="sm">
              Saved.
            </Text>
          ) : null}
        </Inline>
      </Stack>
    </Card>
  );
}

/** The completeness stage → a warm label (§3.6, owner decision: a qualitative stage + a subtle bar, never a %). */
const COMPLETENESS_STAGE: Record<StoryCompletenessStage, string> = {
  beginning: 'Just beginning',
  takingShape: 'Taking shape',
  comingTogether: 'Coming together',
  richlyTold: 'Richly told',
};

/** The "Shared with you" section (§3.5) — books others have published to the active person. Self-hides when
 *  empty; opening a card reads the published head (never the author's draft). */
function SharedWithYou(): JSX.Element | null {
  const sharedBooks = useStoryStore((s) => s.sharedBooks);
  const loadSharedBooks = useStoryStore((s) => s.loadSharedBooks);
  const openSharedBook = useStoryStore((s) => s.openSharedBook);
  useEffect(() => {
    void loadSharedBooks();
  }, [loadSharedBooks]);
  if (sharedBooks.length === 0) return null;
  return (
    <Card>
      <Stack gap={2}>
        <Heading level={2}>Shared with you</Heading>
        {sharedBooks.map((b) => (
          <button
            key={`${b.authorPersonId}:${b.bookId}`}
            type="button"
            className={styles.chapterLink}
            onClick={() => void openSharedBook(b.authorPersonId, b.bookId)}
          >
            <Stack gap={1}>
              <Inline gap={2}>
                <Text className={styles.rowTitle}>{b.title}</Text>
                {b.updated ? (
                  <span className={styles.newBadge}>{b.neverOpened ? 'New' : 'Updated'}</span>
                ) : null}
              </Inline>
              <Text tone="secondary" size="sm">
                By {b.authorName} · {b.chapterCount} chapter{b.chapterCount === 1 ? '' : 's'}
              </Text>
            </Stack>
            <Text tone="secondary" size="sm">
              Read ›
            </Text>
          </button>
        ))}
      </Stack>
    </Card>
  );
}

/** The short state mark shown next to a chapter in the Contents (owner reader only, §13.5). */
function tocStatusMark(status?: string): { label: string; isNew: boolean } | null {
  switch (status) {
    case 'reviewed':
      return { label: '✓', isNew: false };
    case 'updated':
      return { label: 'updated', isNew: true };
    case 'stale':
      return { label: 'new material', isNew: true };
    case 'new':
      return { label: 'new', isNew: true };
    default:
      return null;
  }
}

/**
 * The Book — the immersive reader (§13.5). ONE surface for both the OWNER reading their own draft head (with
 * per-chapter status, an Edit affordance, and a device-local resume position) and a granted READER reading a
 * shared book's published head (read-only). Controlled: `chapterId` = the current chapter (null = front
 * matter); `onNavigate` moves between front matter and chapters. `resolveImage` fetches each image's data URL
 * (own-book draft images vs. the re-gated published bytes — the caller decides). The Read⇄Shape toggle + the
 * in-place markup arrive in R3; for now the owner edits via "Edit this chapter" → the existing chapter editor.
 */
function BookReader({
  view,
  owner,
  chapterId,
  lastChapterId,
  resolveImage,
  onExit,
  onNavigate,
  onEditChapter,
  onSetPosition,
}: {
  view: StoryReaderView;
  owner: boolean;
  chapterId: string | null;
  lastChapterId?: string | null;
  resolveImage: (imageId: string) => Promise<string | null>;
  onExit: () => void;
  onNavigate: (chapterId: string | null) => void;
  onEditChapter?: (chapterId: string) => void;
  onSetPosition?: (chapterId: string) => void;
}): JSX.Element {
  const [scale, setScale] = useSetting('story.readerFontSize');
  const [urls, setUrls] = useState<Record<string, string>>({});
  const { manifest, chapters, authorName } = view;
  const order = manifest.chapterOrder;
  const chapter = chapterId ? chapters.find((c) => c.id === chapterId) : null;
  const idx = chapterId ? order.indexOf(chapterId) : -1;
  const prevId = idx > 0 ? order[idx - 1] : null;
  const nextId = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  const isLast = idx === order.length - 1;
  const titleById = new Map(chapters.map((c) => [c.id, c.title]));

  // Resolve the images this view needs: the cover (front matter / chapter opener fallback) + the current
  // chapter's placements. Cancels a stale in-flight resolve when the chapter changes.
  useEffect(() => {
    const needed = new Set<string>();
    if (manifest.coverImageId) needed.add(manifest.coverImageId);
    if (chapter) for (const pl of chapter.imagePlacements) needed.add(pl.imageId);
    let cancelled = false;
    void (async () => {
      for (const imageId of needed) {
        if (urls[imageId]) continue;
        const url = await resolveImage(imageId);
        if (!cancelled && url) setUrls((u) => ({ ...u, [imageId]: url }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // resolveImage is stable per (book, owner); depend on the ids we need, not the fn identity.
  }, [manifest.coverImageId, chapterId, chapter]);

  // Record the owner's read position whenever a chapter is open (device-local resume, §13.6.9).
  useEffect(() => {
    if (owner && chapter && onSetPosition) onSetPosition(chapter.id);
  }, [owner, chapter?.id]);

  // Scroll to the top on a page change (each chapter / front matter is its own "page").
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 });
  }, [chapterId]);

  const AA_STEPS = [1, 1.12, 1.25];
  const cycleAa = (): void => {
    const cur = typeof scale === 'number' ? scale : 1;
    const nearest = AA_STEPS.reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a));
    setScale(AA_STEPS[(AA_STEPS.indexOf(nearest) + 1) % AA_STEPS.length] ?? 1);
  };

  const coverUrl = manifest.coverImageId ? urls[manifest.coverImageId] : undefined;
  // Chapter opener art (§13.5): the chapter's OWN illustration (its first placement) → the book cover →
  // the deterministic gradient fallback. The promoted image becomes the hero, so it's excluded from the
  // inline figures below (never rendered twice).
  const openerPlacementId = chapter?.imagePlacements[0]?.imageId;
  const openerImageId = openerPlacementId ?? manifest.coverImageId;
  const openerUrl = openerImageId ? urls[openerImageId] : undefined;

  return (
    <div
      className={styles.reader}
      style={{ ['--reader-scale' as string]: String(typeof scale === 'number' ? scale : 1) }}
    >
      <div className={styles.readerBar}>
        <Button variant="ghost" onClick={onExit} aria-label={owner ? 'Back to the studio' : 'Back'}>
          {owner ? '‹ Studio' : '‹ Back'}
        </Button>
        <span className={styles.mid}>{manifest.title}</span>
        <span className={styles.pos}>
          {chapter ? `Ch. ${idx + 1} of ${order.length}` : 'Front matter'}
        </span>
        {owner && chapter && onEditChapter ? (
          <button
            type="button"
            className={styles.shapeButton}
            aria-label="Shape this chapter"
            title="Edit this chapter"
            onClick={() => onEditChapter(chapter.id)}
          >
            Shape
          </button>
        ) : null}
        <button type="button" className={styles.aaButton} aria-label="Text size" onClick={cycleAa}>
          aA
        </button>
      </div>

      <div className={styles.readerScroll} ref={scrollRef}>
        <div className={styles.readerCol}>
          {chapter ? (
            <>
              <div
                className={`${styles.chapterOpener} ${openerUrl ? '' : styles.chapterOpenerFallback}`}
                style={openerUrl ? { backgroundImage: `url("${openerUrl}")` } : undefined}
              >
                <span className={styles.k}>Chapter {idx + 1}</span>
                <h1>{chapter.title}</h1>
              </div>
              <div className={styles.prose}>
                {splitParagraphs(chapter.markdown).map((para, pi) => (
                  <div key={pi} className={pi === 0 ? styles.dropCap : undefined}>
                    <Markdown>{para}</Markdown>
                    {(chapter.pinnedQuotes ?? [])
                      .filter((q) => q.anchor.paragraphId === `p${pi}`)
                      .map((q, qi) => (
                        <blockquote key={`pin-${qi}`} className={styles.pullQuote}>
                          {q.text}
                          <small>In your own words</small>
                        </blockquote>
                      ))}
                    {chapter.imagePlacements
                      .filter(
                        (pl) => pl.afterAnchor === `p${pi}` && pl.imageId !== openerPlacementId,
                      )
                      .map((pl) =>
                        urls[pl.imageId] ? (
                          <figure key={pl.imageId} className={styles.readerFigure}>
                            <img src={urls[pl.imageId]} alt={pl.caption || 'Book image'} />
                            {pl.caption ? <figcaption>{pl.caption}</figcaption> : null}
                          </figure>
                        ) : null,
                      )}
                  </div>
                ))}
              </div>

              {owner && onEditChapter ? (
                <div className={styles.readerEdit}>
                  <Button variant="ghost" onClick={() => onEditChapter(chapter.id)}>
                    Shape this chapter ›
                  </Button>
                </div>
              ) : null}

              {/* Back matter follows the last chapter (the natural end of the book). */}
              {isLast ? (
                <>
                  {manifest.matter?.acknowledgments ? (
                    <section className={styles.readerBack}>
                      <Heading level={3}>Acknowledgments</Heading>
                      <div className={styles.prose}>
                        <Markdown>{manifest.matter.acknowledgments}</Markdown>
                      </div>
                    </section>
                  ) : null}
                  {manifest.noteOnBook ? (
                    <section className={styles.readerBack}>
                      <Heading level={3}>A note on this book</Heading>
                      <Text tone="secondary">{manifest.noteOnBook}</Text>
                    </section>
                  ) : null}
                  <div className={styles.colophon}>
                    {new Date(manifest.publishedAt).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}{' '}
                    · {manifest.title}
                    <br />
                    SelfOS is a wellness companion, not a medical record — this book is reflection,
                    not assessment.
                  </div>
                </>
              ) : null}

              <div className={styles.readerNav}>
                {prevId ? (
                  <button type="button" onClick={() => onNavigate(prevId)}>
                    <span className={styles.lbl}>‹ Previous</span>
                    <span className={styles.ttl}>{titleById.get(prevId)}</span>
                  </button>
                ) : (
                  <button type="button" onClick={() => onNavigate(null)}>
                    <span className={styles.lbl}>‹</span>
                    <span className={styles.ttl}>Front matter</span>
                  </button>
                )}
                <span className={styles.sp} />
                {nextId ? (
                  <button
                    type="button"
                    style={{ textAlign: 'right' }}
                    onClick={() => onNavigate(nextId)}
                  >
                    <span className={styles.lbl}>Next ›</span>
                    <span className={styles.ttl}>{titleById.get(nextId)}</span>
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            /* ---- Front matter ---- */
            <>
              <div className={styles.coverPageBig}>
                <div
                  className={`${styles.coverBook} ${coverUrl ? '' : styles.coverBookFallback}`}
                  style={coverUrl ? { backgroundImage: `url("${coverUrl}")` } : undefined}
                >
                  <span className={styles.cbTitle}>{manifest.title}</span>
                  <span className={styles.cbKicker}>A living biography</span>
                </div>
              </div>
              <div className={styles.titlePage}>
                <h1>{manifest.title}</h1>
                <div className={styles.by}>
                  {owner ? `The story of ${authorName}` : `by ${authorName}`}
                </div>
                {manifest.essence ? <div className={styles.ess}>{manifest.essence}</div> : null}
              </div>
              {manifest.matter?.dedication ? (
                <p className={styles.frontDed}>{manifest.matter.dedication}</p>
              ) : null}
              {manifest.matter?.epigraph ? (
                <blockquote className={styles.frontEpi}>{manifest.matter.epigraph}</blockquote>
              ) : null}
              {manifest.parts.length > 0 ? (
                <nav className={styles.contents} aria-label="Contents">
                  <h2>Contents</h2>
                  {manifest.parts.map((part, pIdx) => (
                    <div key={part.id}>
                      <div className={styles.part}>
                        {partLabel(pIdx)} · {part.title}
                      </div>
                      {part.chapterIds.map((id) => {
                        const n = order.indexOf(id) + 1;
                        const mark = owner
                          ? tocStatusMark(chapters.find((c) => c.id === id)?.status)
                          : null;
                        return (
                          <button
                            key={id}
                            type="button"
                            className={styles.tocLink}
                            onClick={() => onNavigate(id)}
                          >
                            <span className={styles.no}>{n}</span>
                            <span className={styles.tt}>{titleById.get(id)}</span>
                            <span className={styles.dots} />
                            {mark ? (
                              <span className={`${styles.st} ${mark.isNew ? styles.new : ''}`}>
                                {mark.label}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </nav>
              ) : null}
              <div className={styles.frontBegin}>
                {owner && lastChapterId && lastChapterId !== order[0] ? (
                  <Button variant="primary" onClick={() => onNavigate(lastChapterId)}>
                    Continue · {titleById.get(lastChapterId)} ›
                  </Button>
                ) : null}
                {order[0] ? (
                  <Button
                    variant={
                      owner && lastChapterId && lastChapterId !== order[0] ? 'ghost' : 'primary'
                    }
                    onClick={() => onNavigate(order[0]!)}
                  >
                    {owner && lastChapterId && lastChapterId !== order[0]
                      ? 'From the beginning'
                      : 'Begin reading ›'}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** How far along the story is — a warm stage label + a quiet progress bar (never a bare percentage). */
function CompletenessMeter({ c }: { c: StoryCompleteness }): JSX.Element {
  const label = COMPLETENESS_STAGE[c.stage];
  const pct = Math.round(c.ratio * 100);
  return (
    <div className={styles.completeness}>
      <Inline justify="space-between">
        <Text size="sm" className={styles.rowTitle}>
          Your story so far
        </Text>
        <Text size="sm" tone="secondary">
          {label}
        </Text>
      </Inline>
      <div
        className={styles.meterTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={label}
        aria-label={`Your story is ${label.toLowerCase()}`}
      >
        <div className={styles.meterFill} style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
    </div>
  );
}

/** A one-line, human-readable summary of what a structural proposal would do (the rationale is shown beneath). */
function proposalSummary(p: StructuralProposal): string {
  switch (p.kind) {
    case 'newChapter':
      return `Add a new chapter: “${p.title}”`;
    case 'splitChapter':
      return `Split a chapter into “${p.firstTitle}” and “${p.secondTitle}”`;
    case 'reorder':
      return 'Reorder the chapters in a part';
    case 'prologueRewrite':
      return 'Rewrite the opening chapter';
  }
}

const SOURCE_KIND_LABEL: Record<string, string> = {
  insight: 'a coaching insight',
  intakeAnswer: 'your onboarding',
  response: 'a check-in answer',
  dream: 'a dream',
  test: 'a self-reflection',
  goal: 'a goal',
  challenge: 'a challenge',
  together: 'a session with your partner',
  timeline: 'your timeline',
  photo: 'a photo',
};

/** Split a chapter's markdown into paragraphs the SAME way the core anchors provenance (`p<index>` over
 *  blank-line-separated non-empty blocks — mirrors `chapterParagraphs`; kept inline since the renderer can't
 *  import the story core, which pulls crypto). */
function splitParagraphs(markdown: string): string[] {
  return markdown
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

const INTENT_OPTIONS: SegmentOption<CommentIntent>[] = [
  { value: 'addContext', label: 'Add context' },
  { value: 'fix', label: 'Fix this' },
  { value: 'question', label: 'Ask' },
];
const INTENT_LABEL: Record<CommentIntent, string> = {
  addContext: 'Add context',
  fix: 'Fix this',
  question: 'Question',
};

// The to-do kinds the reader creates: a personal reminder, an instruction to fold into the next revision, or
// "turn into questions" (mint a story check-in into the Inbox — an explicit, metered AI action).
type ReaderTodoKind = 'remind' | 'ask' | 'questions';
const TODO_KIND_OPTIONS: SegmentOption<ReaderTodoKind>[] = [
  { value: 'remind', label: 'Remind me' },
  { value: 'ask', label: 'Ask my biographer' },
  { value: 'questions', label: 'Turn into questions' },
];
const TODO_KIND_LABEL: Record<string, string> = {
  remind: 'Reminder',
  ask: 'For your biographer',
  questions: 'Turned into questions',
};

/** Build a text anchor for a mark: a selected span, or the whole paragraph when nothing is selected. Records a
 *  short prefix/suffix so a paragraph mark survives light re-flow. A selection that appears MORE THAN ONCE in
 *  the paragraph can't be pinned to the right occurrence from the DOM string alone, so it falls back to the
 *  whole paragraph — otherwise the backend would anchor to the first match and an instant Edit would rewrite
 *  the wrong span (a silent data bug on the person's own words). Exported for a unit test. */
export function buildAnchor(paragraphs: string[], i: number, quote: string | null): TextAnchor {
  const para = paragraphs[i] ?? '';
  const sel = quote && quote.trim().length > 0 ? quote : null;
  const unique = sel !== null && para.indexOf(sel) === para.lastIndexOf(sel) && para.includes(sel);
  const q = unique ? sel : para;
  const idx = para.indexOf(q);
  const prefix = idx > 0 ? para.slice(Math.max(0, idx - 24), idx) : undefined;
  const afterText = idx >= 0 ? para.slice(idx + q.length, idx + q.length + 24) : '';
  return {
    paragraphId: `p${i}`,
    quote: q,
    ...(prefix ? { prefix } : {}),
    ...(afterText.length > 0 ? { suffix: afterText } : {}),
  };
}

/** The marks the batch revision will act on (mirrors the core `pendingRevisionMarks`): pending deletes + open
 *  addContext/fix comments + open `ask` to-dos. A question comment is recorded but not applied. Exported so a
 *  test can lock down the question-comment exclusion (the one place this diverges from the strip). */
export function countApplicable(markup: ChapterMarkup | null): number {
  if (!markup) return 0;
  return markup.marks.filter(
    (m) =>
      (m.kind === 'delete' && m.status === 'pending') ||
      (m.kind === 'comment' && m.status === 'open' && m.intent !== 'question') ||
      (m.kind === 'todo' && m.status === 'open' && m.todoKind === 'ask'),
  ).length;
}

/** The word-level "What changed" render — added words as <ins>, removed as <del>, in reading order (§13.5). */
function WordDiff({ previous, current }: { previous: string; current: string }): JSX.Element {
  // Memoize the LCS so an unrelated re-render (while the diff is open) doesn't recompute the whole table.
  const tokens = useMemo(() => wordDiff(previous, current), [previous, current]);
  return (
    <p className={styles.diff} role="group" aria-label="What changed in this rewrite">
      {tokens.map((t, i) =>
        t.op === 'added' ? (
          <ins key={i} className={styles.diffAdd}>
            {t.text}
          </ins>
        ) : t.op === 'removed' ? (
          <del key={i} className={styles.diffRemove}>
            {t.text}
          </del>
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
    </p>
  );
}

/**
 * The Shape-mode ribbon a new/updated chapter leads with (§13.5): a status eyebrow + an optional "What changed"
 * toggle (a real word-diff, only when there's prior text to diff) + the "Looks good ✓" review action. A reviewed
 * chapter shows a calm "Reviewed" line instead.
 */
function ChapterRibbon({
  chapter,
  onReview,
}: {
  chapter: StoryBookBundle['chapters'][number];
  onReview: () => void;
}): JSX.Element | null {
  const [showDiff, setShowDiff] = useState(false);
  const canDiff = Boolean(chapter.previousMarkdown?.trim());
  if (chapter.status === 'reviewed') {
    return (
      <div className={styles.ribbon} data-reviewed>
        <span className={styles.ribbonLead}>Reviewed</span>
      </div>
    );
  }
  // new / updated / stale all lead with the ribbon (so a stale chapter keeps its status cue AND the spend-free
  // "Looks good ✓" accept action — a `generating` chapter has no review action, so it shows nothing).
  if (chapter.status !== 'new' && chapter.status !== 'updated' && chapter.status !== 'stale') {
    return null;
  }
  const lead =
    chapter.status === 'new'
      ? 'New chapter'
      : chapter.status === 'updated'
        ? 'Rewritten from new material'
        : 'New material to fold in';
  return (
    <div className={styles.ribbon}>
      <div className={styles.ribbonRow}>
        <span className={styles.ribbonLead}>{lead}</span>
        {canDiff ? (
          <button
            type="button"
            className={styles.ribbonLink}
            aria-expanded={showDiff}
            onClick={() => setShowDiff((v) => !v)}
          >
            {showDiff ? 'Hide changes' : 'What changed'}
          </button>
        ) : null}
        <button type="button" className={styles.ribbonPrimary} onClick={onReview}>
          Looks good <span aria-hidden="true">✓</span>
        </button>
      </div>
      {showDiff && chapter.previousMarkdown ? (
        <WordDiff previous={chapter.previousMarkdown} current={chapter.markdown} />
      ) : null}
    </div>
  );
}

function ChapterReader({
  bundle,
  chapter,
  onBack,
}: {
  bundle: StoryBookBundle;
  chapter: StoryBookBundle['chapters'][number];
  onBack: () => void;
}): JSX.Element {
  const regenerateChapter = useStoryStore((s) => s.regenerateChapter);
  const reviewChapter = useStoryStore((s) => s.reviewChapter);
  const markup = useStoryStore((s) => s.markup);
  const loadMarkup = useStoryStore((s) => s.loadMarkup);
  const clearMarkup = useStoryStore((s) => s.clearMarkup);
  const addMark = useStoryStore((s) => s.addMark);
  const removeMark = useStoryStore((s) => s.removeMark);
  const updateMark = useStoryStore((s) => s.updateMark);
  const flagInsight = useStoryStore((s) => s.flagInsight);
  const applyMarkup = useStoryStore((s) => s.applyMarkup);
  const editPassage = useStoryStore((s) => s.editPassage);
  const pinQuote = useStoryStore((s) => s.pinQuote);
  const todoToQuestions = useStoryStore((s) => s.todoToQuestions);
  const exclude = useStoryStore((s) => s.exclude);
  const busy = useStoryStore((s) => s.chaptersGenerating);
  // Image placement (§3.8, Phase H3).
  const bookImages = useStoryStore((s) => s.images);
  const imageUrls = useStoryStore((s) => s.imageUrls);
  const loadImages = useStoryStore((s) => s.loadImages);
  const getImageUrl = useStoryStore((s) => s.getImageUrl);
  const generateImage = useStoryStore((s) => s.generateImage);
  const suggestPlacement = useStoryStore((s) => s.suggestPlacement);
  const setPlacement = useStoryStore((s) => s.setPlacement);
  const removePlacement = useStoryStore((s) => s.removePlacement);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Image-generation setup (§3.8) — the SAME gate as the cover panel, so the "Illustrate this chapter" button
  // is never a dead control. Errors surface IN the Images card (below), not at the top of the reader.
  const canManageAi = useSessionStore((s) => s.can('settings.manage'));
  const [imageConsent] = useSetting('dreams.imageGenerationEnabled');
  const [aiEnabled] = useSetting('ai.enabled');
  const [hasImageKey, setHasImageKey] = useState(false);
  // Gate the "turn on image generation" setup note on the ASYNC key check having resolved, so it never
  // flashes for a fully-configured person (the CoverPanel `loading` lesson — same data, same behavior).
  const [imageKeyChecked, setImageKeyChecked] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [illustrating, setIllustrating] = useState(false);
  // The two-step "Rewrite this chapter" confirm (§8.2 spend legibility) + the History sheet (§13.9).
  const [confirmRewrite, setConfirmRewrite] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openSources, setOpenSources] = useState<number | null>(null);
  const [activePara, setActivePara] = useState<number | null>(null);
  const [activeQuote, setActiveQuote] = useState<string | null>(null);
  const [mode, setMode] = useState<'menu' | 'comment' | 'edit' | 'exclude' | 'todo' | null>(null);
  const [commentIntent, setCommentIntent] = useState<CommentIntent>('addContext');
  const [todoKind, setTodoKind] = useState<ReaderTodoKind>('remind');
  const [flagSource, setFlagSource] = useState(false);
  const [draft, setDraft] = useState('');
  // The batch Review & apply sheet (§13.5) — the bottom-sticky pill opens it; it lists the pending marks and
  // runs the one metered revision (`applyMarkup`, call-count unchanged).
  const [reviewOpen, setReviewOpen] = useState(false);

  const bookId = bundle.manifest.id;
  const chapterId = chapter.id;
  const paragraphs = splitParagraphs(chapter.markdown);
  const provByAnchor = new Map(chapter.provenance.map((p) => [p.anchor, p.refs]));

  // The Memory insight a paragraph drew on, if any — a "Fix this" comment can also flag it inaccurate (§3.3).
  const insightIdFor = (i: number): string | null =>
    (provByAnchor.get(`p${i}`) ?? []).find((r) => r.kind === 'insight')?.id ?? null;

  useEffect(() => {
    void loadMarkup(bookId, chapterId);
    return () => clearMarkup();
  }, [bookId, chapterId, loadMarkup, clearMarkup]);

  useEffect(() => {
    void loadImages(bookId);
  }, [bookId, loadImages]);

  useEffect(() => {
    void (async () => {
      setHasImageKey(Boolean(await aiKeyResolved('openai')));
      setImageKeyChecked(true);
    })();
  }, [bookId]);

  const imagesReady = imageConsent === true && aiEnabled !== false && hasImageKey;

  // Resolve data URLs for every image placed in THIS chapter.
  useEffect(() => {
    for (const p of chapter.imagePlacements) {
      if (!imageUrls[p.imageId]) void getImageUrl(bookId, p.imageId);
    }
  }, [bookId, chapter.imagePlacements, imageUrls, getImageUrl]);

  const placedIds = new Set(chapter.imagePlacements.map((p) => p.imageId));
  // Images that can still be placed here: illustrations + uploaded photos not already in this chapter.
  const placeable = bookImages.filter((i) => i.kind !== 'cover' && !placedIds.has(i.id));

  // Place an image: ask the AI where it fits, then set it (fall back to the first paragraph on failure so it's
  // never a dead-end — the author can move it).
  const placeImage = async (imageId: string): Promise<void> => {
    setImageBusy(true);
    setError(null);
    const suggested = await suggestPlacement(bookId, chapterId, imageId);
    const anchor = suggested.ok ? suggested.afterAnchor : 'p0';
    await setPlacement(bookId, chapterId, imageId, anchor);
    setImageBusy(false);
  };

  const illustrate = async (): Promise<void> => {
    setImageBusy(true);
    setIllustrating(true);
    setImageError(null);
    // No per-image style — every image uses the single global style (Settings → Images, §3.8).
    const res = await generateImage(bookId, { kind: 'illustration', chapterId });
    setIllustrating(false);
    if (res.ok) await placeImage(res.image.id);
    else setImageError(res.message);
    setImageBusy(false);
  };

  const closeMenu = (): void => {
    setActivePara(null);
    setActiveQuote(null);
    setMode(null);
    setDraft('');
    setTodoKind('remind'); // don't leave the To-do form defaulted to the metered "questions" kind
    setFlagSource(false);
  };

  // Open the toolbar for a paragraph, seeded with the current text selection (if any is inside it).
  const openMenu = (i: number): void => {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    const selected = sel && !sel.isCollapsed ? sel.toString().trim() : '';
    setActivePara(i);
    setActiveQuote(
      selected.length > 0 && (paragraphs[i] ?? '').includes(selected) ? selected : null,
    );
    setMode('menu');
    setDraft('');
  };

  const addDelete = async (i: number): Promise<void> => {
    await addMark(bookId, chapterId, {
      id: crypto.randomUUID(),
      kind: 'delete',
      anchor: buildAnchor(paragraphs, i, activeQuote),
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    closeMenu();
  };

  const submitComment = async (i: number): Promise<void> => {
    if (draft.trim().length === 0) return;
    // A "Fix this" comment can also flag the source insight inaccurate in Memory (specs 20/44).
    const insightId = commentIntent === 'fix' && flagSource ? insightIdFor(i) : null;
    await addMark(bookId, chapterId, {
      id: crypto.randomUUID(),
      kind: 'comment',
      anchor: buildAnchor(paragraphs, i, activeQuote),
      intent: commentIntent,
      text: draft.trim(),
      status: 'open',
      createdAt: new Date().toISOString(),
      ...(insightId ? { flagInsightId: insightId } : {}),
    });
    if (insightId) await flagInsight(insightId);
    closeMenu();
  };

  const submitTodo = async (i: number): Promise<void> => {
    if (draft.trim().length === 0) return;
    if (todoKind === 'questions') {
      // Explicit, metered: mint a story check-in into the Inbox (§5.5).
      setNotice(null);
      const res = await todoToQuestions(
        bookId,
        chapterId,
        draft.trim(),
        buildAnchor(paragraphs, i, activeQuote),
      );
      if (res.ok) setNotice('A few questions are waiting in your Inbox.');
      else setError(res.message);
      closeMenu();
      return;
    }
    await addMark(bookId, chapterId, {
      id: crypto.randomUUID(),
      kind: 'todo',
      anchor: buildAnchor(paragraphs, i, activeQuote),
      text: draft.trim(),
      todoKind,
      status: 'open',
      createdAt: new Date().toISOString(),
    });
    closeMenu();
  };

  const submitEdit = async (i: number): Promise<void> => {
    if (draft.trim().length === 0) return;
    const ok = await editPassage(
      bookId,
      chapterId,
      buildAnchor(paragraphs, i, activeQuote),
      draft.trim(),
    );
    if (!ok) setError('That passage has moved — reopen the chapter and try the edit again.');
    closeMenu();
  };

  const addPin = async (i: number): Promise<void> => {
    const anchor = buildAnchor(paragraphs, i, activeQuote);
    const ok = await pinQuote(bookId, chapterId, anchor, anchor.quote ?? '');
    if (!ok) setError('That passage has moved — reopen the chapter and try again.');
    closeMenu();
  };

  const noticeExcluded = (staled: number): void => {
    setNotice(
      staled > 0
        ? `Won’t be written again. ${staled} chapter${staled === 1 ? '' : 's'} that mentioned it ${
            staled === 1 ? 'is' : 'are'
          } marked to rewrite.`
        : 'Won’t be written again.',
    );
  };

  const submitExclude = async (): Promise<void> => {
    if (draft.trim().length === 0) return;
    setNotice(null);
    try {
      noticeExcluded(await exclude(bookId, 'topic', draft.trim()));
    } catch {
      setError('Couldn’t exclude that. Try again.');
    }
    closeMenu();
  };

  const excludeSource = async (kind: string, id: string): Promise<void> => {
    setNotice(null);
    try {
      noticeExcluded(await exclude(bookId, 'source', id, SOURCE_KIND_LABEL[kind] ?? 'a source'));
    } catch {
      setError('Couldn’t exclude that. Try again.');
    }
    setOpenSources(null);
  };

  const applicable = countApplicable(markup);

  // Close the Review & apply sheet the moment the batch empties (the last mark removed, or the revision
  // applied) — the pill vanishes with it, so the sheet must never linger as an empty dead-end.
  useEffect(() => {
    if (applicable === 0) setReviewOpen(false);
  }, [applicable]);

  // Footnote numbers for the numbered superscript sources (§13.5): a running counter over the paragraphs that
  // actually drew on something, so provenance reads as book-style footnotes rather than an inline "Sources (N)".
  const sourceNoByPara = new Map<number, number>();
  {
    let n = 0;
    paragraphs.forEach((_, i) => {
      if ((provByAnchor.get(`p${i}`)?.length ?? 0) > 0) sourceNoByPara.set(i, (n += 1));
    });
  }

  // Per-kind counts for the bottom-sticky pending pill copy (§13.5) — mirrors `countApplicable`'s membership so
  // the pill total always equals what "Apply with your biographer" will act on.
  const allMarks = markup?.marks ?? [];
  const cutCount = allMarks.filter((m) => m.kind === 'delete' && m.status === 'pending').length;
  const commentCount = allMarks.filter(
    (m) => m.kind === 'comment' && m.status === 'open' && m.intent !== 'question',
  ).length;
  const askCount = allMarks.filter(
    (m) => m.kind === 'todo' && m.status === 'open' && m.todoKind === 'ask',
  ).length;
  const pillBreakdown = [
    cutCount > 0 ? `${cutCount} cut${cutCount === 1 ? '' : 's'}` : null,
    commentCount > 0 ? `${commentCount} comment${commentCount === 1 ? '' : 's'}` : null,
    askCount > 0 ? `${askCount} to-do${askCount === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const applyBatch = async (): Promise<void> => {
    setError(null);
    const res = await applyMarkup(bookId, chapterId);
    if (!res.ok) setError(res.message);
    else setReviewOpen(false);
  };

  return (
    <Stack gap={4}>
      <Inline justify="space-between">
        <Button variant="ghost" onClick={onBack} aria-label="Back to the book">
          ‹ Back
        </Button>
      </Inline>

      <Heading level={1}>{chapter.title}</Heading>
      <ChapterRibbon
        chapter={chapter}
        onReview={async () => {
          setError(null);
          const ok = await reviewChapter(bookId, chapterId);
          if (!ok) setError('Couldn’t save that. Try again.');
        }}
      />
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {notice ? <Banner tone="info">{notice}</Banner> : null}

      <div className={styles.shapeBody}>
        <Stack gap={3}>
          {paragraphs.map((para, i) => {
            const refs = provByAnchor.get(`p${i}`);
            const marks = (markup?.marks ?? []).filter(
              (m) =>
                m.anchor?.paragraphId === `p${i}` &&
                ((m.kind === 'delete' && m.status === 'pending') ||
                  (m.kind === 'comment' && m.status === 'open') ||
                  (m.kind === 'todo' && m.status === 'open')),
            );
            const sourced = Boolean(refs && refs.length > 0);
            return (
              <div key={i} className={styles.para}>
                <div className={styles.paraMeasure}>
                  <div className={styles.paraBody}>
                    <Markdown {...(sourced ? { className: styles.inlineProse } : {})}>
                      {para}
                    </Markdown>
                    {sourced && refs ? (
                      <button
                        type="button"
                        className={styles.sourceSup}
                        aria-label={`Sources (${refs.length})`}
                        aria-expanded={openSources === i}
                        onClick={() => setOpenSources(openSources === i ? null : i)}
                      >
                        {sourceNoByPara.get(i)}
                      </button>
                    ) : null}
                  </div>

                  <div className={styles.paraActions}>
                    <button
                      type="button"
                      className={styles.sourcesToggle}
                      aria-expanded={activePara === i}
                      onClick={() => (activePara === i && mode ? closeMenu() : openMenu(i))}
                    >
                      Mark up
                    </button>
                  </div>

                  {openSources === i && refs ? (
                    <Stack gap={1}>
                      {refs.map((ref, j) => (
                        <div key={j} className={styles.markRow}>
                          <Text size="sm" tone="secondary">
                            Drawn from {SOURCE_KIND_LABEL[ref.kind] ?? 'your history'}
                            {ref.at ? ` · ${ref.at.slice(0, 10)}` : ''}
                          </Text>
                          <button
                            type="button"
                            className={styles.sourcesToggle}
                            onClick={() => void excludeSource(ref.kind, ref.id)}
                          >
                            Don’t draw on this again
                          </button>
                        </div>
                      ))}
                    </Stack>
                  ) : null}

                  {activePara === i && mode ? (
                    <Card>
                      <Stack gap={3}>
                        <Text size="sm" tone="secondary">
                          {activeQuote ? `Selected: “${activeQuote}”` : 'This whole paragraph'}
                        </Text>
                        {mode === 'menu' ? (
                          <Inline gap={2}>
                            <Button onClick={() => void addDelete(i)}>Delete</Button>
                            <Button
                              onClick={() => {
                                setMode('edit');
                                setDraft(activeQuote ?? para);
                              }}
                            >
                              Edit
                            </Button>
                            <Button onClick={() => setMode('comment')}>Comment</Button>
                            <Button
                              onClick={() => {
                                setMode('todo');
                                setDraft('');
                              }}
                            >
                              To-do
                            </Button>
                            <Button onClick={() => void addPin(i)}>Pin</Button>
                            <Button
                              onClick={() => {
                                setMode('exclude');
                                setDraft(activeQuote ?? para);
                              }}
                            >
                              Exclude
                            </Button>
                            <Button variant="ghost" onClick={closeMenu}>
                              Cancel
                            </Button>
                          </Inline>
                        ) : null}
                        {mode === 'comment' ? (
                          <Stack gap={2}>
                            <SegmentedControl
                              options={INTENT_OPTIONS}
                              value={commentIntent}
                              onChange={setCommentIntent}
                              aria-label="Comment kind"
                            />
                            <Textarea
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              aria-label="Comment"
                              rows={2}
                              placeholder="What should the biographer know?"
                            />
                            {commentIntent === 'fix' && insightIdFor(i) ? (
                              <label className={styles.flagRow}>
                                <input
                                  type="checkbox"
                                  checked={flagSource}
                                  onChange={(e) => setFlagSource(e.target.checked)}
                                />
                                <Text size="sm" tone="secondary">
                                  Also mark the source insight as inaccurate in your Memory
                                </Text>
                              </label>
                            ) : null}
                            <Inline justify="flex-end">
                              <Button variant="ghost" onClick={closeMenu}>
                                Cancel
                              </Button>
                              <Button
                                variant="primary"
                                disabled={draft.trim().length === 0}
                                onClick={() => void submitComment(i)}
                              >
                                Add comment
                              </Button>
                            </Inline>
                          </Stack>
                        ) : null}
                        {mode === 'todo' ? (
                          <Stack gap={2}>
                            <SegmentedControl
                              options={TODO_KIND_OPTIONS}
                              value={todoKind}
                              onChange={setTodoKind}
                              aria-label="To-do kind"
                            />
                            <Text size="sm" tone="secondary">
                              {todoKind === 'remind'
                                ? 'A private reminder for you — your biographer never touches it.'
                                : todoKind === 'ask'
                                  ? 'An instruction your biographer folds into the next revision.'
                                  : 'Your biographer will ask you a few questions to gather this, waiting in your Inbox.'}
                            </Text>
                            <Textarea
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              aria-label="To-do"
                              rows={2}
                              placeholder={
                                todoKind === 'remind'
                                  ? 'e.g. upload the photo of Dad’s shop'
                                  : 'e.g. go deeper on the winter he got sick'
                              }
                            />
                            <Inline justify="flex-end">
                              <Button variant="ghost" onClick={closeMenu}>
                                Cancel
                              </Button>
                              <Button
                                variant="primary"
                                disabled={draft.trim().length === 0 || busy}
                                onClick={() => void submitTodo(i)}
                              >
                                {todoKind === 'questions'
                                  ? busy
                                    ? 'Sending…'
                                    : 'Send me questions'
                                  : 'Add to-do'}
                              </Button>
                            </Inline>
                          </Stack>
                        ) : null}
                        {mode === 'edit' ? (
                          <Stack gap={2}>
                            <Text size="sm" tone="secondary">
                              Rewrite this in your own words — it’s kept exactly as you write it.
                            </Text>
                            <Textarea
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              aria-label="Your words"
                              rows={3}
                            />
                            <Inline justify="flex-end">
                              <Button variant="ghost" onClick={closeMenu}>
                                Cancel
                              </Button>
                              <Button
                                variant="primary"
                                disabled={draft.trim().length === 0}
                                onClick={() => void submitEdit(i)}
                              >
                                Save my words
                              </Button>
                            </Inline>
                          </Stack>
                        ) : null}
                        {mode === 'exclude' ? (
                          <Stack gap={2}>
                            <Text size="sm" tone="secondary">
                              Never write about this again. It won’t appear in future chapters, and
                              any chapter that already mentions it is marked to rewrite.
                            </Text>
                            <Textarea
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              aria-label="What to never write about"
                              rows={2}
                            />
                            <Inline justify="flex-end">
                              <Button variant="ghost" onClick={closeMenu}>
                                Cancel
                              </Button>
                              <Button
                                variant="danger"
                                disabled={draft.trim().length === 0}
                                onClick={() => void submitExclude()}
                              >
                                Never write about this
                              </Button>
                            </Inline>
                          </Stack>
                        ) : null}
                      </Stack>
                    </Card>
                  ) : null}

                  {chapter.imagePlacements
                    .filter((pl) => pl.afterAnchor === `p${i}`)
                    .map((pl) => (
                      <figure key={pl.imageId} className={styles.placedImage}>
                        {imageUrls[pl.imageId] ? (
                          <img src={imageUrls[pl.imageId]} alt={pl.caption || 'Book image'} />
                        ) : null}
                        <figcaption>
                          <TextInput
                            value={pl.caption}
                            aria-label="Image caption"
                            placeholder="Caption (optional)"
                            onChange={(e) =>
                              void setPlacement(
                                bookId,
                                chapterId,
                                pl.imageId,
                                pl.afterAnchor,
                                e.target.value,
                              )
                            }
                          />
                          <Inline gap={2}>
                            <Select
                              aria-label="Move image after paragraph"
                              value={pl.afterAnchor}
                              onChange={(e) =>
                                void setPlacement(
                                  bookId,
                                  chapterId,
                                  pl.imageId,
                                  e.target.value,
                                  pl.caption,
                                )
                              }
                            >
                              {paragraphs.map((_, pi) => (
                                <option key={pi} value={`p${pi}`}>
                                  After paragraph {pi + 1}
                                </option>
                              ))}
                            </Select>
                            <button
                              type="button"
                              className={styles.sourcesToggle}
                              aria-label="Remove this image"
                              onClick={() => void removePlacement(bookId, chapterId, pl.imageId)}
                            >
                              Remove
                            </button>
                          </Inline>
                        </figcaption>
                      </figure>
                    ))}
                </div>

                {/* Pending marks live in the right-margin rail beside the measure at ≥900px (a container query,
                  §13.5), and stack under the paragraph below that. */}
                {marks.length > 0 ? (
                  <div className={styles.paraMarks} data-testid="shape-mark-rail">
                    {marks.map((m) => (
                      <div key={m.id} className={styles.markRow}>
                        {m.kind === 'delete' ? (
                          <Text size="sm" tone="secondary">
                            ✂ <del className={styles.deleteQuote}>{m.anchor.quote}</del>
                          </Text>
                        ) : m.kind === 'comment' ? (
                          <Text size="sm" tone="secondary">
                            💬 {INTENT_LABEL[m.intent]}: {m.text}
                          </Text>
                        ) : m.kind === 'todo' ? (
                          <Text size="sm" tone="secondary">
                            ☐ {TODO_KIND_LABEL[m.todoKind] ?? 'To-do'}: {m.text}
                          </Text>
                        ) : null}
                        {m.kind === 'todo' && m.todoKind === 'remind' ? (
                          <button
                            type="button"
                            className={styles.sourcesToggle}
                            onClick={() =>
                              void updateMark(bookId, chapterId, m.id, { status: 'done' })
                            }
                          >
                            Mark done
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={styles.sourcesToggle}
                            aria-label={`Undo this ${m.kind === 'delete' ? 'deletion' : m.kind}`}
                            onClick={() => void removeMark(bookId, chapterId, m.id)}
                          >
                            Undo
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </Stack>
      </div>

      {/* Images in this chapter (§3.8) — illustrate or place an existing photo/illustration; the AI suggests
          where it fits, and you can move it. */}
      <Card>
        <Stack gap={2}>
          <Heading level={3}>Images</Heading>
          {imageError ? <Banner tone="danger">{imageError}</Banner> : null}
          {illustrating ? (
            <ImageProgress
              id={`story:${bookId}:ch:${chapterId}`}
              label="Illustrating this chapter"
            />
          ) : null}
          <Inline gap={2}>
            {imagesReady ? (
              <Button variant="ghost" disabled={imageBusy} onClick={() => void illustrate()}>
                {imageBusy ? 'Working…' : 'Illustrate this chapter'}
              </Button>
            ) : null}
            {placeable.length > 0 ? (
              <Select
                aria-label="Add an image to this chapter"
                value=""
                disabled={imageBusy}
                onChange={(e) => {
                  if (e.target.value) void placeImage(e.target.value);
                }}
              >
                <option value="">Add a photo or illustration…</option>
                {placeable.map((img) => (
                  <option key={img.id} value={img.id}>
                    {img.caption || (img.kind === 'uploaded' ? 'Photo' : 'Illustration')}
                  </option>
                ))}
              </Select>
            ) : null}
          </Inline>
          {!imagesReady && imageKeyChecked ? (
            <Text tone="secondary" size="sm">
              {canManageAi
                ? 'Turn on AI image generation and add your OpenAI key in Settings → Images to illustrate this chapter.'
                : 'Ask the person who set up this household to turn on AI image generation.'}
            </Text>
          ) : null}
        </Stack>
      </Card>

      <Inline justify="space-between">
        {confirmRewrite ? (
          <Inline gap={2}>
            <Text size="sm" tone="secondary">
              Rewrite this whole chapter with your biographer? Your pinned passages and edits in
              your own words are kept, and the current text is saved to History.
            </Text>
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setConfirmRewrite(false);
                setError(null);
                const res = await regenerateChapter(bookId, chapterId);
                if (!res.ok) setError(res.message);
              }}
            >
              Rewrite it
            </Button>
            <Button variant="ghost" onClick={() => setConfirmRewrite(false)}>
              Cancel
            </Button>
          </Inline>
        ) : (
          <Button disabled={busy} onClick={() => setConfirmRewrite(true)}>
            {busy ? 'Rewriting…' : 'Rewrite this chapter'}
          </Button>
        )}
        <Button variant="ghost" onClick={() => setHistoryOpen(true)}>
          History
        </Button>
      </Inline>

      {/* The bottom-sticky pending pill (§13.5): a running count of what the batch revision will act on, opening
          the Review & apply sheet. Inline edits + pins are already applied (they're not marks), so the pill's
          total mirrors `countApplicable`, never those instant changes. */}
      {applicable > 0 ? (
        <div className={styles.pendingPillWrap} aria-live="polite">
          <button
            type="button"
            className={styles.pendingPill}
            onClick={() => setReviewOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={reviewOpen}
          >
            <span className={styles.pendingPillCount}>
              {applicable} change{applicable === 1 ? '' : 's'} ready
              {pillBreakdown ? ` · ${pillBreakdown}` : ''}
            </span>
            <span className={styles.pendingPillHint}>
              — your inline edits and pins are already in
            </span>
          </button>
        </div>
      ) : null}

      {reviewOpen ? (
        <ReviewSheet
          markup={markup}
          busy={busy}
          onRemove={(markId) => void removeMark(bookId, chapterId, markId)}
          onApply={applyBatch}
          onClose={() => setReviewOpen(false)}
        />
      ) : null}

      {historyOpen ? (
        <HistorySheet
          bookId={bookId}
          chapterId={chapterId}
          currentMarkdown={chapter.markdown}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
    </Stack>
  );
}

/** Human labels for why a version was archived (§13.9). */
const VERSION_REASON_LABEL: Record<ChapterVersion['reason'], string> = {
  rewrite: 'Before a rewrite',
  revision: 'Before a revision',
  restore: 'Before a restore',
};

/**
 * The chapter History sheet (§13.9 — the draft vault): every archived version (newest first), each openable
 * into a word-diff compare against the CURRENT text, with restore-any behind a two-step confirm. Restoring
 * archives the current text first, so it is itself undoable. Reuses the shared `.sheet*` chrome.
 */
function HistorySheet({
  bookId,
  chapterId,
  currentMarkdown,
  onClose,
}: {
  bookId: string;
  chapterId: string;
  currentMarkdown: string;
  onClose: () => void;
}): JSX.Element {
  const chapterHistory = useStoryStore((s) => s.chapterHistory);
  const chapterVersion = useStoryStore((s) => s.chapterVersion);
  const restoreChapterVersion = useStoryStore((s) => s.restoreChapterVersion);
  const [history, setHistory] = useState<StoryChapterHistoryView | null>(null);
  const [openRevision, setOpenRevision] = useState<number | null>(null);
  const [openVersion, setOpenVersion] = useState<ChapterVersion | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    void chapterHistory(bookId, chapterId).then((h) => {
      if (live) setHistory(h);
    });
    return () => {
      live = false;
    };
  }, [bookId, chapterId, chapterHistory]);

  const openCompare = async (revision: number): Promise<void> => {
    setConfirmRestore(false);
    if (openRevision === revision) {
      setOpenRevision(null);
      setOpenVersion(null);
      return;
    }
    setOpenRevision(revision);
    setOpenVersion(null);
    const v = await chapterVersion(bookId, chapterId, revision);
    setOpenVersion(v);
    if (!v) setError('That version is no longer here.');
  };

  const restore = async (): Promise<void> => {
    if (openRevision === null) return;
    setBusy(true);
    setError(null);
    const ok = await restoreChapterVersion(bookId, chapterId, openRevision);
    setBusy(false);
    if (ok) onClose();
    else setError('Couldn’t restore that version. Please try again.');
  };

  return (
    <div className={styles.sheetWrap}>
      <div className={styles.sheetBackdrop} onClick={onClose} aria-hidden="true" />
      <aside className={styles.sheetPanel} role="dialog" aria-label="Chapter history">
        <div className={styles.sheetHead}>
          <Heading level={2}>History</Heading>
          <button
            type="button"
            className={styles.sourcesToggle}
            aria-label="Close"
            onClick={onClose}
          >
            ✕ Close
          </button>
        </div>
        <div className={styles.sheetBody}>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {!history ? (
            <Text size="sm" tone="tertiary" aria-live="polite">
              Loading versions…
            </Text>
          ) : history.versions.length === 0 ? (
            <Text size="sm" tone="secondary">
              No earlier versions yet. Every rewrite and revision saves the text it replaces here,
              so nothing is ever lost.
            </Text>
          ) : (
            <Stack gap={2}>
              {history.versions.map((v) => (
                <div key={v.revision} className={styles.reviewRow}>
                  <div className={styles.reviewRowBody}>
                    <Text size="sm">
                      {VERSION_REASON_LABEL[v.reason]} ·{' '}
                      {new Date(v.savedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </Text>
                    <Text size="sm" tone="tertiary">
                      {v.words.toLocaleString()} words
                    </Text>
                  </div>
                  <button
                    type="button"
                    className={styles.sourcesToggle}
                    aria-expanded={openRevision === v.revision}
                    onClick={() => void openCompare(v.revision)}
                  >
                    {openRevision === v.revision ? 'Hide' : 'Compare'}
                  </button>
                </div>
              ))}
              {openRevision !== null ? (
                openVersion ? (
                  <Stack gap={2}>
                    <Text size="sm" tone="tertiary">
                      What changed from that version to now:
                    </Text>
                    <WordDiff previous={openVersion.markdown} current={currentMarkdown} />
                    {confirmRestore ? (
                      <Inline gap={2}>
                        <Text size="sm" tone="secondary">
                          Restore this version? The current text is saved to History first.
                        </Text>
                        <Button variant="primary" disabled={busy} onClick={() => void restore()}>
                          {busy ? 'Restoring…' : 'Restore'}
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmRestore(false)}>
                          Cancel
                        </Button>
                      </Inline>
                    ) : (
                      <Inline>
                        <Button onClick={() => setConfirmRestore(true)}>
                          Restore this version
                        </Button>
                      </Inline>
                    )}
                  </Stack>
                ) : (
                  <Text size="sm" tone="tertiary" aria-live="polite">
                    Loading that version…
                  </Text>
                )
              ) : null}
            </Stack>
          )}
        </div>
      </aside>
    </div>
  );
}

/** One grouped section inside the Review & apply sheet (Cuts / Comments / For your biographer). */
function ReviewGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={styles.reviewGroup}>
      <span className={styles.reviewGroupTitle}>{title}</span>
      <Stack gap={2}>{children}</Stack>
    </div>
  );
}

/** One pending mark in the Review & apply sheet: a short description, its anchor excerpt, and a per-mark
 *  "Remove from this batch" (= the existing mark undo). */
function ReviewRow({
  label,
  excerpt,
  struck,
  onRemove,
}: {
  label?: string;
  excerpt?: string | undefined;
  struck?: boolean;
  onRemove: () => void;
}): JSX.Element {
  return (
    <div className={styles.reviewRow}>
      <div className={styles.reviewRowBody}>
        {label ? <Text size="sm">{label}</Text> : null}
        {excerpt ? (
          <Text size="sm" tone="tertiary" className={styles.reviewExcerpt}>
            {struck ? <del className={styles.deleteQuote}>{excerpt}</del> : `“${excerpt}”`}
          </Text>
        ) : null}
      </div>
      <button type="button" className={styles.sourcesToggle} onClick={onRemove}>
        Remove from this batch
      </button>
    </div>
  );
}

/**
 * The Review & apply sheet (§13.5) — a right-hand sheet over the dimmed chapter listing the pending marks
 * grouped, each removable from the batch, plus the one metered revision (`applyMarkup`, unchanged). Reuses the
 * shared `.sheet*` chrome (the same right-hand sheet the to-do list uses). Instant changes (inline edits, pins)
 * are not marks, so they never appear here — a calm note says so.
 */
function ReviewSheet({
  markup,
  busy,
  onRemove,
  onApply,
  onClose,
}: {
  markup: ChapterMarkup | null;
  busy: boolean;
  onRemove: (markId: string) => void;
  onApply: () => void | Promise<void>;
  onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  type Mark = ChapterMarkup['marks'][number];
  const marks = markup?.marks ?? [];
  const cuts = marks.filter(
    (m): m is Extract<Mark, { kind: 'delete' }> => m.kind === 'delete' && m.status === 'pending',
  );
  const comments = marks.filter(
    (m): m is Extract<Mark, { kind: 'comment' }> =>
      m.kind === 'comment' && m.status === 'open' && m.intent !== 'question',
  );
  const asks = marks.filter(
    (m): m is Extract<Mark, { kind: 'todo' }> =>
      m.kind === 'todo' && m.status === 'open' && m.todoKind === 'ask',
  );

  return (
    <div className={styles.sheetWrap}>
      <div className={styles.sheetBackdrop} onClick={onClose} aria-hidden="true" />
      <aside className={styles.sheetPanel} role="dialog" aria-label="Review and apply changes">
        <div className={styles.sheetHead}>
          <Heading level={2}>Review &amp; apply</Heading>
          <button
            type="button"
            className={styles.sourcesToggle}
            aria-label="Close"
            onClick={onClose}
          >
            ✕ Close
          </button>
        </div>
        <div className={styles.sheetBody}>
          {cuts.length > 0 ? (
            <ReviewGroup title="Cuts">
              {cuts.map((m) => (
                <ReviewRow
                  key={m.id}
                  excerpt={m.anchor.quote}
                  struck
                  onRemove={() => onRemove(m.id)}
                />
              ))}
            </ReviewGroup>
          ) : null}
          {comments.length > 0 ? (
            <ReviewGroup title="Comments">
              {comments.map((m) => (
                <ReviewRow
                  key={m.id}
                  label={`${INTENT_LABEL[m.intent]}: ${m.text}`}
                  excerpt={m.anchor.quote}
                  onRemove={() => onRemove(m.id)}
                />
              ))}
            </ReviewGroup>
          ) : null}
          {asks.length > 0 ? (
            <ReviewGroup title="For your biographer">
              {asks.map((m) => (
                <ReviewRow
                  key={m.id}
                  label={m.text}
                  excerpt={m.anchor?.quote}
                  onRemove={() => onRemove(m.id)}
                />
              ))}
            </ReviewGroup>
          ) : null}
          <Text size="sm" tone="tertiary">
            Your inline edits and pins are already in — they apply the moment you make them.
          </Text>
        </div>
        <div className={styles.sheetFoot}>
          <Button variant="primary" disabled={busy} onClick={() => void onApply()}>
            {busy ? 'Applying…' : 'Apply with your biographer'}
          </Button>
        </div>
      </aside>
    </div>
  );
}

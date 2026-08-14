import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Banner } from '../../../design-system/components';
import { useSessionStore } from '../../../stores/sessionStore';
import { useStoryStore } from '../../../stores/storyStore';
import { StoryMemories } from './StoryMemories';
import { useSetting } from '../../../settings/useSetting';
import { aiKeyResolved } from '../../aiAvailability';
import { AiUnavailableNotice } from '../../AiUnavailableNotice';
import { CrisisFooter } from '../sessions/CrisisFooter';
import styles from './Story.module.css';
import { BookReader } from './BookReader';
import { ChapterReader } from './ChapterReader';
import { DraftProgress } from './DraftProgress';
import { NeedsOutline } from './NeedsOutline';
import { SharedWithYou } from './SharedWithYou';
import { StoryInvitation } from './StoryInvitation';
import { StorySetup } from './StorySetup';
import { StudioLayout } from './StudioLayout';

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
  // `/story/memories` — the book-independent memory collection (§15.1). Checked before every book-shaped
  // branch below, so it renders identically with a book, with several, or with none (the #288 dead-end).
  const memoriesMode = splat === 'memories';
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

  // The living-book cadences (refresh §3.4 + interview §3.7) now run APP-WIDE from AppShell (`useStoryCadences`,
  // §18.5/#298) for every autoRefresh book — not only while this route is mounted — so they're not driven here.

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
    // Not on `/story/memories` — that surface shows no book, so opening one only decrypts a bundle nobody
    // renders and arms the living-book cadences on a screen they don't belong to.
    if (loaded && first && !bundle && !progress && !memoriesMode) void open(first.id);
  }, [loaded, books, bundle, progress, open, memoriesMode]);

  // Load the owner's own-book reader view when on the read route (and not editing). Re-runs when the editor
  // closes (`reading` → null) so returning from an edit shows the fresh prose. Clears it when leaving the route.
  const bookId = bundle?.manifest.id;
  useEffect(() => {
    if (readMode && !reading && bookId) void openOwnBook(bookId);
    if (!readMode) clearOwnReader();
  }, [readMode, reading, bookId, openOwnBook, clearOwnReader]);

  if (!loaded) return <div className={styles.page} aria-busy="true" />;

  // Memories are person-level (§14) and outlive every book, so this route must not sit behind any
  // has-a-book branch — that coupling is exactly what stranded a memory's insight deep-link (#288).
  if (memoriesMode) return <StoryMemories hasBook={books.length > 0} />;

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

  // "Start another book" (§19.2) — the setup/commission flow shows even when books already exist, so it must be
  // checked BEFORE the `if (bundle)` branch (which would otherwise return the Studio for the open book).
  if (mode === 'setup') {
    return (
      <div className={styles.page}>
        {aiUnavailable ? <AiUnavailableNotice /> : null}
        <StorySetup
          titleHint={personName ? `e.g. The Story of ${personName}` : 'e.g. The Story of a Life'}
          personNameForPreview={personName}
          aiUnavailable={aiUnavailable}
          onCancel={() => setMode('idle')}
          onCreate={async (typeId, title, config) => {
            setError(null);
            setMode('idle');
            // Create AND draft the whole book in one flow — no outline-review gate. The draft screen shows
            // immediately (progress is seeded), and the finished book lands ready to edit.
            const res = await createAndDraft({ type: typeId, title, config });
            if (!res.ok && res.message) setError(res.message);
          }}
        />
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <CrisisFooter />
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
            books={books}
            onSwitchBook={(id) => void open(id)}
            onStartNewBook={() => setMode('setup')}
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

  return (
    <div className={styles.page}>
      {aiUnavailable ? <AiUnavailableNotice /> : null}
      <StoryInvitation
        onBegin={() => setMode('setup')}
        onMemories={() => navigate('/story/memories')}
        error={error}
        beginDisabled={aiUnavailable}
      />
      <SharedWithYou />
      <CrisisFooter />
    </div>
  );
}

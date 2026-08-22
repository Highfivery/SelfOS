import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Banner } from '../../../design-system/components';
import { useSessionStore } from '../../../stores/sessionStore';
import { useStoryStore } from '../../../stores/storyStore';
import { StoryMemories } from './StoryMemories';
import { useSetting } from '../../../settings/useSetting';
import { aiKeyResolved } from '../../aiAvailability';
import { AiUnavailableNotice } from '../../AiUnavailableNotice';
import styles from './Books.module.css';
import { BookReader } from './BookReader';
import { ChapterReader } from './ChapterReader';
import { DraftProgress } from './DraftProgress';
import { NeedsOutline } from './NeedsOutline';
import { SharedWithYou } from './SharedWithYou';
import { StoryInvitation } from './StoryInvitation';
import { StorySetup } from './StorySetup';
import { Bookshelf } from './Bookshelf';
import { TypePicker } from './TypePicker';
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
  const openSharedBook = useStoryStore((s) => s.openSharedBook);
  const ownReader = useStoryStore((s) => s.ownReader);
  const openOwnBook = useStoryStore((s) => s.openOwnBook);
  const clearOwnReader = useStoryStore((s) => s.clearOwnReader);
  const clearBundle = useStoryStore((s) => s.clearBundle);
  const shelf = useStoryStore((s) => s.shelf);
  const setReadPosition = useStoryStore((s) => s.setReadPosition);
  const getImageUrl = useStoryStore((s) => s.getImageUrl);

  const navigate = useNavigate();
  // The URL names the book (72 §3.1): `/books` is the shelf, `/books/<id>` the workspace,
  // `/books/<id>/read[/<chapterId>]` the reader. Before the shelf existed a single book was implied, and
  // `/books/read` meant "read the only one" — an assumption that stops being true at two books.
  // `memories` is reserved: it is person-level and belongs to no book (§15.1).
  const segments = (useParams()['*'] ?? '').split('/').filter(Boolean);
  const memoriesMode = segments[0] === 'memories';
  // `shared/<authorId>/<bookId>` opens a book someone shared with you. The Inbox has always emitted
  // this path (`inbox/providers.ts`), but nothing parsed it: `shared` was read as the BOOK id, so the
  // queue entry opened a book that does not exist. `shared` is reserved here alongside `memories`.
  const sharedRoute =
    segments[0] === 'shared' && segments[1] && segments[2]
      ? { authorPersonId: segments[1], bookId: segments[2] }
      : null;
  const routeBookId = memoriesMode || sharedRoute ? null : (segments[0] ?? null);
  const splat = segments.slice(1).join('/');
  const readMode = splat === 'read' || splat.startsWith('read/');
  const routeChapterId = splat.startsWith('read/') ? splat.slice('read/'.length) : null;

  // The begin flow is two screens now: pick a KIND of book (§3.2), then commission it (§3.3).
  const [mode, setMode] = useState<
    { kind: 'idle' } | { kind: 'picking' } | { kind: 'setup'; typeId: string }
  >({
    kind: 'idle',
  });
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

  const requestedBookRef = useRef<string | null>(null);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setMode({ kind: 'idle' });
    setError(null);
    setReading(null);
    requestedBookRef.current = null;
  }, [activePersonId]);

  // The open book follows the URL. Nothing opens itself: the shelf (§3.1) is the front door, and the old
  // "open books[0] on arrival" behaviour was a single-book assumption that silently hid the rest.
  // Asked-once, keyed on the id in the URL. Guarding on the RESULT instead — "open until the open book is
  // the one named" — spins forever whenever the open can't satisfy it: a book that was deleted, an id that
  // never existed, a hand-typed URL. Each failed attempt re-renders, which re-runs the effect, which asks
  // again. The book being missing is exactly when this must stop, not loop.
  useEffect(() => {
    if (!loaded || !routeBookId || progress) return;
    if (bundle?.manifest.id === routeBookId || requestedBookRef.current === routeBookId) return;
    requestedBookRef.current = routeBookId;
    void open(routeBookId);
  }, [loaded, routeBookId, bundle, progress, open]);

  // Open a shared book named by the URL. Asked-once per id (the `requestedBookRef` pattern above): a
  // book that was unshared or deleted must stop asking rather than re-render into a loop.
  const sharedKey = sharedRoute ? `${sharedRoute.authorPersonId}/${sharedRoute.bookId}` : null;
  const requestedSharedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded || !sharedRoute || !sharedKey) return;
    if (requestedSharedRef.current === sharedKey) return;
    requestedSharedRef.current = sharedKey;
    void openSharedBook(sharedRoute.authorPersonId, sharedRoute.bookId);
  }, [loaded, sharedKey, sharedRoute, openSharedBook]);

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
            // Arrived via /books/shared/<author>/<book> (an Inbox entry) — leaving the reader must
            // also leave that URL, or the shelf renders under a route that no longer describes it.
            if (sharedRoute) navigate('/books');
          }}
          resolveImage={async (imageId) => {
            const img = await window.selfos?.booksReadSharedImage({
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
  if (mode.kind === 'picking') {
    return (
      <div className={styles.page}>
        <TypePicker
          onPick={(typeId) => setMode({ kind: 'setup', typeId })}
          onCancel={() => setMode({ kind: 'idle' })}
        />
      </div>
    );
  }

  if (mode.kind === 'setup') {
    return (
      <div className={styles.page}>
        {aiUnavailable ? <AiUnavailableNotice /> : null}
        <StorySetup
          typeId={mode.typeId}
          titleHint={personName ? `e.g. The Story of ${personName}` : 'e.g. The Story of a Life'}
          personNameForPreview={personName}
          aiUnavailable={aiUnavailable}
          onCancel={() => setMode({ kind: 'picking' })}
          onCreate={async (typeId, title, config) => {
            setError(null);
            setMode({ kind: 'idle' });
            // Create AND draft the whole book in one flow — no outline-review gate. The draft screen shows
            // immediately (progress is seeded), and the finished book lands ready to edit.
            const res = await createAndDraft({ type: typeId, title, config });
            if (!res.ok && res.message) setError(res.message);
          }}
        />
        {error ? <Banner tone="danger">{error}</Banner> : null}
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
              onNavigate={(id) =>
                navigate(id ? `/books/${bookId}/read/${id}` : `/books/${bookId}/read`)
              }
              onExit={() => navigate(`/books/${bookId}`)}
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
            onStartNewBook={() => setMode({ kind: 'picking' })}
            onBackToShelf={() => {
              clearBundle();
              navigate('/books');
            }}
            onOpenChapter={setReading}
            onReadBook={() => navigate(`/books/${bundle.manifest.id}/read`)}
            aiUnavailable={aiUnavailable}
          />
        </div>
      );
    }
    // A book exists but has no outline yet — a draft that hasn't run, or one that failed. Offer to draft (or
    // retry) it, and surface any error, so it's never a silent dead-end.
    return (
      <div className={styles.page}>
        {/* A book whose draft hasn't run (or failed) is still one book among several — without this the
            only way out of it was the browser's back button (72 §3.1). */}
        <button
          type="button"
          className={styles.backToShelf}
          onClick={() => {
            clearBundle();
            navigate('/books');
          }}
        >
          ← All books
        </button>
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
      </div>
    );
  }

  // No book open: the shelf, or — for someone with none — the invitation (§3.1).
  return (
    <div className={styles.page}>
      {aiUnavailable ? <AiUnavailableNotice /> : null}
      {shelf.length > 0 ? (
        <Bookshelf
          onOpen={(id) => {
            // Open AND navigate: the store is what renders, the URL is what deep-links. Driving only the
            // URL would break every surface rendered without a Route (RTL) — the same mirroring the
            // Studio's tabs already do.
            void open(id);
            navigate(`/books/${id}`);
          }}
          onNew={() => setMode({ kind: 'picking' })}
          resolveCover={(bookId, imageId) => getImageUrl(bookId, imageId)}
        />
      ) : (
        <>
          <StoryInvitation
            onBegin={() => setMode({ kind: 'picking' })}
            onMemories={() => navigate('/books/memories')}
            error={error}
            beginDisabled={aiUnavailable}
          />
          <SharedWithYou />
        </>
      )}
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </div>
  );
}

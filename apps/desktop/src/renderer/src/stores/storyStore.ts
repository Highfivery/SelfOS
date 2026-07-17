import { create } from 'zustand';
import type {
  BookConfig,
  BookManifest,
  BookOutline,
  ChapterMarkup,
  ExclusionItem,
  ExclusionKind,
  MarkupMark,
  StoryBookBundle,
  StoryBookTypeView,
  StoryChaptersResult,
  StoryCreateInput,
  StoryDraftProgress,
  StoryFoundationsResult,
  StoryMarkPatch,
  StoryQuestionsResult,
  BookMatter,
  BookReader,
  SharedBookSummary,
  StoryCompleteness,
  StoryImageEntry,
  StoryImageResult,
  StoryImageTarget,
  StoryPhotoAnalyzeResult,
  StoryPhotoAnswer,
  StoryPlacementSuggestResult,
  StoryInterviewCadenceResult,
  StoryPublishResult,
  StoryOwnBookView,
  StoryReaderView,
  StoryRefreshViewResult,
  StoryResolveProposalResult,
  StoryRevisionResult,
  StoryTodoEntry,
  StructuralProposal,
  TextAnchor,
} from '@shared/schemas';

interface StoryState {
  /** The registered book types (v1: the biography) — for the create picker. */
  bookTypes: StoryBookTypeView[];
  /** The ACTIVE person's OWN books. The bridge scopes it; this store never holds another member's books and
   *  resets on a person switch (per-person isolation, 64-your-story §5.7). */
  books: BookManifest[];
  /** The currently-open book's full bundle (manifest + outline + timeline + chapters), or null. */
  bundle: StoryBookBundle | null;
  loaded: boolean;
  /** True while the foundations pass is running (the setup → outline transition). */
  generating: boolean;
  /** True while the chapter-generation pass is running (the book overview). */
  chaptersGenerating: boolean;
  /** Live create-and-draft progress (§3.2), streamed from main. Non-null while a book is being drafted — it
   *  drives the loading screen AND the sidebar indicator, and survives navigation (the draft runs in main).
   *  `startedAt` is the renderer clock at kickoff, for the elapsed timer + the improving time estimate. */
  progress: (StoryDraftProgress & { startedAt: number; scope: 'create' | 'chapters' }) | null;
  load: () => Promise<void>;
  create: (input: StoryCreateInput) => Promise<BookManifest | null>;
  /** Create a book AND draft it end-to-end (§3.2) — the new one-tap flow (no outline-review gate). */
  createAndDraft: (input: StoryCreateInput) => Promise<{ ok: boolean; message?: string }>;
  /** Draft an existing book end-to-end (foundations → auto-approve → chapters), streaming progress. */
  draftBook: (bookId: string) => Promise<{ ok: boolean; message?: string }>;
  /** Rewrite from scratch (§13.6.6): reset the book (keeping photos/exclusions/answers/config/cover), then run
   *  the standard streamed full draft. Mirrors createAndDraft (reset → draftBook). */
  rewriteFromScratch: (bookId: string) => Promise<{ ok: boolean; message?: string }>;
  /** Subscribe to the main-side draft-progress stream (wired once at app level). Returns an unsubscribe. */
  subscribeProgress: () => () => void;
  open: (bookId: string) => Promise<StoryBookBundle | null>;
  generateFoundations: (bookId: string) => Promise<StoryFoundationsResult>;
  saveOutline: (bookId: string, outline: BookOutline) => Promise<void>;
  approveOutline: (bookId: string, outline: BookOutline) => Promise<BookManifest | null>;
  generateChapters: (bookId: string) => Promise<StoryChaptersResult>;
  regenerateChapter: (bookId: string, chapterId: string) => Promise<StoryChaptersResult>;
  reviewChapter: (bookId: string, chapterId: string) => Promise<boolean>;
  /** The living-book refresh pass (§3.4): mark stale + auto-rewrite. `auto` = the throttled launch/focus cadence
   *  (silent: never shows the busy state, only re-sets the bundle when something actually changed); omit for a
   *  manual "Refresh now" (uncapped, shows the busy state). */
  refreshBook: (bookId: string, opts?: { auto?: boolean }) => Promise<StoryRefreshViewResult>;
  /** The open chapter's markup layer (the suggestion layer), or null. The reader loads it per chapter. */
  markup: ChapterMarkup | null;
  loadMarkup: (bookId: string, chapterId: string) => Promise<void>;
  clearMarkup: () => void;
  addMark: (bookId: string, chapterId: string, mark: MarkupMark) => Promise<void>;
  updateMark: (
    bookId: string,
    chapterId: string,
    markId: string,
    patch: StoryMarkPatch,
  ) => Promise<void>;
  removeMark: (bookId: string, chapterId: string, markId: string) => Promise<void>;
  /** Flag a source insight as inaccurate in Memory (specs 20/44) — the "Fix this" comment hand-off (§3.3). */
  flagInsight: (insightId: string) => Promise<void>;
  applyMarkup: (bookId: string, chapterId: string) => Promise<StoryRevisionResult>;
  editPassage: (
    bookId: string,
    chapterId: string,
    anchor: TextAnchor,
    newText: string,
  ) => Promise<boolean>;
  pinQuote: (
    bookId: string,
    chapterId: string,
    anchor: TextAnchor,
    text: string,
  ) => Promise<boolean>;
  /** The book-level to-do roll-up ("To do" list on the overview). */
  todos: StoryTodoEntry[];
  loadTodos: (bookId: string) => Promise<void>;
  /** Turn a to-do into a story check-in (§5.5) — mints an in-app self-send + records a questionsSent to-do. */
  todoToQuestions: (
    bookId: string,
    chapterId: string,
    focus: string,
    anchor?: TextAnchor,
  ) => Promise<StoryQuestionsResult>;
  /** The book's exclusions ("never write about this again") — for the overview panel. */
  exclusions: ExclusionItem[];
  loadExclusions: (bookId: string) => Promise<void>;
  exclude: (bookId: string, kind: ExclusionKind, value: string, note?: string) => Promise<number>;
  unexclude: (bookId: string, itemId: string) => Promise<void>;
  /** The book's PENDING structural proposals (§3.4) — the overview "Suggested changes" panel. */
  proposals: StructuralProposal[];
  loadProposals: (bookId: string) => Promise<void>;
  resolveProposal: (
    bookId: string,
    proposalId: string,
    action: 'approve' | 'dismiss',
  ) => Promise<StoryResolveProposalResult>;
  /** How far along the book is (§3.6) — a qualitative stage + subtle ratio, from the stored coverage. */
  completeness: StoryCompleteness | null;
  loadCompleteness: (bookId: string) => Promise<void>;
  /** The autonomous interview cadence (§3.7): gap-pass + mint ≤1 story check-in. `auto` = the throttled
   *  launch/focus cadence; omit for a manual "find what's missing". Refreshes completeness on a real pass. */
  runInterviewCheck: (
    bookId: string,
    opts?: { auto?: boolean },
  ) => Promise<StoryInterviewCadenceResult>;
  update: (
    bookId: string,
    patch: { title?: string; config?: BookConfig; matter?: BookMatter },
  ) => Promise<void>;
  /** Publishing & readers (§3.5) — the "Share & readers" panel. */
  readers: BookReader[];
  loadReaders: (bookId: string) => Promise<void>;
  publish: (bookId: string) => Promise<StoryPublishResult>;
  grantReader: (bookId: string, readerPersonId: string) => Promise<void>;
  revokeReader: (bookId: string, readerPersonId: string) => Promise<void>;
  readerFeatured: (bookId: string, readerPersonId: string) => Promise<boolean>;
  /** Export the published head as a Markdown file outside the vault (§3.9). Returns the saved path, or null. */
  exportMarkdown: (bookId: string) => Promise<string | null>;
  exportPdf: (bookId: string) => Promise<string | null>;
  /** Images (§3.8) — cover + chapter illustrations. `imageUrls` caches decrypted data URLs by image id. */
  images: StoryImageEntry[];
  imageUrls: Record<string, string>;
  loadImages: (bookId: string) => Promise<void>;
  generateImage: (bookId: string, target: StoryImageTarget) => Promise<StoryImageResult>;
  getImageUrl: (bookId: string, imageId: string) => Promise<string | null>;
  deleteImage: (bookId: string, imageId: string) => Promise<void>;
  /** Photos (§3.7) — uploads + vision Q&A. `photoAnswers` is the answered Q&A corpus. */
  photoAnswers: StoryPhotoAnswer[];
  loadPhotoAnswers: (bookId: string) => Promise<void>;
  uploadPhoto: (
    bookId: string,
    mime: string,
    dataBase64: string,
    chapterId?: string,
  ) => Promise<StoryImageEntry | null>;
  analyzePhoto: (bookId: string, imageId: string) => Promise<StoryPhotoAnalyzeResult>;
  answerPhoto: (bookId: string, imageId: string, question: string, answer: string) => Promise<void>;
  /** Image placement in a chapter (§3.8) — AI suggests the anchor; set/move/remove refresh the bundle. */
  suggestPlacement: (
    bookId: string,
    chapterId: string,
    imageId: string,
  ) => Promise<StoryPlacementSuggestResult>;
  setPlacement: (
    bookId: string,
    chapterId: string,
    imageId: string,
    afterAnchor: string,
    caption?: string,
  ) => Promise<void>;
  removePlacement: (bookId: string, chapterId: string, imageId: string) => Promise<void>;
  /** Books shared WITH the active person (§3.5) — the "Shared with you" surface + the reader view. */
  sharedBooks: SharedBookSummary[];
  loadSharedBooks: () => Promise<void>;
  readerView: StoryReaderView | null;
  openSharedBook: (authorPersonId: string, bookId: string) => Promise<void>;
  closeSharedBook: () => void;
  /** The owner reading their OWN book as a book (§13.5) — the draft head + the device-local resume position. */
  ownReader: StoryOwnBookView | null;
  openOwnBook: (bookId: string) => Promise<void>;
  clearOwnReader: () => void;
  /** Record the owner's last-read chapter (device-local). Fire-and-forget; updates the local resume hint. */
  setReadPosition: (bookId: string, chapterId: string) => void;
  remove: (bookId: string) => Promise<void>;
  clearBundle: () => void;
  reset: () => void;
}

const NOT_AVAILABLE: StoryFoundationsResult = {
  ok: false,
  reason: 'ERROR',
  message: 'Not available.',
};
const CHAPTERS_NOT_AVAILABLE: StoryChaptersResult = {
  ok: false,
  reason: 'ERROR',
  message: 'Not available.',
};
const REVISION_NOT_AVAILABLE: StoryRevisionResult = {
  ok: false,
  reason: 'ERROR',
  message: 'Not available.',
};
const QUESTIONS_NOT_AVAILABLE: StoryQuestionsResult = {
  ok: false,
  reason: 'ERROR',
  message: 'Not available.',
};
const REFRESH_NOT_AVAILABLE: StoryRefreshViewResult = { staled: 0, rewritten: 0, bundle: null };

export const useStoryStore = create<StoryState>((set, get) => ({
  bookTypes: [],
  books: [],
  bundle: null,
  markup: null,
  todos: [],
  exclusions: [],
  proposals: [],
  completeness: null,
  readers: [],
  images: [],
  imageUrls: {},
  photoAnswers: [],
  sharedBooks: [],
  readerView: null,
  loaded: false,
  generating: false,
  chaptersGenerating: false,
  progress: null,
  load: async () => {
    const [bookTypes, books] = await Promise.all([
      window.selfos?.storyBookTypes() ?? Promise.resolve([]),
      window.selfos?.storyList() ?? Promise.resolve([]),
    ]);
    set({ bookTypes, books, loaded: true });
  },
  create: async (input) => {
    const book = (await window.selfos?.storyCreate(input)) ?? null;
    if (book) await get().load();
    return book;
  },
  subscribeProgress: () => {
    const unsub = window.selfos?.onStoryProgress((p) => {
      // Merge the streamed update, keeping the renderer-side `startedAt` for the elapsed timer/estimate. A
      // terminal `done`/`error` clears progress (the awaiting action swaps in the finished bundle / error).
      if (p.phase === 'done' || p.phase === 'error') {
        set({ progress: null });
        return;
      }
      // Merge over the seeded progress, keeping the renderer-only `startedAt` + `scope` (which UI shows it).
      set((s) => ({
        progress: {
          ...s.progress,
          ...p,
          startedAt: s.progress?.startedAt ?? Date.now(),
          scope: s.progress?.scope ?? 'create',
        },
      }));
    });
    return unsub ?? (() => {});
  },
  createAndDraft: async (input) => {
    const book = (await window.selfos?.storyCreate(input)) ?? null;
    if (!book) return { ok: false, message: 'Couldn’t start your story. Try again.' };
    await get().load();
    return get().draftBook(book.id);
  },
  rewriteFromScratch: async (bookId) => {
    const reset = (await window.selfos?.storyRewriteFromScratch({ bookId })) ?? null;
    if (!reset) return { ok: false, message: 'Couldn’t rewrite your book. Try again.' };
    set({ bundle: reset });
    return get().draftBook(bookId);
  },
  draftBook: async (bookId) => {
    // Seed the progress immediately so the loading screen shows before the first event lands.
    set({
      progress: {
        bookId,
        phase: 'reading',
        chaptersDone: 0,
        chaptersTotal: 0,
        startedAt: Date.now(),
        scope: 'create',
      },
    });
    try {
      const result = (await window.selfos?.storyGenerateFullDraft({ bookId })) ?? NOT_AVAILABLE;
      if (result.ok) {
        set({ bundle: result.bundle });
        await get().load();
        return { ok: true };
      }
      // On failure, surface the book (its outline may be null) so it lands on NeedsOutline with a retry —
      // never a silent dead-end (the DoD rule).
      await get().open(bookId);
      return { ok: false, message: result.message };
    } finally {
      set({ progress: null }); // the stream's terminal event usually clears it first; this is the backstop
    }
  },
  open: async (bookId) => {
    const bundle = (await window.selfos?.storyGet({ bookId })) ?? null;
    set({ bundle });
    return bundle;
  },
  generateFoundations: async (bookId) => {
    set({ generating: true });
    try {
      const result = (await window.selfos?.storyGenerateFoundations({ bookId })) ?? NOT_AVAILABLE;
      if (result.ok) set({ bundle: result.bundle });
      await get().load();
      return result;
    } finally {
      set({ generating: false });
    }
  },
  saveOutline: async (bookId, outline) => {
    await window.selfos?.storySaveOutline({ bookId, outline });
    await get().open(bookId);
  },
  approveOutline: async (bookId, outline) => {
    const manifest = (await window.selfos?.storyApproveOutline({ bookId, outline })) ?? null;
    await get().open(bookId);
    await get().load();
    return manifest;
  },
  generateChapters: async (bookId) => {
    // Show the rich progress screen (§3.2), same as create-and-draft. Seed the counts from the current bundle
    // (chapters already written / total in the outline) so it opens on real numbers, not a "0 of 0" flicker;
    // the per-chapter stream then keeps it live. Runs in main, so it continues if the person navigates away.
    const b = get().bundle;
    const total = b?.outline
      ? b.outline.parts.reduce((n, p) => n + p.chapters.length, 0)
      : (b?.chapters.length ?? 0);
    const written = b ? b.chapters.filter((c) => c.markdown.trim().length > 0).length : 0;
    set({
      progress: {
        bookId,
        phase: 'writing',
        chaptersDone: written,
        chaptersTotal: total,
        startedAt: Date.now(),
        scope: 'chapters',
      },
    });
    try {
      const result =
        (await window.selfos?.storyGenerateChapters({ bookId })) ?? CHAPTERS_NOT_AVAILABLE;
      if (result.ok) set({ bundle: result.bundle });
      await get().load();
      return result;
    } finally {
      set({ progress: null });
    }
  },
  regenerateChapter: async (bookId, chapterId) => {
    set({ chaptersGenerating: true });
    try {
      const result =
        (await window.selfos?.storyRegenerateChapter({ bookId, chapterId })) ??
        CHAPTERS_NOT_AVAILABLE;
      if (result.ok) set({ bundle: result.bundle });
      return result;
    } finally {
      set({ chaptersGenerating: false });
    }
  },
  reviewChapter: async (bookId, chapterId) => {
    const bundle = (await window.selfos?.storyReviewChapter({ bookId, chapterId })) ?? null;
    if (bundle) set({ bundle });
    return bundle !== null;
  },
  refreshBook: async (bookId, opts) => {
    // The auto cadence runs silently — never flash the busy controls, and only re-set the bundle when a pass
    // actually staled/rewrote something (a throttled no-op must not churn the UI, matching insightStore.autoReconcile).
    if (opts?.auto) {
      const res =
        (await window.selfos?.storyRefreshCheck({ bookId, auto: true })) ?? REFRESH_NOT_AVAILABLE;
      if (res.bundle && (res.rewritten > 0 || res.staled > 0)) set({ bundle: res.bundle });
      return res;
    }
    set({ chaptersGenerating: true });
    try {
      const res =
        (await window.selfos?.storyRefreshCheck({ bookId, ...(opts ?? {}) })) ??
        REFRESH_NOT_AVAILABLE;
      if (res.bundle) set({ bundle: res.bundle });
      return res;
    } finally {
      set({ chaptersGenerating: false });
    }
  },
  loadMarkup: async (bookId, chapterId) => {
    const markup = (await window.selfos?.storyGetMarkup({ bookId, chapterId })) ?? null;
    // Guard a stale, late-resolving load (fast chapter A→B nav) from overwriting the newer chapter's markup —
    // the returned layer carries its own chapterId (display-only; the backend always applies the right one).
    if (!markup || markup.chapterId === chapterId) set({ markup });
  },
  clearMarkup: () => set({ markup: null }),
  addMark: async (bookId, chapterId, mark) => {
    const markup = (await window.selfos?.storyMark({ bookId, chapterId, mark })) ?? null;
    if (markup) set({ markup });
  },
  updateMark: async (bookId, chapterId, markId, patch) => {
    const markup =
      (await window.selfos?.storyUpdateMark({ bookId, chapterId, markId, patch })) ?? null;
    if (markup) set({ markup });
  },
  removeMark: async (bookId, chapterId, markId) => {
    const markup = (await window.selfos?.storyRemoveMark({ bookId, chapterId, markId })) ?? null;
    if (markup) set({ markup });
  },
  flagInsight: async (insightId) => {
    await window.selfos?.insightsFlag({ insightId, flagged: true });
  },
  applyMarkup: async (bookId, chapterId) => {
    set({ chaptersGenerating: true });
    try {
      const result =
        (await window.selfos?.storyApplyMarkup({ bookId, chapterId })) ?? REVISION_NOT_AVAILABLE;
      if (result.ok) set({ bundle: result.bundle, markup: result.markup });
      return result;
    } finally {
      set({ chaptersGenerating: false });
    }
  },
  editPassage: async (bookId, chapterId, anchor, newText) => {
    const bundle =
      (await window.selfos?.storyEditPassage({ bookId, chapterId, anchor, newText })) ?? null;
    if (bundle) set({ bundle });
    return bundle !== null;
  },
  pinQuote: async (bookId, chapterId, anchor, text) => {
    const bundle =
      (await window.selfos?.storyPinQuote({ bookId, chapterId, anchor, text })) ?? null;
    if (bundle) set({ bundle });
    return bundle !== null;
  },
  loadTodos: async (bookId) => {
    const roll = (await window.selfos?.storyTodos({ bookId })) ?? null;
    set({ todos: roll?.todos ?? [] });
  },
  todoToQuestions: async (bookId, chapterId, focus, anchor) => {
    set({ chaptersGenerating: true });
    try {
      const res =
        (await window.selfos?.storyTodoToQuestions({
          bookId,
          chapterId,
          focus,
          ...(anchor ? { anchor } : {}),
        })) ?? QUESTIONS_NOT_AVAILABLE;
      if (res.ok) set({ markup: res.markup });
      return res;
    } finally {
      set({ chaptersGenerating: false });
    }
  },
  loadExclusions: async (bookId) => {
    const exclusions = (await window.selfos?.storyExclusions({ bookId })) ?? [];
    set({ exclusions });
  },
  exclude: async (bookId, kind, value, note) => {
    const res = await window.selfos?.storyExclude({
      bookId,
      kind,
      value,
      ...(note ? { note } : {}),
    });
    if (res) set({ exclusions: res.exclusions, bundle: res.bundle });
    return res?.staled ?? 0;
  },
  unexclude: async (bookId, itemId) => {
    const exclusions = (await window.selfos?.storyUnexclude({ bookId, itemId })) ?? [];
    set({ exclusions });
  },
  loadProposals: async (bookId) => {
    const proposals = (await window.selfos?.storyProposals({ bookId })) ?? [];
    set({ proposals });
  },
  resolveProposal: async (bookId, proposalId, action) => {
    const res = (await window.selfos?.storyResolveProposal({ bookId, proposalId, action })) ?? {
      ok: false,
      proposals: [],
      bundle: null,
    };
    // Approve mutates the outline/chapters → adopt the fresh bundle; both actions update the pending list.
    set({ proposals: res.proposals, ...(res.bundle ? { bundle: res.bundle } : {}) });
    return res;
  },
  loadCompleteness: async (bookId) => {
    const completeness = (await window.selfos?.storyCompleteness({ bookId })) ?? null;
    set({ completeness });
  },
  runInterviewCheck: async (bookId, opts) => {
    const res = (await window.selfos?.storyInterviewCheck({ bookId, ...(opts ?? {}) })) ?? {
      outcome: 'noBook' as const,
    };
    // A run that actually gap-passed refreshed the coverage — adopt the new completeness.
    if (res.completeness) set({ completeness: res.completeness });
    return res;
  },
  update: async (bookId, patch) => {
    await window.selfos?.storyUpdate({ bookId, ...patch });
    await get().open(bookId);
    await get().load();
  },
  loadReaders: async (bookId) => {
    const readers = (await window.selfos?.storyReaders({ bookId })) ?? [];
    set({ readers });
  },
  publish: async (bookId) => {
    const res = (await window.selfos?.storyPublish({ bookId })) ?? {
      ok: false as const,
      message: 'Not available.',
    };
    if (res.ok) await get().open(bookId); // the manifest gains publishedAt
    return res;
  },
  grantReader: async (bookId, readerPersonId) => {
    const readers = (await window.selfos?.storyGrantReader({ bookId, readerPersonId })) ?? [];
    set({ readers });
  },
  revokeReader: async (bookId, readerPersonId) => {
    const readers = (await window.selfos?.storyRevokeReader({ bookId, readerPersonId })) ?? [];
    set({ readers });
  },
  readerFeatured: async (bookId, readerPersonId) =>
    (await window.selfos?.storyReaderFeatured({ bookId, readerPersonId })) ?? false,
  exportMarkdown: async (bookId) => (await window.selfos?.storyExportMarkdown({ bookId })) ?? null,
  exportPdf: async (bookId) => (await window.selfos?.storyExportPdf({ bookId })) ?? null,
  loadImages: async (bookId) => {
    const images = (await window.selfos?.storyImages({ bookId })) ?? [];
    set({ images });
  },
  generateImage: async (bookId, target) => {
    const res = (await window.selfos?.storyGenerateImage({
      bookId,
      target,
    })) ?? { ok: false, reason: 'ERROR', message: 'SelfOS isn’t ready yet.' };
    if (res.ok) {
      // Refresh the index + the book (a cover updates the manifest's coverImageId), then cache the new bytes.
      await get().loadImages(bookId);
      await get().open(bookId);
      await get().getImageUrl(bookId, res.image.id);
    }
    return res;
  },
  getImageUrl: async (bookId, imageId) => {
    const cached = get().imageUrls[imageId];
    if (cached) return cached;
    const image = await window.selfos?.storyGetImage({ bookId, imageId });
    if (!image) return null;
    const url = `data:${image.mime};base64,${image.dataBase64}`;
    set((s) => ({ imageUrls: { ...s.imageUrls, [imageId]: url } }));
    return url;
  },
  deleteImage: async (bookId, imageId) => {
    await window.selfos?.storyDeleteImage({ bookId, imageId });
    await get().loadImages(bookId);
    await get().open(bookId);
    set((s) => {
      const next = { ...s.imageUrls };
      delete next[imageId];
      return { imageUrls: next };
    });
  },
  loadPhotoAnswers: async (bookId) => {
    const photoAnswers = (await window.selfos?.storyPhotoAnswers({ bookId })) ?? [];
    set({ photoAnswers });
  },
  uploadPhoto: async (bookId, mime, dataBase64, chapterId) => {
    const entry =
      (await window.selfos?.storyUploadPhoto({
        bookId,
        mime,
        dataBase64,
        ...(chapterId ? { chapterId } : {}),
      })) ?? null;
    if (entry) await get().loadImages(bookId);
    return entry;
  },
  analyzePhoto: async (bookId, imageId) => {
    const res = (await window.selfos?.storyAnalyzePhoto({ bookId, imageId })) ?? {
      ok: false as const,
      reason: 'ERROR' as const,
      message: 'SelfOS isn’t ready yet.',
    };
    if (res.ok) await get().loadImages(bookId); // the caption was stamped onto the entry
    return res;
  },
  answerPhoto: async (bookId, imageId, question, answer) => {
    await window.selfos?.storyAnswerPhoto({ bookId, imageId, question, answer });
    await get().loadPhotoAnswers(bookId);
  },
  suggestPlacement: async (bookId, chapterId, imageId) =>
    (await window.selfos?.storySuggestPlacement({ bookId, chapterId, imageId })) ?? {
      ok: false as const,
      reason: 'ERROR',
      message: 'SelfOS isn’t ready yet.',
    },
  setPlacement: async (bookId, chapterId, imageId, afterAnchor, caption) => {
    const bundle =
      (await window.selfos?.storySetPlacement({
        bookId,
        chapterId,
        imageId,
        afterAnchor,
        ...(caption !== undefined ? { caption } : {}),
      })) ?? null;
    if (bundle) set({ bundle });
  },
  removePlacement: async (bookId, chapterId, imageId) => {
    const bundle =
      (await window.selfos?.storyRemovePlacement({ bookId, chapterId, imageId })) ?? null;
    if (bundle) set({ bundle });
  },
  loadSharedBooks: async () => {
    const sharedBooks = (await window.selfos?.storySharedBooks()) ?? [];
    set({ sharedBooks });
  },
  openSharedBook: async (authorPersonId, bookId) => {
    const readerView = (await window.selfos?.storyReadShared({ authorPersonId, bookId })) ?? null;
    set({ readerView });
    if (readerView) {
      // Record the open (device-local read progress) so the one-time "shared with you" notification + the
      // "Updated" marker clear until the author republishes (§3.6).
      await window.selfos?.storyMarkSharedRead({ authorPersonId, bookId });
      await get().loadSharedBooks();
    }
  },
  closeSharedBook: () => set({ readerView: null }),
  ownReader: null,
  openOwnBook: async (bookId) => {
    const ownReader = (await window.selfos?.storyReadOwnBook({ bookId })) ?? null;
    set({ ownReader });
  },
  clearOwnReader: () => set({ ownReader: null }),
  setReadPosition: (bookId, chapterId) => {
    void window.selfos?.storySetReadPosition({ bookId, chapterId });
    // Reflect it locally so a re-open of the reader resumes here without a round-trip.
    set((s) => (s.ownReader ? { ownReader: { ...s.ownReader, lastChapterId: chapterId } } : {}));
  },
  remove: async (bookId) => {
    await window.selfos?.storyDelete({ bookId });
    set({ bundle: null });
    await get().load();
  },
  clearBundle: () => set({ bundle: null }),
  reset: () =>
    set({
      bookTypes: [],
      books: [],
      bundle: null,
      markup: null,
      todos: [],
      exclusions: [],
      proposals: [],
      completeness: null,
      readers: [],
      images: [],
      imageUrls: {},
      photoAnswers: [],
      sharedBooks: [],
      readerView: null,
      ownReader: null,
      loaded: false,
      generating: false,
      chaptersGenerating: false,
      progress: null,
    }),
}));

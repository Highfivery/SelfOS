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
  StoryFoundationsResult,
  StoryMarkPatch,
  StoryQuestionsResult,
  StoryCompleteness,
  StoryInterviewCadenceResult,
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
  load: () => Promise<void>;
  create: (input: StoryCreateInput) => Promise<BookManifest | null>;
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
  update: (bookId: string, patch: { title?: string; config?: BookConfig }) => Promise<void>;
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
  loaded: false,
  generating: false,
  chaptersGenerating: false,
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
    set({ chaptersGenerating: true });
    try {
      const result =
        (await window.selfos?.storyGenerateChapters({ bookId })) ?? CHAPTERS_NOT_AVAILABLE;
      if (result.ok) set({ bundle: result.bundle });
      await get().load();
      return result;
    } finally {
      set({ chaptersGenerating: false });
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
      loaded: false,
      generating: false,
      chaptersGenerating: false,
    }),
}));

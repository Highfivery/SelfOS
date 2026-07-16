import { create } from 'zustand';
import type {
  BookConfig,
  BookManifest,
  BookOutline,
  StoryBookBundle,
  StoryBookTypeView,
  StoryChaptersResult,
  StoryCreateInput,
  StoryFoundationsResult,
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

export const useStoryStore = create<StoryState>((set, get) => ({
  bookTypes: [],
  books: [],
  bundle: null,
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
      loaded: false,
      generating: false,
      chaptersGenerating: false,
    }),
}));

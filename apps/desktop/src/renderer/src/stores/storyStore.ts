import { create } from 'zustand';
import type {
  BookConfig,
  BookManifest,
  BookOutline,
  StoryBookBundle,
  StoryBookTypeView,
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
  load: () => Promise<void>;
  create: (input: StoryCreateInput) => Promise<BookManifest | null>;
  open: (bookId: string) => Promise<StoryBookBundle | null>;
  generateFoundations: (bookId: string) => Promise<StoryFoundationsResult>;
  saveOutline: (bookId: string, outline: BookOutline) => Promise<void>;
  approveOutline: (bookId: string, outline: BookOutline) => Promise<BookManifest | null>;
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

export const useStoryStore = create<StoryState>((set, get) => ({
  bookTypes: [],
  books: [],
  bundle: null,
  loaded: false,
  generating: false,
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
  reset: () => set({ bookTypes: [], books: [], bundle: null, loaded: false, generating: false }),
}));

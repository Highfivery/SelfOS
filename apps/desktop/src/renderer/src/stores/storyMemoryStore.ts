import { create } from 'zustand';
import type {
  AttachmentRef,
  ChatMessage,
  StoryMemory,
  StoryMemoryEdits,
  StoryMemoryView,
} from '@shared/schemas';
import type { PendingAttachment } from '../app/routes/sessions/downscaleImage';
import { useBudgetStore } from './budgetStore';

/**
 * "Share a memory" (64 §14) — the interactive biographer interview chat + its synthesized memory. One memory
 * at a time: the biographer opens the conversation (streaming), asks/deepens like the dream-analysis pane,
 * then synthesizes a structured `StoryMemory` the person commits with one tap (→ the book + the coach).
 * PER-PERSON data — reset on the active-person change (wired into AppShell), like `conversationStore`.
 */
interface StoryMemoryState {
  /** The collection ("Memories you've shared") — populated by `loadMemories`, independent of the open chat. */
  memories: StoryMemoryView[];
  memoriesLoaded: boolean;

  // --- the open memory chat ---
  memoryId: string | null;
  /** True once `open`/`openNew` has finished loading — so the panel never races the initial open. */
  loaded: boolean;
  messages: ChatMessage[];
  /** Decrypted attachment data URLs, keyed by attachment id — avoids re-fetching a thumbnail (45 §5.5). */
  attachmentUrls: Record<string, string>;
  streaming: string;
  opening: boolean; // awaiting the biographer's opener (it speaks first, streaming)
  sending: boolean; // awaiting a chat turn
  synthesizing: boolean; // awaiting the synthesis into a structured draft
  saving: boolean; // committing the (edited) memory
  /** The biographer signalled it has enough to synthesize (sticky, from a turn or the durable `readyAt`). */
  ready: boolean;
  /** The memory record — `gathering` while chatting, `ready` once synthesized (the confirm-card draft),
   *  `saved` once committed. */
  memory: StoryMemory | null;
  error: string | null;

  /** Load the collection of shared memories (newest first). */
  loadMemories: () => Promise<void>;
  /** Delete a memory (record + transcript + attachments + its Insight — truly forgets); refreshes the list. */
  deleteMemory: (memoryId: string) => Promise<void>;

  /** Open (resume) an existing memory chat — the biographer's transcript + any synthesized draft. */
  open: (memoryId: string) => Promise<void>;
  /** Start a NEW memory chat — the biographer speaks first, optionally seeded from a gap focus or a photo. */
  openNew: (seedFocus?: string) => Promise<void>;
  /** Send one chat turn (with optional image attachments); the streamed reply arrives via `appendChunk`.
   *  Resolves `false` only when a total attachment-store failure aborted before sending (so the composer keeps
   *  the pending thumbnails to retry); `true` otherwise. */
  sendTurn: (text: string, attachments?: PendingAttachment[]) => Promise<boolean>;
  /** Ask the biographer to reply to an unanswered turn (never re-sends/duplicates the message) (66 §3.2). */
  retryTurn: () => Promise<void>;
  /** "Delete from here" — drop this message and everything after it (66 §3.3). */
  rewind: (index: number) => Promise<void>;
  /** "Retry from here" — truncate to this point, then re-generate the reply (66 §3.3). */
  regenerateFrom: (index: number) => Promise<void>;
  /** Synthesize the chat into the structured memory draft (the confirm card reads it). Metered. */
  synthesize: () => Promise<boolean>;
  /** Commit the (edited) synthesized memory — feeds the book + the coach. */
  save: (edits?: StoryMemoryEdits) => Promise<boolean>;
  /** Resolve + cache a stored attachment's data URL for a thumbnail. */
  loadAttachment: (ref: AttachmentRef) => Promise<void>;
  appendChunk: (delta: string) => void;
  /** Clear only the open-chat state (leaves the collection) — called when the panel closes. */
  close: () => void;
  reset: () => void;
}

const CHAT_EMPTY = {
  memoryId: null,
  loaded: false,
  messages: [] as ChatMessage[],
  attachmentUrls: {} as Record<string, string>,
  streaming: '',
  opening: false,
  sending: false,
  synthesizing: false,
  saving: false,
  ready: false,
  memory: null,
  error: null,
} satisfies Partial<StoryMemoryState>;

const EMPTY = {
  memories: [] as StoryMemoryView[],
  memoriesLoaded: false,
  ...CHAT_EMPTY,
} satisfies Partial<StoryMemoryState>;

// A monotonic token so a late-resolving open never clobbers a newer one (a "new" open has no id to guard by).
let openSeq = 0;

/** True once the memory carries a synthesized/committed state — so the panel can offer to save immediately. */
function readyFromMemory(memory: StoryMemory): boolean {
  return Boolean(memory.readyAt) || memory.status === 'ready' || memory.status === 'saved';
}

export const useStoryMemoryStore = create<StoryMemoryState>((set, get) => ({
  ...EMPTY,
  loadMemories: async () => {
    // Always settle `memoriesLoaded` — a rejected read (decrypt/transport) must degrade to the empty state,
    // never leave the collection blank forever behind its not-yet-loaded gate.
    try {
      const memories = (await window.selfos?.storyMemoryList()) ?? [];
      set({ memories, memoriesLoaded: true });
    } catch {
      set({ memories: [], memoriesLoaded: true });
    }
  },
  deleteMemory: async (memoryId) => {
    await window.selfos?.storyMemoryDelete({ memoryId });
    await get().loadMemories();
  },
  open: async (memoryId) => {
    const seq = ++openSeq;
    set({ ...CHAT_EMPTY, memoryId, opening: true });
    const detail = await window.selfos?.storyMemoryOpen({ memoryId });
    if (seq !== openSeq) return; // superseded by a newer open
    if (detail) {
      set({
        memoryId: detail.memory.id,
        memory: detail.memory,
        messages: detail.conversation?.messages ?? [],
        streaming: '',
        opening: false,
        loaded: true,
        ready: readyFromMemory(detail.memory),
      });
      await useBudgetStore.getState().refresh(); // the biographer's opener is metered
    } else {
      set({ opening: false, loaded: true, error: 'Couldn’t open that memory. Please try again.' });
    }
  },
  openNew: async (seedFocus) => {
    const seq = ++openSeq;
    set({ ...CHAT_EMPTY, opening: true });
    const detail = await window.selfos?.storyMemoryOpen(seedFocus ? { seedFocus } : {});
    if (seq !== openSeq) return;
    if (detail) {
      set({
        memoryId: detail.memory.id,
        memory: detail.memory,
        messages: detail.conversation?.messages ?? [],
        streaming: '',
        opening: false,
        loaded: true,
        ready: readyFromMemory(detail.memory),
      });
      await useBudgetStore.getState().refresh();
    } else {
      set({ opening: false, loaded: true, error: 'Couldn’t start a memory. Please try again.' });
    }
  },
  sendTurn: async (text, attachments = []) => {
    const trimmed = text.trim();
    const memoryId = get().memoryId;
    if ((!trimmed && attachments.length === 0) || !memoryId || get().sending) return true;
    // Store-on-send (45 §3.2/§11): encrypt each pending image, collecting the refs. A failed store surfaces a
    // calm error but never blocks the rest; the in-memory preview seeds the thumbnail cache so it renders now.
    const refs: AttachmentRef[] = [];
    const urls: Record<string, string> = {};
    let storeError: string | null = null;
    for (const pending of attachments) {
      const stored = await window.selfos?.storyMemoryStoreAttachment({
        memoryId,
        dataBase64: pending.base64,
        mime: pending.mime,
        width: pending.width,
        height: pending.height,
      });
      if (stored && !('ok' in stored)) {
        refs.push(stored);
        urls[stored.id] = pending.previewUrl;
      } else {
        storeError = stored && 'message' in stored ? stored.message : 'Couldn’t attach that image.';
      }
    }
    if (refs.length === 0 && !trimmed) {
      // Nothing stored and no text — abort so the composer keeps the pending thumbnails for a retry.
      set({ error: storeError ?? 'Couldn’t attach that image.' });
      return false;
    }
    set((state) => ({
      messages: [
        ...state.messages,
        {
          role: 'user',
          content: trimmed,
          ts: new Date().toISOString(),
          ...(refs.length > 0 ? { attachments: refs } : {}),
        },
      ],
      attachmentUrls: { ...state.attachmentUrls, ...urls },
      streaming: '',
      sending: true,
      error: storeError,
    }));
    const result = await window.selfos?.storyMemoryTurn({
      memoryId,
      text: trimmed,
      ...(refs.length > 0 ? { attachments: refs } : {}),
    });
    if (result?.ok) {
      set((s) => ({
        messages: result.conversation.messages,
        streaming: '',
        sending: false,
        error: null,
        ready: s.ready || Boolean(result.analysisReady),
      }));
      await useBudgetStore.getState().refresh();
    } else {
      set({ sending: false, streaming: '', error: result?.message ?? 'Something went wrong.' });
    }
    return true;
  },
  retryTurn: async () => {
    const memoryId = get().memoryId;
    if (!memoryId || get().sending) return;
    // Re-generates a reply for the transcript as it already stands — the person's message is never duplicated.
    set({ streaming: '', sending: true, error: null });
    const result = await window.selfos?.storyMemoryRetry({ memoryId });
    if (result?.ok) {
      set((s) => ({
        messages: result.conversation.messages,
        streaming: '',
        sending: false,
        ready: s.ready || Boolean(result.analysisReady),
      }));
      await useBudgetStore.getState().refresh();
    } else {
      set({ sending: false, streaming: '', error: result?.message ?? 'Something went wrong.' });
    }
  },
  rewind: async (index) => {
    const { memoryId, messages, sending } = get();
    const target = messages[index];
    if (!memoryId || sending || !target) return;
    const result = await window.selfos?.storyMemoryRewind({
      memoryId,
      index,
      expect: { role: target.role, ts: target.ts },
    });
    if (result?.ok) {
      set({ messages: result.conversation.messages, error: null });
    } else {
      set({
        error:
          result?.reason === 'STALE'
            ? 'This memory moved on — reopen it and try again.'
            : 'Couldn’t remove those messages.',
      });
    }
  },
  regenerateFrom: async (index) => {
    const { memoryId, messages, sending } = get();
    const target = messages[index];
    if (!memoryId || sending || !target) return;
    set({ streaming: '', sending: true, error: null });
    const result = await window.selfos?.storyMemoryRegenerate({
      memoryId,
      index,
      expect: { role: target.role, ts: target.ts },
    });
    if (result?.ok) {
      set((s) => ({
        messages: result.conversation.messages,
        streaming: '',
        sending: false,
        ready: s.ready || Boolean(result.analysisReady),
      }));
      await useBudgetStore.getState().refresh();
    } else {
      set({ sending: false, streaming: '', error: result?.message ?? 'Something went wrong.' });
    }
  },
  synthesize: async () => {
    const memoryId = get().memoryId;
    if (!memoryId || get().synthesizing) return false;
    set({ synthesizing: true, error: null });
    const result = await window.selfos?.storyMemorySynthesize({ memoryId });
    if (result?.ok) {
      set({ memory: result.memory, synthesizing: false, ready: true });
      await useBudgetStore.getState().refresh();
      return true;
    }
    set({
      synthesizing: false,
      error: result?.message ?? 'Your memory couldn’t be written. Please try again.',
    });
    return false;
  },
  save: async (edits) => {
    const memoryId = get().memoryId;
    if (!memoryId || get().saving) return false;
    set({ saving: true, error: null });
    const result = await window.selfos?.storyMemorySave({
      memoryId,
      ...(edits ? { edits } : {}),
    });
    if (result?.ok) {
      set({ memory: result.memory, saving: false });
      await useBudgetStore.getState().refresh();
      return true;
    }
    set({
      saving: false,
      error: result?.message ?? 'Your memory couldn’t be saved. Please try again.',
    });
    return false;
  },
  loadAttachment: async (ref) => {
    if (get().attachmentUrls[ref.id]) return;
    const memoryId = get().memoryId;
    if (!memoryId) return;
    const got = await window.selfos?.storyMemoryGetAttachment({
      memoryId,
      path: ref.path,
      mime: ref.mime,
    });
    if (got) {
      set((state) => ({
        attachmentUrls: {
          ...state.attachmentUrls,
          [ref.id]: `data:${got.mime};base64,${got.dataBase64}`,
        },
      }));
    }
  },
  appendChunk: (delta) => set((state) => ({ streaming: state.streaming + delta })),
  close: () => set({ ...CHAT_EMPTY }),
  reset: () => set({ ...EMPTY }),
}));

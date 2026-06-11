import { create } from 'zustand';
import type { Dream, DreamInput } from '@shared/channels';

interface DreamState {
  dreams: Dream[];
  loaded: boolean;
  load: () => Promise<void>;
  save: (input: DreamInput) => Promise<Dream | null>;
  remove: (id: string) => Promise<void>;
  /** Clear when the active person changes — dreams are per-person; stale state must not leak (04 §8). */
  reset: () => void;
}

/** The active person's dream journal (12-dreams §3/§5.3). CRUD flows through the bridge. */
export const useDreamStore = create<DreamState>((set, get) => ({
  dreams: [],
  loaded: false,
  load: async () => {
    const dreams = (await window.selfos?.dreamsList()) ?? [];
    set({ dreams, loaded: true });
  },
  save: async (input) => {
    const saved = (await window.selfos?.dreamSave(input)) ?? null;
    await get().load();
    return saved;
  },
  remove: async (id) => {
    await window.selfos?.dreamDelete(id);
    await get().load();
  },
  reset: () => set({ dreams: [], loaded: false }),
}));

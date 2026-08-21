import { create } from 'zustand';
import type { SayLinesView, StarredLine } from '@shared/schemas';

/**
 * 75 — "Say something to your partner", the Together → Desire surface.
 *
 * Per-person AND per-partner: reset on the `activePerson.id` change (AppShell), and every async result is
 * dropped unless the partner it was asked for is still the one loaded. That guard is not cosmetic here —
 * a stale response resolving after a partner switch would put lines written from ONE partner's marks on the
 * screen under another partner's name, which is the one thing this surface must never do.
 *
 * Lines are EPHEMERAL (§3.3): they live in this store and are gone when the person leaves the screen. Only
 * a line they star is persisted, and only in their own vault space. The bridge is the trust boundary —
 * `together.own` + a live partner edge + both 18+ acks, re-checked on every call.
 */
interface SayLinesStoreState {
  /** Whose view is loaded. Every async result checks this before it writes. */
  partnerId: string | null;
  view: SayLinesView | null;
  /** The batch(es) on screen this sitting. "Write more" APPENDS (§3.1) — a shown set is never discarded. */
  lines: string[];
  loaded: boolean;
  /** True while a generation is running; the surface shows realtime progress, never a bare spinner (§3.5). */
  busy: boolean;
  error: string | null;
  /** The line mid-star/unstar, so only that row's control goes busy. */
  pending: string | null;
  /**
   * What this sitting has cost. ADMIN-ONLY BY CONSTRUCTION: the bridge strips `costUsd` for anyone without
   * `budgets.manage` (the durable 06 rule — the $ boundary is the bridge, never the UI), so its presence is
   * the gate and the surface needs no second check to render it.
   */
  costUsd: number | null;
  load: (partnerId: string) => Promise<void>;
  generate: (input: { partnerId: string; brief: string }) => Promise<void>;
  star: (input: { partnerId: string; text: string; brief: string }) => Promise<void>;
  unstar: (input: { partnerId: string; id: string }) => Promise<void>;
  reset: () => void;
}

const EMPTY = {
  partnerId: null,
  view: null,
  lines: [],
  loaded: false,
  busy: false,
  error: null,
  pending: null,
  costUsd: null,
} satisfies Partial<SayLinesStoreState>;

/** What the model is told NOT to write again, so "write more" means more (74 §3.6.19). Kept lines count too
 *  — one you already have is not worth paying for twice. Oldest first: the engine shows the model the TAIL. */
const excludeFrom = (kept: StarredLine[], lines: string[]): string[] =>
  [...kept.map((k) => k.text), ...lines].slice(-60);

export const useSayLinesStore = create<SayLinesStoreState>((set, get) => ({
  ...EMPTY,

  load: async (partnerId) => {
    // Switching partner drops the previous partner's lines immediately, before the fetch resolves.
    if (get().partnerId !== partnerId) set({ ...EMPTY, partnerId });
    try {
      const view = (await window.selfos?.togetherSayLinesState({ partnerId })) ?? null;
      if (get().partnerId !== partnerId) return;
      set({ view, loaded: true, error: null });
    } catch {
      if (get().partnerId !== partnerId) return;
      set({ loaded: true, error: 'We couldn’t load this right now.' });
    }
  },

  generate: async ({ partnerId, brief }) => {
    if (get().partnerId !== partnerId) set({ ...EMPTY, partnerId });
    set({ busy: true, error: null });
    const before = get().lines;
    try {
      const result = await window.selfos?.togetherSayLines({
        partnerId,
        brief,
        exclude: excludeFrom(get().view?.kept ?? [], before),
      });
      if (get().partnerId !== partnerId) return;
      if (!result) {
        set({ busy: false, error: 'We couldn’t write anything right now. Try again.' });
        return;
      }
      const view = get().view;
      set({
        busy: false,
        // APPEND (§3.1): a batch already on screen is never silently replaced by the next one.
        lines: [...before, ...result.lines],
        /*
         * A FAILED generation must not touch the kept list. The kept list changes only through star/unstar
         * (§3.3); folding a failure's payload back into the view means any path that returns an empty one —
         * a refused gate does exactly that — silently empties the person's kept lines on screen while they
         * sit safe on disk, which is a screen that lies about their own saved content.
         */
        ...(result.ok && view ? { view: { ...view, kept: result.kept, lastBrief: brief } } : {}),
        // The honest split (74 §3.6.39): "the model wrote nothing" and "we filtered out everything it wrote"
        // reach the person as different sentences, and neither blames their partner's data.
        error: result.ok ? null : (result.message ?? 'Nothing came back. Try again.'),
        ...(result.costUsd !== undefined ? { costUsd: (get().costUsd ?? 0) + result.costUsd } : {}),
      });
    } catch {
      if (get().partnerId !== partnerId) return;
      set({ busy: false, error: 'We couldn’t write anything right now. Try again.' });
    }
  },

  star: async ({ partnerId, text, brief }) => {
    set({ pending: text, error: null });
    try {
      const kept = (await window.selfos?.togetherStarLine({ partnerId, text, brief })) ?? [];
      const view = get().view;
      if (get().partnerId !== partnerId) return;
      set({ pending: null, ...(view ? { view: { ...view, kept } } : {}) });
    } catch {
      if (get().partnerId !== partnerId) return;
      set({ pending: null, error: 'We couldn’t keep that. Try again.' });
    }
  },

  unstar: async ({ partnerId, id }) => {
    set({ pending: id, error: null });
    try {
      const kept = (await window.selfos?.togetherUnstarLine({ partnerId, id })) ?? [];
      const view = get().view;
      if (get().partnerId !== partnerId) return;
      set({ pending: null, ...(view ? { view: { ...view, kept } } : {}) });
    } catch {
      if (get().partnerId !== partnerId) return;
      set({ pending: null, error: 'We couldn’t remove that. Try again.' });
    }
  },

  reset: () => set({ ...EMPTY }),
}));

import { create } from 'zustand';
import type { AutoCheckinConfig, AutoCheckinTarget } from '@shared/schemas';
import { useBudgetStore } from './budgetStore';
import { useInboxStore } from './inboxStore';

/**
 * Auto check-ins config + run state (63-auto-checkins §5.2). Per-person — reset on the `activePerson.id`
 * change (AppShell). `load()` reads the config (no spend); `ensureSeed()` is the write-once onboarding seed
 * backfill; `setConfig()` persists a change (the bridge is the trust boundary — owner-only other-targets);
 * `run({auto})` runs the engine — `auto: true` is the renderer cadence (the bridge applies the 24h throttle),
 * a manual "Run now" (`auto:false`) forces it. A non-`ok` auto run is a silent no-op; a manual one surfaces a
 * calm note.
 */
interface AutoCheckinStoreState {
  config: AutoCheckinConfig | null;
  loaded: boolean;
  running: boolean;
  error: string | null;
  /** A calm note after a manual "Run now" (e.g. "Added 2 check-ins"). */
  lastRunNote: string | null;
  load: () => Promise<void>;
  ensureSeed: () => Promise<boolean>;
  setConfig: (patch: { enabled?: boolean; targets?: AutoCheckinTarget[] }) => Promise<void>;
  run: (opts?: { auto?: boolean }) => Promise<void>;
  reset: () => void;
}

const EMPTY = {
  config: null,
  loaded: false,
  running: false,
  error: null,
  lastRunNote: null,
} satisfies Partial<AutoCheckinStoreState>;

export const useAutoCheckinStore = create<AutoCheckinStoreState>((set) => ({
  ...EMPTY,
  load: async () => {
    const config = (await window.selfos?.autoCheckinsGetConfig()) ?? null;
    set({ config, loaded: true });
  },
  ensureSeed: async () => {
    const result = await window.selfos?.autoCheckinsEnsureSeed();
    if (result?.seeded) set({ config: result.config, loaded: true });
    return result?.seeded ?? false;
  },
  setConfig: async (patch) => {
    const config = (await window.selfos?.autoCheckinsSetConfig(patch)) ?? null;
    set({ config });
  },
  run: async (opts) => {
    set({ running: true, error: null, lastRunNote: null });
    const result = await window.selfos?.autoCheckinsRun(opts ?? {});
    if (result?.ok) {
      const n = result.created.length;
      set({
        running: false,
        lastRunNote: opts?.auto
          ? null
          : n > 0
            ? `Added ${n} new check-in${n === 1 ? '' : 's'} to your inbox.`
            : 'Nothing new right now — your queue is already topped up.',
      });
      // A run may have spent budget + added inbox items — refresh both so the ring + badge stay current.
      await useBudgetStore.getState().refresh();
      await useInboxStore.getState().load();
    } else {
      set({
        running: false,
        error: opts?.auto ? null : (result?.message ?? 'Couldn’t run auto check-ins right now.'),
      });
    }
  },
  reset: () => set({ ...EMPTY }),
}));

import { create } from 'zustand';
import type {
  AutoCheckinConfig,
  AutoCheckinTarget,
  IncomingAutoCheckinStream,
} from '@shared/schemas';
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
  /** Streams OTHER people have configured targeting the active person (§3.3a) — "Check-ins others send you". */
  incoming: IncomingAutoCheckinStream[];
  loaded: boolean;
  running: boolean;
  error: string | null;
  /** A calm note after a manual "Run now" (e.g. "Added 2 check-ins"). */
  lastRunNote: string | null;
  load: () => Promise<void>;
  ensureSeed: () => Promise<boolean>;
  setConfig: (patch: { enabled?: boolean; targets?: AutoCheckinTarget[] }) => Promise<void>;
  /** Turn a sender's check-ins to the active person on/off (§3.3a); refreshes the incoming list. */
  setBlock: (senderPersonId: string, blocked: boolean) => Promise<void>;
  run: (opts?: { auto?: boolean }) => Promise<void>;
  reset: () => void;
}

const EMPTY = {
  config: null,
  incoming: [],
  loaded: false,
  running: false,
  error: null,
  lastRunNote: null,
} satisfies Partial<AutoCheckinStoreState>;

export const useAutoCheckinStore = create<AutoCheckinStoreState>((set) => ({
  ...EMPTY,
  load: async () => {
    const [config, incoming] = await Promise.all([
      window.selfos?.autoCheckinsGetConfig() ?? null,
      window.selfos?.autoCheckinsIncomingStreams() ?? [],
    ]);
    set({ config, incoming, loaded: true });
  },
  setBlock: async (senderPersonId, blocked) => {
    await window.selfos?.autoCheckinsSetBlock({ senderPersonId, blocked });
    const incoming = (await window.selfos?.autoCheckinsIncomingStreams()) ?? [];
    set({ incoming });
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
      // §27.6 — a run that created nothing must read as deliberate, not broken, and must not MISREPORT the
      // reason. Since §27.5 removed the generic filler, "created nothing" has three distinct causes: genuinely
      // nothing new worth asking (`no-new-topic`), a real hiccup (the AI refused / errored / budget-capped, any
      // `gapfinder:*` / `generate:*` reason), or the queue simply already being full (no skips at all). Telling
      // someone "no new ground" when the AI actually failed is the dishonesty this section exists to prevent.
      const reasons = result.skipped.map((s) => s.reason);
      const noNewGround = reasons.includes('no-new-topic');
      const hadTrouble = reasons.some(
        (r) => r.startsWith('gapfinder:') || r.startsWith('generate:'),
      );
      set({
        running: false,
        lastRunNote: opts?.auto
          ? null
          : n > 0
            ? `Added ${n} new check-in${n === 1 ? '' : 's'} to your inbox.`
            : hadTrouble
              ? 'Couldn’t put a check-in together just now — try again in a bit.'
              : noNewGround
                ? 'No new ground to cover right now — nothing worth asking yet.'
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

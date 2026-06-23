import { create } from 'zustand';
import type { UpdateCheckResult } from '@shared/channels';

/**
 * App-global update-awareness state (36-update-awareness §5). Holds the latest update-check result, drives
 * both the Settings → About control AND the `update-available` notification candidate. Unlike the per-person
 * stores, this is NOT reset on a person switch — an update concerns the whole install (§11). A non-forced
 * check is throttled so focus/resume events can't hammer the unauthenticated GitHub rate limit; the manual
 * button forces a fresh check.
 */

/** Minimum gap between non-forced (automatic) checks — guards the unauthenticated GitHub rate limit. */
const MIN_AUTO_INTERVAL_MS = 30 * 60 * 1000;

interface UpdateStoreState {
  /** The latest known result (incl. "up to date"), or null if nothing has resolved yet. */
  result: UpdateCheckResult | null;
  status: 'idle' | 'checking';
  /** The last check couldn't be made (offline / rate-limited / timeout) → the calm "couldn't check" state. */
  errored: boolean;
  /** Epoch ms of the last check attempt (for the auto throttle). */
  lastAttemptAt: number | null;
  /** Run a check. `force` (the manual button) bypasses the throttle; auto checks are throttled + de-duped. */
  check: (force: boolean) => Promise<void>;
  /** Load the cached last-known result so the UI reflects a prior check before a fresh one resolves. */
  loadCached: () => Promise<void>;
}

export const useUpdateStore = create<UpdateStoreState>((set, get) => ({
  result: null,
  status: 'idle',
  errored: false,
  lastAttemptAt: null,
  check: async (force) => {
    const { status, lastAttemptAt } = get();
    if (status === 'checking') return; // a check is already in flight
    if (!force && lastAttemptAt !== null && Date.now() - lastAttemptAt < MIN_AUTO_INTERVAL_MS) {
      return; // throttled — a recent auto check already ran
    }
    set({ status: 'checking', errored: false, lastAttemptAt: Date.now() });
    try {
      const result = (await window.selfos?.updatesCheck(force)) ?? null;
      // A null result = couldn't check: keep the prior result but flag the error so About can say so.
      set({ status: 'idle', errored: result === null, result: result ?? get().result });
    } catch {
      set({ status: 'idle', errored: true });
    }
  },
  loadCached: async () => {
    const cached = (await window.selfos?.updatesGetState()) ?? null;
    if (cached) set({ result: cached });
  },
}));

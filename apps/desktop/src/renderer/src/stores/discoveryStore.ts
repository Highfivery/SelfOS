import { create } from 'zustand';

/** Stable keys for the one-time discovery hints (41 §4). */
export const DISCOVERY_KEYS = {
  orientation: 'orientation',
  tipGapFinder: 'tip.gapFinder',
  tipDepthInvitations: 'tip.depthInvitations',
} as const;

export type DiscoveryKey = (typeof DISCOVERY_KEYS)[keyof typeof DISCOVERY_KEYS];

/**
 * The first-run orientation + one-time feature tips dismissal state (41 §4) — device-local + per-person,
 * persisted through the discovery device-state channel (the 35-notification-system precedent), keyed by the
 * active person in the bridge (the trust boundary). A missing/invalid blob reads as "nothing dismissed", so
 * a corrupt state fails open to *showing* the harmless hint (§7). Reset + reloaded on a person switch by the
 * AppShell active-person effect (the per-person-isolation rule).
 */
interface DiscoveryState {
  dismissed: string[];
  loaded: boolean;
  load: () => Promise<void>;
  /** Dismiss a hint for good (idempotent); persists immediately. */
  dismiss: (key: string) => void;
  /** Whether a hint has been dismissed. Only meaningful once `loaded` — callers gate on `loaded` to avoid a flash. */
  isDismissed: (key: string) => boolean;
  reset: () => void;
}

export const useDiscoveryStore = create<DiscoveryState>((set, get) => ({
  dismissed: [],
  loaded: false,
  load: async () => {
    const dismissed = (await window.selfos?.getDiscoveryDismissals()) ?? [];
    set({ dismissed, loaded: true });
  },
  dismiss: (key) => {
    const { dismissed } = get();
    if (dismissed.includes(key)) return;
    const next = [...dismissed, key];
    set({ dismissed: next });
    void window.selfos?.setDiscoveryDismissals(next);
  },
  isDismissed: (key) => get().dismissed.includes(key),
  reset: () => set({ dismissed: [], loaded: false }),
}));

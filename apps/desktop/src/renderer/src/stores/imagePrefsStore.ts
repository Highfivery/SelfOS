import { useEffect } from 'react';
import { create } from 'zustand';
import type { ImageFeature, ImagePrefs } from '@shared/channels';

/**
 * The active person's per-feature image preferences (image-settings amendment): style, direction, and the
 * on/off toggle for Dreams and for Your Story, kept PER PERSON so one member's choice never overwrites
 * another's. Loaded once per active person; reset on a person switch (wired into the AppShell effect).
 */
interface ImagePrefsState {
  prefs: ImagePrefs | null;
  loaded: boolean;
  load: () => Promise<void>;
  setFeature: (
    feature: ImageFeature,
    patch: { enabled?: boolean; style?: string; styleNotes?: string },
  ) => Promise<void>;
  reset: () => void;
}

export const useImagePrefsStore = create<ImagePrefsState>((set, get) => ({
  prefs: null,
  loaded: false,
  load: async () => {
    const prefs = (await window.selfos?.imagesGetPrefs()) ?? null;
    set({ prefs, loaded: true });
  },
  setFeature: async (feature, patch) => {
    const prefs = (await window.selfos?.imagesSetPrefs({ feature, patch })) ?? get().prefs;
    set({ prefs });
  },
  reset: () => set({ prefs: null, loaded: false }),
}));

/** The active person's per-feature image-generation consent (loads the prefs if needed). */
export function useImageConsent(feature: ImageFeature): boolean {
  const prefs = useImagePrefsStore((s) => s.prefs);
  const loaded = useImagePrefsStore((s) => s.loaded);
  const load = useImagePrefsStore((s) => s.load);
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  return prefs?.[feature].enabled ?? false;
}

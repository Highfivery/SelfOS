import { create } from 'zustand';

interface NavState {
  /** Whether the desktop sidebar is collapsed to an icon rail. */
  collapsed: boolean;
  /** True once the persisted value has been read from main. */
  loaded: boolean;
  /** Hydrate the collapsed state from device-local storage. */
  load: () => Promise<void>;
  /** Flip collapsed/expanded and persist (device-local). */
  toggle: () => void;
  /** Set collapsed explicitly and persist (device-local). */
  setCollapsed: (collapsed: boolean) => void;
}

/**
 * Sidebar (nav) UI state. The collapsed flag is a device-local preference (02-app-shell §4) persisted
 * through the typed bridge — the renderer never touches storage directly.
 */
export const useNavStore = create<NavState>((set, get) => ({
  collapsed: false,
  loaded: false,
  load: async () => {
    const collapsed = (await window.selfos?.getSidebarCollapsed()) ?? false;
    set({ collapsed, loaded: true });
  },
  toggle: () => {
    get().setCollapsed(!get().collapsed);
  },
  setCollapsed: (collapsed) => {
    set({ collapsed });
    void window.selfos?.setSidebarCollapsed(collapsed);
  },
}));

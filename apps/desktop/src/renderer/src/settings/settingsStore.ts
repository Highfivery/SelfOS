import { create } from 'zustand';
import { getAllDefinitions, getDefaults, getDefinition } from './registry';

interface SettingsState {
  values: Record<string, unknown>;
  loaded: boolean;
  load: () => Promise<void>;
  set: (key: string, value: unknown) => Promise<void>;
  reset: (key: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  values: getDefaults(),
  loaded: false,

  load: async () => {
    const persisted = await window.selfos?.getSettings();
    const merged: Record<string, unknown> = getDefaults();
    if (persisted) {
      for (const def of getAllDefinitions()) {
        const raw = persisted[def.scope ?? 'vault'][def.key];
        if (raw === undefined) continue;
        const parsed = def.schema.safeParse(raw);
        merged[def.key] = parsed.success ? parsed.data : def.default;
      }
    }
    set({ values: merged, loaded: true });
  },

  /**
   * Optimistic, but it ROLLS BACK on a refused write. The bridge is the trust boundary and rejects a
   * write the caller isn't permitted to make (30 §5) — and every caller invokes this as `void set(...)`,
   * so without the catch the rejection was unhandled AND the control kept showing a value that was
   * never stored, silently reverting on the next load.
   */
  set: async (key, value) => {
    const def = getDefinition(key);
    if (!def) return;
    const parsed = def.schema.safeParse(value);
    if (!parsed.success) return;
    const previous = get().values[key];
    set({ values: { ...get().values, [key]: parsed.data } });
    try {
      await window.selfos?.setSetting({ key, value: parsed.data, scope: def.scope ?? 'vault' });
    } catch {
      set({ values: { ...get().values, [key]: previous } });
    }
  },

  reset: async (key) => {
    const def = getDefinition(key);
    if (!def) return;
    const previous = get().values[key];
    set({ values: { ...get().values, [key]: def.default } });
    try {
      await window.selfos?.resetSetting({ key, scope: def.scope ?? 'vault' });
    } catch {
      set({ values: { ...get().values, [key]: previous } });
    }
  },
}));

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

  set: async (key, value) => {
    const def = getDefinition(key);
    if (!def) return;
    const parsed = def.schema.safeParse(value);
    if (!parsed.success) return;
    set({ values: { ...get().values, [key]: parsed.data } });
    await window.selfos?.setSetting({ key, value: parsed.data, scope: def.scope ?? 'vault' });
  },

  reset: async (key) => {
    const def = getDefinition(key);
    if (!def) return;
    set({ values: { ...get().values, [key]: def.default } });
    await window.selfos?.resetSetting({ key, scope: def.scope ?? 'vault' });
  },
}));

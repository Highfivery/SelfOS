import { useSettingsStore } from './settingsStore';
import type { SettingKey, SettingValueOf } from './types';

/** Typed get/set for a single setting by key. */
export function useSetting<K extends SettingKey>(
  key: K,
): [SettingValueOf<K>, (value: SettingValueOf<K>) => void] {
  const value = useSettingsStore((s) => s.values[key]) as SettingValueOf<K>;
  const set = useSettingsStore((s) => s.set);
  return [value, (next) => void set(key, next)];
}

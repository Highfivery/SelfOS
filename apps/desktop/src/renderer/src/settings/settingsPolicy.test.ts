import { describe, expect, it } from 'vitest';
import {
  ADMIN_ONLY_SETTING_KEYS,
  isAdminOnlySettingKey,
  settingWriteNeedsAdmin,
} from '@shared/settingsPolicy';
import { registerBuiltinSettings } from './builtins';
import { getAllDefinitions } from './registry';

describe('settingsPolicy (26 — single source for admin-only settings)', () => {
  it("the registry's adminOnly flags exactly match the shared key list (no drift)", () => {
    registerBuiltinSettings();
    const flaggedInRegistry = getAllDefinitions()
      .filter((def) => def.adminOnly)
      .map((def) => def.key)
      .sort();
    expect(flaggedInRegistry).toEqual([...ADMIN_ONLY_SETTING_KEYS].sort());
  });

  it('vault writes always need admin; device writes only when admin-only', () => {
    expect(settingWriteNeedsAdmin('appearance.theme', 'vault')).toBe(true); // household-wide
    expect(settingWriteNeedsAdmin('appearance.theme', 'device')).toBe(false); // cosmetic, per-device
    expect(settingWriteNeedsAdmin('dreams.imageModel', 'device')).toBe(true); // admin-only regardless
    expect(isAdminOnlySettingKey('relay.connection')).toBe(true);
    expect(isAdminOnlySettingKey('sessions.memoryEnabled')).toBe(false);
  });
});

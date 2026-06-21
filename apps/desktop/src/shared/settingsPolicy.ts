/**
 * The single source of truth for which settings are **admin-only** (26-settings-trust-boundary). Imported
 * by BOTH the renderer registry (to hide the control from non-admins) AND the bridge (to reject the write),
 * so display and enforcement can never drift.
 *
 * A setting write is admin-gated (`settings.manage`) when it is **vault-scoped** (household-wide, synced)
 * OR its key is **admin-only** (even a device-scoped one, should one ever exist). Device-scoped, non-admin
 * settings (appearance, sidebar, …) are ungated — they're cosmetic, per-device, and never touch the vault.
 */
export const ADMIN_ONLY_SETTING_KEYS: readonly string[] = [
  'questionnaires.intimacyTopics',
  'dreams.imageModel',
  'dreams.imageApiKey',
  'relay.connection',
];

const adminOnlySet = new Set(ADMIN_ONLY_SETTING_KEYS);

/** Whether a setting key is admin-only regardless of scope. */
export function isAdminOnlySettingKey(key: string): boolean {
  return adminOnlySet.has(key);
}

/** Whether writing `key` at `scope` requires the `settings.manage` capability. */
export function settingWriteNeedsAdmin(key: string, scope: 'vault' | 'device'): boolean {
  return scope === 'vault' || isAdminOnlySettingKey(key);
}

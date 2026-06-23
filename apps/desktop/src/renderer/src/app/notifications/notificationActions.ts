import type { NavigateFunction } from 'react-router-dom';
import type { NotificationAction } from '@shared/channels';

/**
 * Perform a notification's action (35-notification-system §3.4): `navigate` follows an in-app route;
 * `external` opens a URL via the main-process shell (never the renderer directly); `reveal-vault` opens
 * the vault folder (the sync-conflict "Resolve" affordance). `undefined` = purely informational (no-op).
 */
export function runNotificationAction(
  action: NotificationAction | undefined,
  navigate: NavigateFunction,
): void {
  if (!action) return;
  if (action.type === 'navigate') navigate(action.to);
  else if (action.type === 'external') void window.selfos?.openExternal(action.url);
  else if (action.type === 'reveal-vault') void window.selfos?.revealVault();
}

/** The action button's label, by action type (omitted = no action button). */
export function actionLabel(action: NotificationAction | undefined): string | undefined {
  if (!action) return undefined;
  if (action.type === 'navigate') return 'View';
  if (action.type === 'external') return 'Open';
  return 'Resolve';
}

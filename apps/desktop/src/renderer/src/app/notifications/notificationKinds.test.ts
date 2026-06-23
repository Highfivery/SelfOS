import { describe, expect, it } from 'vitest';
import type { PersonNotificationState } from '@shared/channels';
import {
  NOTIFICATION_KIND_DEFS,
  notificationIcon,
  resolveNotifications,
  unreadCount,
  type NotificationCandidate,
} from './notificationKinds';

const NOW = '2026-06-23T12:00:00.000Z';
const EMPTY: PersonNotificationState = { read: {}, dismissed: {} };

const conflict = (count: number): NotificationCandidate => ({
  kind: 'sync-conflict',
  coalesceKey: 'sync-conflict',
  signature: String(count),
  title: 'Sync conflicts found',
  createdAt: '2026-06-23T11:00:00.000Z',
});

const freshness = (ids: string): NotificationCandidate => ({
  kind: 'profile-freshness',
  coalesceKey: 'profile-freshness',
  signature: ids,
  title: 'Profile updates to review',
  createdAt: '2026-06-23T11:30:00.000Z',
});

describe('notification registry', () => {
  it('declares an icon + default severity + a re-surface rule for every kind', () => {
    for (const kind of Object.keys(NOTIFICATION_KIND_DEFS) as Array<
      keyof typeof NOTIFICATION_KIND_DEFS
    >) {
      const def = NOTIFICATION_KIND_DEFS[kind];
      expect(notificationIcon(kind)).toBe(def.icon);
      expect(['info', 'success', 'warning']).toContain(def.severity);
      expect(typeof def.resurfaces).toBe('function');
    }
  });

  it('maps responses-arrived/update kinds to their expected severities', () => {
    expect(NOTIFICATION_KIND_DEFS['sync-conflict'].severity).toBe('warning');
    expect(NOTIFICATION_KIND_DEFS['update-available'].severity).toBe('warning');
    expect(NOTIFICATION_KIND_DEFS['responses-arrived'].severity).toBe('info');
    expect(NOTIFICATION_KIND_DEFS['profile-freshness'].severity).toBe('info');
  });
});

describe('resolveNotifications', () => {
  it('shows fresh candidates as unread, applying the kind default severity', () => {
    const out = resolveNotifications([conflict(2)], EMPTY, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]?.read).toBe(false);
    expect(out[0]?.severity).toBe('warning');
    expect(out[0]?.id).toBe('sync-conflict#2');
    expect(unreadCount(out)).toBe(1);
  });

  it('coalesces duplicate keys to a single item (last wins)', () => {
    const out = resolveNotifications([conflict(2), conflict(3)], EMPTY, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]?.signature).toBe('3');
  });

  it('orders newest first', () => {
    const out = resolveNotifications(
      [
        { ...conflict(1), createdAt: '2026-06-23T09:00:00.000Z' },
        { ...freshness('a'), createdAt: '2026-06-23T11:00:00.000Z' },
      ],
      EMPTY,
      NOW,
    );
    expect(out.map((n) => n.kind)).toEqual(['profile-freshness', 'sync-conflict']);
  });

  it('drops a dismissed item whose condition is unchanged', () => {
    const persisted: PersonNotificationState = { read: {}, dismissed: { 'sync-conflict': '2' } };
    expect(resolveNotifications([conflict(2)], persisted, NOW)).toHaveLength(0);
  });

  it('re-surfaces a dismissed sync-conflict only when the count increases', () => {
    const persisted: PersonNotificationState = { read: {}, dismissed: { 'sync-conflict': '2' } };
    // Fewer conflicts → stays dismissed (resolving some shouldn't re-pop it).
    expect(resolveNotifications([conflict(1)], persisted, NOW)).toHaveLength(0);
    // More conflicts → re-surfaces, unread again.
    const more = resolveNotifications([conflict(3)], persisted, NOW);
    expect(more).toHaveLength(1);
    expect(more[0]?.read).toBe(false);
  });

  it('keeps a read item visible but not counted toward unread', () => {
    const persisted: PersonNotificationState = { read: { 'sync-conflict': '2' }, dismissed: {} };
    const out = resolveNotifications([conflict(2)], persisted, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]?.read).toBe(true);
    expect(unreadCount(out)).toBe(0);
  });

  it('re-surfaces profile-freshness only on a brand-new suggestion, never on a shrinking set', () => {
    const persisted: PersonNotificationState = {
      read: {},
      dismissed: { 'profile-freshness': 'a,b' },
    };
    expect(resolveNotifications([freshness('a,b')], persisted, NOW)).toHaveLength(0); // same set
    // The set shrank (a suggestion was accepted/dismissed elsewhere) — stays dismissed, no re-nag.
    expect(resolveNotifications([freshness('a')], persisted, NOW)).toHaveLength(0);
    const out = resolveNotifications([freshness('a,b,c')], persisted, NOW); // a brand-new suggestion 'c'
    expect(out).toHaveLength(1);
    expect(out[0]?.read).toBe(false);
  });

  it('defaults createdAt to now when a candidate omits it', () => {
    const out = resolveNotifications(
      [{ kind: 'update-available', coalesceKey: 'update', signature: 'v1', title: 'Update' }],
      EMPTY,
      NOW,
    );
    expect(out[0]?.createdAt).toBe(NOW);
  });
});

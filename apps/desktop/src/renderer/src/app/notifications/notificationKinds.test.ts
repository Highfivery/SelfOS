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

describe('email-only candidates (08 §36.2)', () => {
  const invite: NotificationCandidate = {
    kind: 'together-invite',
    coalesceKey: 'together-invite:s1',
    signature: 's1',
    title: 'Angel invited you to a Together session',
    inApp: false,
  };

  it('never renders as a bell row, so the queue is the only place the work lives', () => {
    const out = resolveNotifications([invite, conflict(1)], EMPTY, NOW);
    expect(out.map((n) => n.kind)).toEqual(['sync-conflict']);
  });

  // That it still EMAILS by name — the reason `inApp` filters at resolve time instead of the source simply
  // not emitting — is asserted where it can actually fail, against the real hook, in
  // `email/useEmailTransactional.test.tsx`. Asserting it over a locally-built array here could never fail.

  it('leaves an ordinary candidate untouched when the flag is absent or true', () => {
    const shown = resolveNotifications([{ ...invite, inApp: true }], EMPTY, NOW);
    expect(shown).toHaveLength(1);
    const noFlag: NotificationCandidate = { ...invite };
    delete noFlag.inApp;
    expect(resolveNotifications([noFlag], EMPTY, NOW)).toHaveLength(1);
  });
});

describe('inbox-waiting re-surfacing (08 §36)', () => {
  const queue = (ids: string): NotificationCandidate => ({
    kind: 'inbox-waiting',
    coalesceKey: 'inbox-waiting',
    signature: ids,
    title: 'Things are waiting for you',
    createdAt: '2026-06-23T11:00:00.000Z',
  });

  it('a genuinely new arrival surfaces even when the COUNT is one you already read', () => {
    // The queue's rhythm: read at two, answer one, a new one arrives — back to two. Under a COUNT signature
    // ("2" vs "2") `onIncrease` calls that "not an increase" and stays silent on something never seen.
    const read: PersonNotificationState = { read: { 'inbox-waiting': 'a,b' }, dismissed: {} };
    expect(resolveNotifications([queue('a,c')], read, NOW)[0]?.read).toBe(false);
    // That the COUNT signature this replaced would swallow it is pinned at the hook, which is where the
    // signature is actually chosen (`useNotificationSources.test.tsx` asserts it is the id set).
  });

  it('working through the queue never re-pops it', () => {
    const dismissed: PersonNotificationState = { read: {}, dismissed: { 'inbox-waiting': 'a,b' } };
    // Answered one of the two → a strict subset → still covered, so no re-pop.
    expect(resolveNotifications([queue('a')], dismissed, NOW)).toHaveLength(0);
    // Unchanged → still covered.
    expect(resolveNotifications([queue('a,b')], dismissed, NOW)).toHaveLength(0);
  });
});

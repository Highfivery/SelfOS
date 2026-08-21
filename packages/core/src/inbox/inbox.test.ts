import { describe, expect, it, beforeEach } from 'vitest';

import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import {
  collectInbox,
  dismissInboxEntry,
  readInboxDismissals,
  registerInboxProvider,
  resetInboxProviders,
  type InboxEntry,
} from './index';

const key = generateMasterKey();
const now = new Date('2026-08-20T12:00:00.000Z');
const ctx = (fs = memFileSystem()) => ({ fs, key, personId: 'p1', now, readAt: {} });

const entry = (over: Partial<InboxEntry> & Pick<InboxEntry, 'id' | 'kind' | 'at'>): InboxEntry => ({
  title: 'Something',
  dismissible: false,
  waiting: true,
  ...over,
});

describe('the Inbox registry (08 §35)', () => {
  beforeEach(() => resetInboxProviders());

  it('merges every provider into one list, newest first', async () => {
    registerInboxProvider({
      kind: 'check-in',
      list: () =>
        Promise.resolve([
          entry({ id: 'check-in:a', kind: 'check-in', at: '2026-08-01T00:00:00.000Z' }),
        ]),
    });
    registerInboxProvider({
      kind: 'shared-book',
      list: () =>
        Promise.resolve([
          entry({ id: 'shared-book:b', kind: 'shared-book', at: '2026-08-10T00:00:00.000Z' }),
        ]),
    });
    const out = await collectInbox(ctx());
    expect(out.map((e) => e.id)).toEqual(['shared-book:b', 'check-in:a']);
  });

  it('a provider that throws costs its own kind and nothing else', async () => {
    // Four domains feed this queue. One unreadable book must never take down the check-in above it.
    registerInboxProvider({
      kind: 'shared-book',
      list: () => Promise.reject(new Error('unreadable')),
    });
    registerInboxProvider({
      kind: 'check-in',
      list: () =>
        Promise.resolve([
          entry({ id: 'check-in:a', kind: 'check-in', at: '2026-08-01T00:00:00.000Z' }),
        ]),
    });
    const out = await collectInbox(ctx());
    expect(out.map((e) => e.id)).toEqual(['check-in:a']);
  });

  it('a dismissed entry stays gone even while its provider still returns it', async () => {
    // The whole point: a contribution invitation is a standing grant that never stops being returned, so a
    // dismissal that only removed the row until the next read would be no dismissal at all.
    const fs = memFileSystem();
    registerInboxProvider({
      kind: 'contribution-invitation',
      list: () =>
        Promise.resolve([
          entry({
            id: 'contribution-invitation:i1',
            kind: 'contribution-invitation',
            at: '2026-08-01T00:00:00.000Z',
            dismissible: true,
          }),
        ]),
    });
    expect(await collectInbox(ctx(fs))).toHaveLength(1);

    await dismissInboxEntry(fs, key, 'p1', 'contribution-invitation:i1', now);
    const dismissals = await readInboxDismissals(fs, key, 'p1');
    expect(dismissals.ids).toEqual(['contribution-invitation:i1']);
    expect(await collectInbox(ctx(fs), dismissals.ids)).toEqual([]);

    // …and it is one person's decision about their own queue: another person's is untouched.
    expect((await readInboxDismissals(fs, key, 'p2')).ids).toEqual([]);
  });

  it('dismissing twice is the same as once', async () => {
    const fs = memFileSystem();
    const first = await dismissInboxEntry(fs, key, 'p1', 'shared-book:x', now);
    const second = await dismissInboxEntry(fs, key, 'p1', 'shared-book:x', new Date('2027-01-01'));
    expect(second.ids).toEqual(['shared-book:x']);
    expect(second.updatedAt).toBe(first.updatedAt); // no churn on a repeat tap
  });
});

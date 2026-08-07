import { describe, expect, it } from 'vitest';
import type { OutboundSharing, OutboundSharingItem, Relationship } from '@shared/schemas';
import {
  describeSharingScope,
  filterAndSortItems,
  groupByCategory,
  groupByPerson,
  resolveSharingTab,
  summarizeSharingStats,
  EMPTY_SHARING_FILTERS,
} from './sharingDashboard';

const rel = (from: string, to: string, type: Relationship['type']): Relationship => ({
  id: `${from}-${to}`,
  schemaVersion: 1,
  fromPersonId: from,
  toPersonId: to,
  type,
  createdAt: 'now',
  updatedAt: 'now',
});

const item = (over: Partial<OutboundSharingItem> & { id: string }): OutboundSharingItem => ({
  kind: 'fact',
  text: 't',
  broadcast: false,
  types: [],
  personIds: [],
  recipients: [],
  ...over,
});

describe('resolveSharingTab', () => {
  it('defaults to by-person; resolves a known segment; ignores unknown', () => {
    expect(resolveSharingTab(undefined)).toBe('by-person');
    expect(resolveSharingTab('')).toBe('by-person');
    expect(resolveSharingTab('by-category')).toBe('by-category');
    expect(resolveSharingTab('reflections/extra')).toBe('reflections');
    expect(resolveSharingTab('nope')).toBe('by-person');
  });
});

describe('describeSharingScope (68 §3.9)', () => {
  it('broadcast → Everyone; types → scope; recipients-only → Shared with names; else Private', () => {
    expect(describeSharingScope(item({ id: 'a', broadcast: true }))).toBe('Everyone you relate to');
    expect(describeSharingScope(item({ id: 'b', types: ['partner'] }))).toContain('Partner');
    // The wart fix: a per-person share (no types) reads "Shared with <name>", NEVER "Private".
    const perPerson = describeSharingScope(
      item({ id: 'c', recipients: [{ id: 'p2', displayName: 'Sam' }] }),
    );
    expect(perPerson).toBe('Shared with Sam');
    expect(perPerson).not.toMatch(/Private/);
    expect(describeSharingScope(item({ id: 'd' }))).toBe('Private');
  });
});

describe('summarizeSharingStats (68 §3.1)', () => {
  it('totals items, tallies people reached, resolves by-type from the graph, carries kept-private', () => {
    const outbound: OutboundSharing = {
      items: [
        item({ id: 'f1', types: ['partner'], recipients: [{ id: 'p2', displayName: 'Sam' }] }),
        item({
          id: 'f2',
          kind: 'profileField',
          recipients: [
            { id: 'p2', displayName: 'Sam' },
            { id: 'p3', displayName: 'Mom' },
          ],
        }),
        item({ id: 'f3', types: ['sibling'], recipients: [{ id: 'p3', displayName: 'Mom' }] }),
      ],
      keptPrivateCount: 5,
    };
    const relationships = [rel('me', 'p2', 'partner'), rel('me', 'p3', 'sibling')];
    const stats = summarizeSharingStats(outbound, 'me', relationships);
    expect(stats.total).toBe(3);
    expect(stats.keptPrivateCount).toBe(5);
    // Sam reached by 2 items, Mom by 2.
    expect(stats.peopleReached.find((p) => p.id === 'p2')?.count).toBe(2);
    expect(stats.peopleReached.find((p) => p.id === 'p3')?.count).toBe(2);
    // By-type resolves each item's reach from the graph: partner reached by f1 + f2 (Sam), sibling by f2 + f3.
    const byType = new Map(stats.byType.map((t) => [t.type, t.count]));
    expect(byType.get('partner')).toBe(2);
    expect(byType.get('sibling')).toBe(2);
  });
});

describe('groupByPerson / groupByCategory', () => {
  it('groups by recipient (an item under each) and by display-bucket category', () => {
    const items = [
      item({
        id: 'f1',
        lifeArea: 'Values & beliefs',
        recipients: [
          { id: 'p2', displayName: 'Sam' },
          { id: 'p3', displayName: 'Mom' },
        ],
      }),
      item({
        id: 'a1',
        kind: 'intakeAnswer',
        category: 'health',
        recipients: [{ id: 'p2', displayName: 'Sam' }],
      }),
    ];
    const byPerson = groupByPerson(items);
    expect(byPerson.find((g) => g.id === 'p2')?.items).toHaveLength(2);
    expect(byPerson.find((g) => g.id === 'p3')?.items).toHaveLength(1);

    const byCategory = groupByCategory(items);
    expect(byCategory.map((g) => g.category).sort()).toEqual(['Health & body', 'Values & beliefs']);
  });
});

describe('filterAndSortItems (68 §3.3)', () => {
  const items = [
    item({
      id: 'a',
      text: 'zebra',
      types: ['partner'],
      recipients: [{ id: 'p2', displayName: 'Sam' }],
    }),
    item({
      id: 'b',
      text: 'apple',
      kind: 'dreamImage',
      recipients: [{ id: 'p3', displayName: 'Mom' }],
    }),
  ];

  it('filters by search, kind, type, recipient', () => {
    expect(
      filterAndSortItems(items, { ...EMPTY_SHARING_FILTERS, search: 'app' }, 'recent'),
    ).toHaveLength(1);
    expect(
      filterAndSortItems(items, { ...EMPTY_SHARING_FILTERS, kind: 'dreamImage' }, 'recent')[0]?.id,
    ).toBe('b');
    expect(
      filterAndSortItems(items, { ...EMPTY_SHARING_FILTERS, type: 'partner' }, 'recent')[0]?.id,
    ).toBe('a');
    expect(
      filterAndSortItems(items, { ...EMPTY_SHARING_FILTERS, recipientId: 'p3' }, 'recent')[0]?.id,
    ).toBe('b');
  });

  it('sorts A–Z by text', () => {
    const sorted = filterAndSortItems(items, EMPTY_SHARING_FILTERS, 'text');
    expect(sorted.map((i) => i.id)).toEqual(['b', 'a']); // apple < zebra
  });
});

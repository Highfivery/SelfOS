import type {
  OutboundSharing,
  OutboundSharingItem,
  Relationship,
  RelationshipType,
} from '@shared/schemas';
import {
  describeScope,
  INVERSE_RELATIONSHIP_TYPE as INVERSE,
  RELATIONSHIP_TYPE_LABELS,
  sharingItemCategory,
} from '@selfos/core/sharing';

// --- Tabs (the 68 §3.2 four-tab IA; the Together/Story splat pattern) ---

export const SHARING_TABS = ['by-person', 'by-category', 'everything', 'reflections'] as const;
export type SharingTab = (typeof SHARING_TABS)[number];

export const SHARING_TAB_LABEL: Record<SharingTab, string> = {
  'by-person': 'By person',
  'by-category': 'By category',
  everything: 'Everything',
  reflections: 'Reflections',
};

export function isSharingTab(value: string): value is SharingTab {
  return (SHARING_TABS as readonly string[]).includes(value);
}

/**
 * Resolve the active tab from the `sharing/*` splat segment; an unknown/empty segment falls back to
 * **By person** (the default), so a stale deep-link never shows an empty tab (68 §3.2).
 */
export function resolveSharingTab(segment: string | undefined): SharingTab {
  const first = segment?.split('/')[0] ?? '';
  return isSharingTab(first) ? first : 'by-person';
}

// --- Scope label (the 68 §3.9 wart fix) ---

/**
 * Describe an item's sharing scope for the recipient line + scope chip (68 §3.9). Fixes the old
 * `describeScope([])` → "Private" lie for a per-person share: broadcast → "Everyone you relate to";
 * type-scoped → `describeScope(types)`; else recipients present (the `shareableWith` path — dream facts +
 * images) → "Shared with <names>"; else "Private". Pure + total.
 */
export function describeSharingScope(item: OutboundSharingItem): string {
  if (item.broadcast) return 'Everyone you relate to';
  if (item.types.length > 0) return describeScope(item.types);
  if (item.recipients.length > 0)
    return `Shared with ${item.recipients.map((r) => r.displayName).join(', ')}`;
  return 'Private';
}

// --- Stats (68 §3.1) ---

export interface SharingStats {
  /** Total outbound items. */
  total: number;
  /** Items reaching each relationship type (a type-scoped item counts once per type; profile/dream/broadcast
   * items count toward every type their recipients relate by), sorted most-shared first. */
  byType: { type: RelationshipType; label: string; count: number }[];
  /** Distinct related people currently receiving anything, with a per-person item count, most-reached first. */
  peopleReached: { id: string; name: string; count: number }[];
  /** Sensitive/`restricted` facts that are NEVER shared — a reassurance count only. */
  keptPrivateCount: number;
}

/** recipientId → the relationship type(s) FROM the active person TO that recipient (subject→viewer). */
function recipientTypeMap(
  personId: string | null,
  relationships: Relationship[],
): Map<string, Set<RelationshipType>> {
  const map = new Map<string, Set<RelationshipType>>();
  if (!personId) return map;
  const add = (id: string, type: RelationshipType): void => {
    const set = map.get(id) ?? new Set<RelationshipType>();
    set.add(type);
    map.set(id, set);
  };
  for (const edge of relationships) {
    if (edge.fromPersonId === personId) add(edge.toPersonId, edge.type);
    else if (edge.toPersonId === personId) add(edge.fromPersonId, INVERSE[edge.type]);
  }
  return map;
}

/**
 * Derive the whole stats header (68 §3.1) from the loaded outbound view + the live graph. Deterministic, no
 * AI. `byType` resolves each item's reach to relationship types via its recipients (so profile fields + dream
 * images — which have no type scope — still contribute), counting each type once per item.
 */
export function summarizeSharingStats(
  outbound: OutboundSharing,
  personId: string | null,
  relationships: Relationship[],
): SharingStats {
  const byRecipientType = recipientTypeMap(personId, relationships);
  const typeCounts = new Map<RelationshipType, number>();
  const people = new Map<string, { name: string; count: number }>();

  for (const item of outbound.items) {
    const itemTypes = new Set<RelationshipType>();
    for (const recipient of item.recipients) {
      const existing = people.get(recipient.id);
      people.set(recipient.id, {
        name: recipient.displayName,
        count: (existing?.count ?? 0) + 1,
      });
      for (const type of byRecipientType.get(recipient.id) ?? []) itemTypes.add(type);
    }
    for (const type of itemTypes) typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }

  return {
    total: outbound.items.length,
    byType: [...typeCounts.entries()]
      .map(([type, count]) => ({ type, label: RELATIONSHIP_TYPE_LABELS[type], count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    peopleReached: [...people.entries()]
      .map(([id, { name, count }]) => ({ id, name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    keptPrivateCount: outbound.keptPrivateCount,
  };
}

// --- Grouping (68 §3.4 / §3.5) ---

export interface PersonGroup {
  id: string;
  name: string;
  items: OutboundSharingItem[];
}

/**
 * Group items by RECIPIENT (68 §3.4): an item scoped to a type with two partners appears under BOTH. Groups
 * are ordered by size (most-shared-with first). An item reaching no one is omitted from By person (it has no
 * recipient group) — it still appears in Everything / By category.
 */
export function groupByPerson(items: OutboundSharingItem[]): PersonGroup[] {
  const groups = new Map<string, PersonGroup>();
  for (const item of items) {
    for (const recipient of item.recipients) {
      const group = groups.get(recipient.id) ?? {
        id: recipient.id,
        name: recipient.displayName,
        items: [],
      };
      group.items.push(item);
      groups.set(recipient.id, group);
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name),
  );
}

export interface CategoryGroup {
  category: string;
  items: OutboundSharingItem[];
}

/** Group items by their single display-bucket category (68 §3.5), ordered by size. */
export function groupByCategory(items: OutboundSharingItem[]): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>();
  for (const item of items) {
    const category = sharingItemCategory(item);
    const group = groups.get(category) ?? { category, items: [] };
    group.items.push(item);
    groups.set(category, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.items.length - a.items.length || a.category.localeCompare(b.category),
  );
}

/** The relationship types (subject→viewer) reached by a group's items — the "reaches: …" header line. */
export function groupReachTypes(
  items: OutboundSharingItem[],
  personId: string | null,
  relationships: Relationship[],
): RelationshipType[] {
  const byRecipientType = recipientTypeMap(personId, relationships);
  const types = new Set<RelationshipType>();
  for (const item of items) {
    for (const recipient of item.recipients) {
      for (const type of byRecipientType.get(recipient.id) ?? []) types.add(type);
    }
  }
  return [...types];
}

// --- Filter + sort (68 §3.3) ---

export type SharingKindFilter = 'all' | OutboundSharingItem['kind'];
export type SharingSort = 'recent' | 'recipient' | 'text';

export interface SharingFilters {
  search: string;
  type: RelationshipType | 'all';
  recipientId: string | 'all';
  category: string | 'all';
  kind: SharingKindFilter;
}

export const EMPTY_SHARING_FILTERS: SharingFilters = {
  search: '',
  type: 'all',
  recipientId: 'all',
  category: 'all',
  kind: 'all',
};

/**
 * Apply the filter/sort bar (68 §3.3). Every field is already on the loaded items — no new read. `recent`
 * sort keeps the loaded order (the read is newest-first for facts; a stable best-available order for the
 * others), so there's no new per-scope-change stamp (§11 Q6).
 */
export function filterAndSortItems(
  items: OutboundSharingItem[],
  filters: SharingFilters,
  sort: SharingSort,
): OutboundSharingItem[] {
  const search = filters.search.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (search && !item.text.toLowerCase().includes(search)) return false;
    if (filters.type !== 'all' && !item.types.includes(filters.type)) return false;
    if (filters.recipientId !== 'all' && !item.recipients.some((r) => r.id === filters.recipientId))
      return false;
    if (filters.category !== 'all' && sharingItemCategory(item) !== filters.category) return false;
    if (filters.kind !== 'all' && item.kind !== filters.kind) return false;
    return true;
  });

  const withIndex = filtered.map((item, index) => ({ item, index }));
  const sorted = withIndex.sort((a, b) => {
    if (sort === 'text') return a.item.text.localeCompare(b.item.text);
    if (sort === 'recipient') {
      const an = a.item.recipients[0]?.displayName ?? '￿';
      const bn = b.item.recipients[0]?.displayName ?? '￿';
      return an.localeCompare(bn) || a.index - b.index;
    }
    // recent — the loaded order (newest-first for facts; a stable best-available order for the rest).
    return a.index - b.index;
  });
  return sorted.map((entry) => entry.item);
}

/** The distinct display-bucket categories present in a set of items (for the filter's category `<Select>`). */
export function presentCategories(items: OutboundSharingItem[]): string[] {
  const set = new Set(items.map((item) => sharingItemCategory(item)));
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** The distinct recipients present (for the filter's recipient `<Select>`), by name. */
export function presentRecipients(items: OutboundSharingItem[]): { id: string; name: string }[] {
  const map = new Map<string, string>();
  for (const item of items) for (const r of item.recipients) map.set(r.id, r.displayName);
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

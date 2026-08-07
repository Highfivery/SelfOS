import { Search } from 'lucide-react';
import type { OutboundSharingItem, RelationshipType } from '@shared/schemas';
import { RELATIONSHIP_TYPE_LABELS } from '@selfos/core/sharing';
import { Select } from '../../../design-system/components';
import {
  presentCategories,
  presentRecipients,
  type SharingFilters,
  type SharingKindFilter,
  type SharingSort,
} from './sharingDashboard';
import styles from './SharingDashboard.module.css';

const KIND_LABEL: Record<OutboundSharingItem['kind'], string> = {
  fact: 'Memory',
  intakeAnswer: 'Onboarding answer',
  profileField: 'Profile',
  dreamImage: 'Dream image',
};

interface SharingFilterBarProps {
  items: OutboundSharingItem[];
  availableTypes: RelationshipType[] | undefined;
  filters: SharingFilters;
  onFilters: (next: SharingFilters) => void;
  sort: SharingSort;
  onSort: (next: SharingSort) => void;
}

/**
 * The filter / sort / search bar (68 §3.3) — a full-width search input + full-width `Select`s (never a
 * wrapping chip row, §12), so nothing scrolls-x at phone width. Every option is derived from the loaded
 * items — no new read.
 */
export function SharingFilterBar({
  items,
  availableTypes,
  filters,
  onFilters,
  sort,
  onSort,
}: SharingFilterBarProps): JSX.Element {
  const types = availableTypes ?? [];
  const recipients = presentRecipients(items);
  const categories = presentCategories(items);
  const kinds = [...new Set(items.map((i) => i.kind))];

  return (
    <div className={styles.toolbar}>
      <label className={styles.search}>
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          value={filters.search}
          placeholder="Search what you share…"
          aria-label="Search what you share"
          onChange={(e) => onFilters({ ...filters, search: e.target.value })}
        />
      </label>

      <Select
        aria-label="Filter by relationship type"
        value={filters.type}
        onChange={(e) =>
          onFilters({ ...filters, type: e.target.value as RelationshipType | 'all' })
        }
      >
        <option value="all">All types</option>
        {types.map((type) => (
          <option key={type} value={type}>
            {RELATIONSHIP_TYPE_LABELS[type]}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by recipient"
        value={filters.recipientId}
        onChange={(e) => onFilters({ ...filters, recipientId: e.target.value })}
      >
        <option value="all">Everyone</option>
        {recipients.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by category"
        value={filters.category}
        onChange={(e) => onFilters({ ...filters, category: e.target.value })}
      >
        <option value="all">All categories</option>
        {categories.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by kind"
        value={filters.kind}
        onChange={(e) => onFilters({ ...filters, kind: e.target.value as SharingKindFilter })}
      >
        <option value="all">All kinds</option>
        {kinds.map((kind) => (
          <option key={kind} value={kind}>
            {KIND_LABEL[kind]}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Sort items"
        value={sort}
        onChange={(e) => onSort(e.target.value as SharingSort)}
      >
        <option value="recent">Recently updated</option>
        <option value="recipient">By recipient</option>
        <option value="text">A–Z</option>
      </Select>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { TogetherCatalogEntry } from '@shared/schemas';
import { Heading, Stack, Text, TextInput } from '../../../design-system/components';
import styles from './Together.module.css';

/**
 * The Together guided catalog (58 §3.10): couples guided sessions grouped by their non-clinical group title,
 * with a search filter. Picking a card binds it to the start form above. The 18+ group is withheld host-side
 * (never returned by `together:catalog` in Phase E), so nothing adult can appear here.
 */
export function TogetherCatalog({
  catalog,
  selectedId,
  onPick,
}: {
  catalog: TogetherCatalogEntry[];
  selectedId: string | null;
  onPick: (entry: TogetherCatalogEntry) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? catalog.filter(
          (e) =>
            e.title.toLowerCase().includes(q) ||
            e.framework.toLowerCase().includes(q) ||
            e.blurb.toLowerCase().includes(q),
        )
      : catalog;
    const byGroup = new Map<string, { title: string; entries: TogetherCatalogEntry[] }>();
    for (const e of filtered) {
      const g = byGroup.get(e.group) ?? { title: e.groupTitle, entries: [] };
      g.entries.push(e);
      byGroup.set(e.group, g);
    }
    return [...byGroup.values()];
  }, [catalog, query]);

  return (
    <Stack gap={2}>
      <Heading level={2}>Guided sessions</Heading>
      <Text size="sm" tone="secondary">
        Structured practices for the two of you — pick one to start it together.
      </Text>
      <label className={styles.searchField}>
        <Search size={15} aria-hidden="true" />
        <TextInput
          aria-label="Search guided sessions"
          placeholder="Search practices…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {groups.length === 0 ? (
        <Text tone="secondary">No practices match “{query}”.</Text>
      ) : (
        groups.map((group) => (
          <Stack key={group.title} gap={1}>
            <Text size="xs" tone="secondary" weight={600} className={styles.catalogGroupTitle}>
              {group.title}
            </Text>
            <div className={styles.catalogGrid}>
              {group.entries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={styles.catalogCard}
                  aria-pressed={selectedId === entry.id}
                  data-selected={selectedId === entry.id}
                  onClick={() => onPick(entry)}
                >
                  <span className={styles.catalogEyebrow}>
                    {entry.framework}
                    {entry.kind === 'structured' ? ' · Steps' : ''}
                  </span>
                  <span className={styles.catalogCardTitle}>{entry.title}</span>
                  <span className={styles.catalogBlurb}>{entry.blurb}</span>
                </button>
              ))}
            </div>
          </Stack>
        ))
      )}
    </Stack>
  );
}

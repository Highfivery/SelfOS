import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { TogetherCatalogEntry } from '@shared/schemas';
import { Heading, Stack, Text, TextInput } from '../../../design-system/components';
import { PracticeCard } from './PracticeCard';
import styles from './Together.module.css';

/**
 * The full-width guided practices (58 §3.10): couples guided sessions grouped by their non-clinical group
 * title, with a search filter. Each card fills the row and shows its FULL blurb (never clamped, §166) so it's
 * clear what the practice is. Picking a card raises it to the start bar above (a deliberate send). The 18+
 * `together-desire` group is withheld host-side + surfaced separately in the Desire & intimacy panel.
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
      <Stack gap={1}>
        <Heading level={2}>Start a guided practice</Heading>
        <Text size="sm" tone="secondary">
          Structured practices for the two of you — pick one to start it together.
        </Text>
      </Stack>
      <label className={styles.searchField}>
        <Search size={15} aria-hidden="true" />
        <TextInput
          aria-label="Search guided sessions"
          placeholder="Search practices"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {groups.length === 0 ? (
        <Text tone="secondary">No practices match “{query}”.</Text>
      ) : (
        groups.map((group) => (
          <Stack key={group.title} gap={1}>
            <Text size="xs" tone="secondary" weight={600} className={styles.practiceGroupTitle}>
              {group.title}
            </Text>
            <div className={styles.practiceGrid}>
              {group.entries.map((entry) => (
                <PracticeCard
                  key={entry.id}
                  entry={entry}
                  selected={selectedId === entry.id}
                  onPick={onPick}
                />
              ))}
            </div>
          </Stack>
        ))
      )}
    </Stack>
  );
}

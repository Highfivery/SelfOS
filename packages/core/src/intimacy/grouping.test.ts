import { describe, expect, it } from 'vitest';
import { matrixRowKey } from '../schemas';
import { groupMatrixRowsByCategory, matrixGroupsForRows, resolvedActivityMatrix } from './grouping';
import { resolveIntakeActivityRows } from './activityRows';
import { INTIMACY_CATEGORIES, INTIMACY_CATEGORY_LABELS } from './topics';

const PENIS = 'Cock (penis)';
const VULVA = 'Pussy (vulva)';

describe('groupMatrixRowsByCategory (49 §5)', () => {
  it('groups the neutral activity matrix into category groups, in INTIMACY_CATEGORIES order', () => {
    const groups = groupMatrixRowsByCategory(resolveIntakeActivityRows());
    const labels = groups.map((g) => g.label);
    // Group order follows INTIMACY_CATEGORIES (only non-empty categories appear; every category has entries).
    expect(labels).toEqual(INTIMACY_CATEGORIES.map((c) => INTIMACY_CATEGORY_LABELS[c]));
    expect(labels[0]).toBe('Sensual & sensory');
    expect(labels[labels.length - 1]).toBe('Taboo fantasy');
  });

  it('every resolved row lands in exactly one group; concatenating groups = the row list in order', () => {
    const rows = resolveIntakeActivityRows();
    const groups = groupMatrixRowsByCategory(rows);
    const fromGroups = groups.flatMap((g) => g.rows);
    expect(fromGroups).toEqual(rows);
    // No row appears twice.
    const keys = fromGroups.map(matrixRowKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('the anatomy-resolved oral rows fall under the Oral group; dynamics under Power exchange', () => {
    const rows = resolveIntakeActivityRows({ ownAnatomy: PENIS, partnerAnatomy: [PENIS, VULVA] });
    const groups = groupMatrixRowsByCategory(rows);
    const oral = groups.find((g) => g.category === 'oral');
    const oralKeys = oral?.rows.map(matrixRowKey) ?? [];
    expect(oralKeys).toEqual(
      expect.arrayContaining(['oral-receiving', 'oral-giving-penis', 'oral-giving-vulva']),
    );
    const power = groups.find((g) => g.category === 'power-exchange');
    expect(power?.rows.map(matrixRowKey)).toEqual(
      expect.arrayContaining(['degradation-humiliation', 'praise-worship']),
    );
  });

  it('an owner-custom (uncategorized) row falls into a trailing "Other / custom" group', () => {
    const rows = [...resolveIntakeActivityRows(), { key: 'a-custom-act', label: 'A custom act' }];
    const groups = groupMatrixRowsByCategory(rows);
    const last = groups[groups.length - 1];
    expect(last?.category).toBe('other');
    expect(last?.label).toBe('Other / custom');
    expect(last?.rows.map(matrixRowKey)).toEqual(['a-custom-act']);
  });

  it('omits empty categories', () => {
    const groups = groupMatrixRowsByCategory([{ key: 'fingering', label: 'Fingering' }]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.category).toBe('manual-toys');
  });
});

describe('matrixGroupsForRows + resolvedActivityMatrix (49 §5)', () => {
  it('matrixGroupsForRows is the lean {label, rowKeys} transport, covering every row exactly once', () => {
    const rows = resolveIntakeActivityRows({ ownAnatomy: VULVA, partnerAnatomy: [PENIS] });
    const groups = matrixGroupsForRows(rows);
    const groupedKeys = groups.flatMap((g) => g.rowKeys);
    expect(groupedKeys.sort()).toEqual(rows.map(matrixRowKey).sort());
    for (const g of groups) expect(g.label.length).toBeGreaterThan(0);
  });

  it('resolvedActivityMatrix returns rows + groups that stay in sync', () => {
    const { rows, groups } = resolvedActivityMatrix({ ownAnatomy: PENIS, partnerAnatomy: [VULVA] });
    const rowKeys = new Set(rows.map(matrixRowKey));
    const groupKeys = groups.flatMap((g) => g.rowKeys);
    // Every group key is a real row, and every row is grouped.
    for (const k of groupKeys) expect(rowKeys.has(k), k).toBe(true);
    expect(new Set(groupKeys)).toEqual(rowKeys);
  });
});

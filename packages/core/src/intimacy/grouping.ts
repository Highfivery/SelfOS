/**
 * Pure helpers to **group resolved intimacy matrix rows by category** (49-intimacy-activities-inventory §5)
 * for the onboarding matrix's grouped display + the kink-test subscales ([`50`](50-self-assessments.md)).
 *
 * The renderer ([`@selfos/answering`]) stays free of the inventory's internals — it just renders the groups
 * it's handed (a `{ label, rowKeys }[]` carried additively on `Question.matrix.groups`). Questionnaire
 * matrices pass no groups → they render byte-identically as a single flat list (49 §11.1). This module is
 * the single place that turns the inventory's `key → category` map into display groups, so the relay/web/iOS
 * answering surfaces reuse the same grouping.
 */

import { type MatrixRow, matrixRowKey } from '../schemas';
import { type ActivityRowContext, resolveIntakeActivityRows } from './activityRows';
import {
  INTIMACY_CATEGORIES,
  INTIMACY_CATEGORY_LABELS,
  INTIMACY_OTHER_CATEGORY_LABEL,
  type IntimacyCategory,
  categoryForKey,
} from './topics';

/** A display group of matrix rows: a category (or the trailing custom `'other'`) + its rows, in row order. */
export interface MatrixRowGroup {
  category: IntimacyCategory | 'other';
  label: string;
  rows: MatrixRow[];
}

/**
 * Group resolved matrix rows by their inventory category, in {@link INTIMACY_CATEGORIES} order, with a
 * trailing **Other / custom** group for any uncategorized (owner-custom) row (49 §7). Within a group, the
 * incoming row order is preserved (already tier-ordered by {@link resolveIntakeActivityRows}). Empty groups
 * are omitted. The anatomy-resolved oral rows all fall under `oral` (their keys start `oral-`).
 */
export function groupMatrixRowsByCategory(rows: MatrixRow[]): MatrixRowGroup[] {
  const buckets = new Map<IntimacyCategory | 'other', MatrixRow[]>();
  for (const row of rows) {
    const category = categoryForKey(matrixRowKey(row)) ?? 'other';
    const bucket = buckets.get(category) ?? [];
    bucket.push(row);
    buckets.set(category, bucket);
  }
  const out: MatrixRowGroup[] = [];
  for (const category of INTIMACY_CATEGORIES) {
    const groupRows = buckets.get(category);
    if (groupRows && groupRows.length > 0) {
      out.push({ category, label: INTIMACY_CATEGORY_LABELS[category], rows: groupRows });
    }
  }
  const other = buckets.get('other');
  if (other && other.length > 0) {
    out.push({ category: 'other', label: INTIMACY_OTHER_CATEGORY_LABEL, rows: other });
  }
  return out;
}

/** The lean schema form — `{ label, rowKeys }[]` — the renderer transports on `Question.matrix.groups` and
 * renders as category headers above row groups (49 §5). */
export function matrixGroupsForRows(rows: MatrixRow[]): { label: string; rowKeys: string[] }[] {
  return groupMatrixRowsByCategory(rows).map((group) => ({
    label: group.label,
    rowKeys: group.rows.map(matrixRowKey),
  }));
}

/** Resolve the intake activity matrix's `rows` + their display `groups` together for the given person — the
 * single place the catalog/renderer/synthesis build the grouped activity matrix (keeps rows + groups in sync). */
export function resolvedActivityMatrix(ctx: ActivityRowContext = {}): {
  rows: MatrixRow[];
  groups: { label: string; rowKeys: string[] }[];
} {
  const rows = resolveIntakeActivityRows(ctx);
  return { rows, groups: matrixGroupsForRows(rows) };
}

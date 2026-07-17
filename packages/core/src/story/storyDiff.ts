/**
 * A pure, dependency-free word-level diff for the "What changed" ribbon (§13.5). Given the prior chapter text
 * and the current text, it returns a flat token list — each token is unchanged, added, or removed — so the
 * renderer can highlight what a rewrite altered without any AI. Kept in core (crypto-free) so it's unit-testable
 * and shared. Whitespace between words is folded into the following token so re-joining reproduces readable text.
 */

export type DiffOp = 'same' | 'added' | 'removed';

export interface DiffToken {
  op: DiffOp;
  /** The word plus its leading whitespace, so `tokens.map(t => t.text).join('')` reads naturally. */
  text: string;
}

/** Split into words while keeping each word's leading whitespace attached (so joins stay readable). */
function tokenize(text: string): string[] {
  // Match a run of whitespace (optional) followed by a run of non-whitespace — i.e. a word with its lead space.
  return text.match(/\s*\S+/g) ?? [];
}

/**
 * A classic longest-common-subsequence word diff. Returns the tokens in reading order: shared words as `same`,
 * words only in the new text as `added`, words only in the old text as `removed`. Identical inputs yield all
 * `same`; an empty prior yields all `added`. Bounded — operates on words, not characters.
 */
export function wordDiff(previous: string, current: string): DiffToken[] {
  const a = tokenize(previous);
  const b = tokenize(current);
  const n = a.length;
  const m = b.length;
  // Compare the WORD only (ignore surrounding whitespace) so a pure reflow isn't reported as a change; the
  // emitted `text` still carries the real whitespace for readable rendering.
  const eq = (x: string, y: string): boolean => x.trim() === y.trim();

  // LCS length table (rolling would save memory, but we need the table to backtrack the actual alignment).
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = eq(a[i]!, b[j]!)
        ? lcs[i + 1]![j + 1]! + 1
        : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i]!, b[j]!)) {
      out.push({ op: 'same', text: b[j]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ op: 'removed', text: a[i]! });
      i++;
    } else {
      out.push({ op: 'added', text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ op: 'removed', text: a[i++]! });
  while (j < m) out.push({ op: 'added', text: b[j++]! });
  return out;
}

/** True when there is any real change between the two texts (ignores pure whitespace differences). */
export function hasChanges(previous: string, current: string): boolean {
  return wordDiff(previous, current).some((t) => t.op !== 'same');
}

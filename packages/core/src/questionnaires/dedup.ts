/**
 * Deterministic near-duplicate detection for generated questions (08-questionnaires §23.5). The soft "avoid
 * overlap" prompt instruction is not enough — a household recipient's ALREADY-ASKED prompts (from their prior
 * questionnaires) must be hard-filtered so generation stops re-asking them. This is a pure, no-AI, no-I/O text
 * comparison over prompts that already crossed into the generation path host-side, so it adds no trust-boundary
 * surface. The semantic pass (§23.5 layer 3) catches meaning-level dups this fuzzy layer misses.
 */

/** Normalize a prompt for comparison: lowercase, strip punctuation, collapse whitespace. */
export function normalizePrompt(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Common filler words carry no topic signal — dropping them keeps the token-overlap focused on the subject so
// "what is your favorite food" and "what's a food you love" aren't kept apart by their scaffolding words.
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'do',
  'does',
  'did',
  'you',
  'your',
  'yours',
  'i',
  'me',
  'my',
  'we',
  'our',
  'they',
  'them',
  'their',
  'to',
  'of',
  'in',
  'on',
  'for',
  'with',
  'about',
  'what',
  'whats',
  'how',
  'when',
  'where',
  'why',
  'who',
  'which',
  'that',
  'this',
  'and',
  'or',
  'but',
  'as',
  'at',
  'by',
  'be',
  'been',
  'it',
  'its',
  'would',
  'could',
  'should',
  'can',
  'will',
  'have',
  'has',
  'had',
  'if',
  'so',
  'up',
  'out',
  'more',
  'most',
  'any',
  'some',
  'feel',
  'think',
  'like',
]);

/** The content-word token set of a prompt (stop-words removed). */
export function tokenSet(s: string): Set<string> {
  return new Set(
    normalizePrompt(s)
      .split(' ')
      .filter((w) => w.length > 0 && !STOP_WORDS.has(w)),
  );
}

/** Jaccard similarity of two token sets (0..1). Two empty sets are treated as dissimilar (0). */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/**
 * Whether `candidate` is a near-duplicate of any prompt in `existing`. True when normalized-equal, OR one's
 * content tokens are a subset of the other's (a paraphrase that only adds words), OR Jaccard ≥ `threshold`.
 * Default 0.6 catches real repeats without dropping genuinely-different questions that share a couple of words.
 * Deliberately CONSERVATIVE (§23.13): the meaning-only paraphrases are the semantic pass's job, not this layer.
 */
export function isNearDuplicate(
  candidate: string,
  existing: readonly string[],
  threshold = 0.6,
): boolean {
  const candNorm = normalizePrompt(candidate);
  if (candNorm === '') return false;
  const candTokens = tokenSet(candidate);
  for (const other of existing) {
    if (normalizePrompt(other) === candNorm) return true;
    const otherTokens = tokenSet(other);
    // Subset containment: "your favorite food" ⊂ "a food you would call your favorite" → a re-ask. But require
    // the smaller set to carry ≥ 2 content words — a SINGLE shared topic word ("family") is not a duplicate
    // ("What's your family like?" vs "What activities does your family enjoy?"); let it fall through to Jaccard.
    const smaller = candTokens.size <= otherTokens.size ? candTokens : otherTokens;
    const larger = smaller === candTokens ? otherTokens : candTokens;
    if (smaller.size >= 2) {
      let contained = true;
      for (const t of smaller)
        if (!larger.has(t)) {
          contained = false;
          break;
        }
      if (contained) return true;
    }
    if (jaccard(candTokens, otherTokens) >= threshold) return true;
  }
  return false;
}

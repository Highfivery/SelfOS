import {
  COUNT_BY_PROACTIVITY,
  type PersonRecommendationState,
  type Recommendation,
  type RecommendationProvider,
} from './schemas';

export interface RankOptions {
  /** Device-local per-person dismissal signatures (`rec:<id>`) within the quiet window (§4 / §5.2 step 5). */
  dismissed?: Set<string>;
}

/**
 * The pure ranking engine (53 §5.2). Synchronous, no AI, no I/O, deterministic + stable for the same state.
 * Pipeline: filter (capability + 18+) → gather → crisis de-escalation → proactivity gate → apply dismissals
 * → rank by score → variety-dedup → take top N. Returns the "For you" cards; `[]` means the section won't
 * render. The renderer feeds `state` it already assembled from its stores.
 */
export function rankRecommendations(
  providers: RecommendationProvider[],
  state: PersonRecommendationState,
  opts: RankOptions = {},
): Recommendation[] {
  // 4 (early): proactivity off ⇒ no "For you" section at all; a brand-new person sees getting-started, not
  // pushes; a distress moment leads with support, not nudges. All three suppress the whole section (§3.7/§7/§8).
  if (state.proactivity === 'off' || state.isNew || state.crisis) return [];

  const dismissed = opts.dismissed ?? new Set<string>();

  // 1: filter gated/18+ providers BEFORE relevance — a gated action is never even a candidate (no dead CTA,
  // no premature 18+ exposure, §3.2).
  const eligible = providers.filter((p) => {
    if (p.capabilityGate && !state.capabilities.has(p.capabilityGate)) return false;
    if (p.adultGate && !state.adultAcknowledged) return false;
    return true;
  });

  // 2: gather non-null candidates; 5: drop dismissed (by the SIGNAL-aware dismissKey, defaulting to the
  // provider id) — so a dismissal re-surfaces only when its underlying signal changes (§7), never forever.
  const candidates: Recommendation[] = [];
  for (const p of eligible) {
    const c = p.relevance(state);
    if (!c) continue;
    const dismissKey = c.dismissKey ?? c.id;
    if (dismissed.has(`rec:${dismissKey}`)) continue;
    candidates.push({ ...c, domain: p.domain, dismissKey });
  }

  // 6: rank by score (desc), tie-break by id for stability.
  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  // 4 (cap): how many to show, by proactivity level.
  const cap = COUNT_BY_PROACTIVITY[state.proactivity];
  if (cap <= 0) return [];

  // 6 (variety-dedup): choose a varied TOP SET — take the highest-scoring candidate per domain first, then
  // backfill by score if we still have room. Keeps the top N from being N of one domain (§3.4). Display
  // order then follows score (so variety affects which make the cut, not their ranking).
  const seenDomains = new Set<string>();
  const primary: Recommendation[] = [];
  const leftovers: Recommendation[] = [];
  for (const c of candidates) {
    if (!seenDomains.has(c.domain) && primary.length < cap) {
      seenDomains.add(c.domain);
      primary.push(c);
    } else {
      leftovers.push(c);
    }
  }
  const chosen = [...primary, ...leftovers].slice(0, cap);
  chosen.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return chosen;
}

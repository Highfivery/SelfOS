import type { RelationshipType } from '../schemas';

/**
 * The relationship-type scope a newly-produced, non-restricted insight fact is shared with by default.
 *
 * Owner decision (2026-07-17, emphatic — "ALL"): every insight SelfOS produces defaults to
 * **shared-with-partner**, so a partner's coaching can draw on what SelfOS learns about the person.
 * Applies to session / dream / questionnaire / Together / challenge / self-assessment insights (the
 * self-assessment producer already did this — `tests/testService.ts` — this generalizes it).
 *
 * Two things are deliberately NOT flipped by this default, because they are **explicit** choices rather
 * than an unset default:
 *   1. Break-glass `restricted` facts (onboarding trauma/intimacy opt-outs + crisis-adjacent content) —
 *      `factSharedWithViewer` structurally blocks `restricted` from any type-scoped share, and they
 *      represent a private choice the person already made.
 *   2. Explicit per-send visibility (compatibility `contextOnly`, §16.2) and onboarding answer scopes —
 *      those are chosen by the sender/person, not a default, so they are preserved.
 */
export const DEFAULT_INSIGHT_SHARE_TYPES: readonly RelationshipType[] = ['partner'] as const;

/**
 * The sharing fields to stamp on a freshly-produced insight fact. A non-restricted fact defaults to
 * partner-shared; a restricted fact carries the private break-glass flag and no type scope.
 *
 * Spread into a fact literal in place of a bare `shareable: false` (+ any `restricted` conditional):
 *   `facts.push({ id, text, ...producedFactShare(restricted), ...(carried ? { shareableWith } : {}) })`
 *
 * A fact that also needs `lifeArea` (e.g. a restricted intimacy fact) keeps setting it separately —
 * this helper owns only `shareable` / `restricted` / `shareableTypes`.
 *
 * `priorShareableTypes` — when re-analyzing a session/dream/challenge/Together insight (same id), the
 * user's EXPLICIT prior scope (including an empty `[]` they set to un-share) is passed here and OVERRIDES
 * the partner default, so a re-run never silently reverts a fact the person made private (or broadened)
 * back to partner-shared. A restricted fact ignores it (break-glass never carries a type scope).
 */
export function producedFactShare(
  restricted?: boolean,
  priorShareableTypes?: RelationshipType[],
): {
  shareable: false;
  restricted?: true;
  shareableTypes?: RelationshipType[];
} {
  if (restricted === true) return { shareable: false, restricted: true };
  return {
    shareable: false,
    shareableTypes: priorShareableTypes ?? [...DEFAULT_INSIGHT_SHARE_TYPES],
  };
}

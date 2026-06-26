import type { MomentumInput, MomentumReflection } from './schemas';

/**
 * Momentum is a gentle REFLECTION of what positively happened (53 §3.3/§8), never a metric or target. Pure.
 *
 * It surfaces ONE warm line, by priority: showing up → breadth → goals moving forward; a quiet week degrades
 * to `{}` (just the greeting). By construction it can NEVER express a gap, a streak, a miss, or an overdue
 * count — `MomentumInput`/`MomentumReflection` only carry positive counts, so the type itself forbids a
 * "you missed N days" line (the hard constraint, enforced here + by tests).
 */
export function computeMomentum(input: MomentumInput): MomentumReflection {
  const showedUp = Math.max(0, Math.trunc(input.showedUpThisWeek));
  const areas = Math.max(0, Math.trunc(input.areasExplored));
  const goalsMoving = Math.max(0, Math.trunc(input.goalsMovingForward));

  // "Showing up" — a rolling-window count of sessions/dreams/check-ins. ≥2 reads as a warm reflection
  // ("you've shown up 3 times this week"); 0–1 is too thin to celebrate as showing-up.
  if (showedUp >= 2) {
    return {
      line: `you’ve shown up ${showedUp} times this week`,
      showedUp,
      areas,
      goalsMoving,
    };
  }

  // "Breadth" — distinct life-areas the person has engaged. A growth reflection, not a completion target.
  if (areas >= 2) {
    return {
      line: `you’ve explored ${areas} areas of yourself so far`,
      showedUp,
      areas,
      goalsMoving,
    };
  }

  // "Progress on commitments" — open goals moving forward. Never "1 goal overdue".
  if (goalsMoving >= 1) {
    return {
      line:
        goalsMoving === 1
          ? 'you’ve got a goal moving forward'
          : `you’ve got ${goalsMoving} goals moving forward`,
      showedUp,
      areas,
      goalsMoving,
    };
  }

  // Quiet week — no line at all (just the greeting). Never a scold, never a gap count.
  return {};
}

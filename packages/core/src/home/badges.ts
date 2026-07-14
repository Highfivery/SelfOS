/**
 * 60 §3.1.7 (Slice 2) — milestone badges. Full-engagement motivation: crossing a meaningful threshold earns a
 * one-time badge celebrated warmly on Home. Pure + state-based (a milestone is "earned" from current counts,
 * not a stored event). The renderer maps each earned badge into the existing celebration flow (a `Completion`
 * keyed `badge:<id>`), so it celebrates exactly ONCE (the device-local `celebrate:` signature) and is never
 * revocable or shaming (§8). Crisis suppression is the caller's (celebration is gated by `showEncouragement`).
 */

export interface MilestoneBadge {
  /** Stable id — drives the once-only celebration signature `celebrate:badge:<id>`. */
  id: string;
  title: string;
  body: string;
}

export interface MilestoneInput {
  /** Current rhythm-streak length (days). */
  streakDays: number;
  /** Sessions the person has had. */
  sessionCount: number;
  /** Distinct life-areas engaged. */
  areasExplored: number;
  /** Challenges completed (52). */
  challengesDone: number;
}

/**
 * Every milestone the person currently MEETS (highest-tier first). The renderer celebrates each once; a badge
 * already celebrated is skipped by the celebration layer, so this stays a pure "what's earned now" function.
 */
export function activeMilestones(input: MilestoneInput): MilestoneBadge[] {
  const earned: MilestoneBadge[] = [];

  if (input.streakDays >= 7) {
    earned.push({
      id: 'rhythm-week',
      title: 'A week of showing up',
      body: 'Seven days of rhythm — that consistency is the real work.',
    });
  }
  if (input.sessionCount >= 10) {
    earned.push({
      id: 'ten-sessions',
      title: '10 sessions in',
      body: 'You’ve worked through ten sessions. That’s a real body of reflection.',
    });
  }
  if (input.areasExplored >= 5) {
    earned.push({
      id: 'five-areas',
      title: 'Five areas explored',
      body: 'You’ve looked at five different parts of your life. Nice range.',
    });
  }
  if (input.challengesDone >= 1) {
    earned.push({
      id: 'first-challenge',
      title: 'You finished a challenge',
      body: 'You took something on and saw it through — that took courage.',
    });
  }

  return earned;
}

import type { LifeRing, LifeRingKey, LifeRingsInput } from './schemas';

export const LIFE_RING_LABELS: Record<LifeRingKey, string> = {
  wellbeing: 'Wellbeing',
  connection: 'Connection',
  reflection: 'Reflection',
  growth: 'Growth',
};

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * The headline word for a ring's fill — a positive-leaning band vocabulary (never a failing/negative word,
 * §8). "Quiet" is the gentlest bottom band, not "Empty"/"Dormant".
 */
function levelFor(value: number): string {
  if (value < 0.2) return 'Quiet';
  if (value < 0.4) return 'Warming';
  if (value < 0.6) return 'Steady';
  if (value < 0.8) return 'Active';
  return 'Thriving';
}

/**
 * Derive the whole-life "life-rings" glance (60 §3.1.6) — a few 0..1 fills over signals the renderer
 * pre-computed from already-loaded stores. Each ring appears **only when it has a contributing signal**
 * (so a person with no relationships sees no Connection ring, etc. — never a false zero). Pure.
 *
 * Framed as "a reflection, not a score to chase": the caller shows both the `levelLabel` word and the `pct`
 * (the owner's choice), but during a **crisis** signal every ring is `softened` — the caller then shows only
 * the supportive `levelLabel`, no number/bar (§8, the safety guardrail, enforced here so it's testable).
 */
export function computeLifeRings(input: LifeRingsInput): LifeRing[] {
  const s = input.signals;
  const softened = input.crisis === true;
  const rings: LifeRing[] = [];

  const push = (key: LifeRingKey, value: number): void => {
    const v = clamp01(value);
    rings.push({
      key,
      label: LIFE_RING_LABELS[key],
      value: v,
      pct: Math.round(v * 100),
      levelLabel: levelFor(v),
      softened,
    });
  };

  // Wellbeing — recent mood valence (−1..1 → 0..1), lightly boosted by deliberate check-ins. Present only
  // when there IS mood data (a person who's never checked in / had a session sees no wellbeing ring).
  if (s.moodValenceMean !== undefined) {
    const mood = (s.moodValenceMean + 1) / 2;
    const confidence = Math.min(s.checkInCount ?? 0, 3) / 3;
    push('wellbeing', mood * 0.8 + confidence * 0.2);
  }

  // Connection — active partner edges + recent Together activity. Present only when the person has any
  // relationships at all (else connection isn't a meaningful glance for them).
  if (s.hasRelationships === true) {
    const partners = Math.min(s.activePartners ?? 0, 2) / 2;
    const events = Math.min(s.togetherEventsRecent ?? 0, 6) / 6;
    push('connection', partners * 0.5 + events * 0.5);
  }

  // Reflection — sessions + dreams in the recent window. Present only once there's been some reflection.
  const reflectionCount = (s.sessionsRecent ?? 0) + (s.dreamsRecent ?? 0);
  if (reflectionCount > 0) {
    push('reflection', Math.min(reflectionCount, 8) / 8);
  }

  // Growth — distinct life-areas engaged + goals moving. Present only once there's growth signal.
  const areas = s.areasExplored ?? 0;
  const goals = s.goalsMoving ?? 0;
  if (areas > 0 || goals > 0) {
    push('growth', (Math.min(areas, 6) / 6) * 0.6 + (Math.min(goals, 3) / 3) * 0.4);
  }

  return rings;
}

export const SPACE_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16] as const;
export type SpaceStep = (typeof SPACE_STEPS)[number];

/** Reference a spacing token by step (e.g. `space(4)` → `var(--space-4)`). */
export function space(step: SpaceStep): string {
  return `var(--space-${step})`;
}

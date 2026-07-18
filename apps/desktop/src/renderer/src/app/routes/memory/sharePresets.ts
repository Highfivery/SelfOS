import type { InsightFact, RelationshipType } from '@shared/schemas';
import { CLOSE_FAMILY, RELATIONSHIP_TYPE_ORDER } from '@selfos/core/sharing';

/**
 * The four sharing presets the Memory read-view chip cycles (65 §3.4): who a per-fact insight can inform.
 * A custom per-type scope (set via the full picker in Edit mode) reads as 'custom' and can't be cycled to.
 */
export type SharePreset = 'private' | 'partner' | 'family' | 'everyone';

/** The tap-cycle order for the read-view chip. */
export const SHARE_PRESET_ORDER: SharePreset[] = ['private', 'partner', 'family', 'everyone'];

/** The human label for a preset. */
export function sharePresetLabel(preset: SharePreset): string {
  return preset === 'private'
    ? 'Just me'
    : preset === 'partner'
      ? 'Partner'
      : preset === 'family'
        ? 'Close family'
        : 'Everyone';
}

const uniq = (types: RelationshipType[]): RelationshipType[] => [...new Set(types)];

function intersect(a: RelationshipType[], b: readonly RelationshipType[]): RelationshipType[] {
  const set = new Set(b);
  return a.filter((x) => set.has(x));
}

/**
 * The relationship types a preset emits, resolved against the person's graph (`available`; falls back to the
 * full type order). Reuses the core `CLOSE_FAMILY` set so it stays in lockstep with the intake sharing presets.
 */
export function typesForPreset(
  preset: SharePreset,
  available?: RelationshipType[],
): RelationshipType[] {
  const all = available && available.length > 0 ? available : [...RELATIONSHIP_TYPE_ORDER];
  switch (preset) {
    case 'private':
      return [];
    case 'partner':
      return ['partner'];
    case 'family':
      return uniq(intersect(['partner', ...CLOSE_FAMILY], all));
    case 'everyone':
      return [...all];
  }
}

function sameSet(a: readonly RelationshipType[], b: readonly RelationshipType[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((x) => set.has(x));
}

/**
 * Which preset the fact's current sharing corresponds to, or 'custom' when it matches none (a per-type scope
 * set via the full picker). A legacy broadcast (`shareable: true`) reads as "Everyone" (65 §3.4).
 */
export function currentSharePreset(
  fact: Pick<InsightFact, 'shareable' | 'shareableTypes'>,
  available?: RelationshipType[],
): SharePreset | 'custom' {
  if (fact.shareable) return 'everyone';
  const types = fact.shareableTypes ?? [];
  for (const preset of SHARE_PRESET_ORDER) {
    if (sameSet(types, typesForPreset(preset, available))) return preset;
  }
  return 'custom';
}

/** The next preset in the tap cycle; a 'custom' scope restarts the cycle at 'private'. */
export function nextSharePreset(current: SharePreset | 'custom'): SharePreset {
  if (current === 'custom') return 'private';
  const i = SHARE_PRESET_ORDER.indexOf(current);
  return SHARE_PRESET_ORDER[(i + 1) % SHARE_PRESET_ORDER.length] ?? 'private';
}

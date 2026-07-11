import type { FileSystem } from '../host';
import {
  matrixRowKey,
  matrixRowLabel,
  YnmOptInSchema,
  type TogetherYnmOverlap,
  type YnmOptIn,
} from '../schemas';
import type { IntakeSession } from '../schemas';
import { getIntakeSession } from '../intake/intakeService';
import { resolveIntakeActivityRows } from '../intimacy/activityRows';
import { readEncryptedJson, writeEncryptedJson } from '../vault';
import { pairKeyFor } from './togetherService';

// ── Yes/No/Maybe — together (58 §3.10b) — a deterministic, host-side mutual overlap (NO AI) ─────────
// A consented exception to "restricted reaches no one" (§8.6): the underlying inventory is restricted intake
// material, so revealing even the mutual subset requires a SYMMETRIC opt-in (each partner consents; both or
// neither sees anything), is REVOCABLE (revoke → the overlap immediately returns not-ready + drops from every
// grounding/prompt), and is additionally gated on both 18+ acks + the live edge — all enforced in the bridge.
// Items where BOTH partners are at/above "curious" (the 5-point activities matrix, value ≥ 3) form the mutual
// list; ONE-SIDED answers are never revealed.

/** The 1-5 activities scale: 1 Hard no · 2 Not interested · 3 Curious · 4 Like it · 5 Love it (§3.10b). */
const CURIOUS_OR_ABOVE = 3;

function ynmDir(personId: string): string {
  return `people/${personId}/together/ynm`;
}
function ynmPath(personId: string, pairKey: string): string {
  return `${ynmDir(personId)}/${pairKey}.enc`;
}
function isSafeSegment(s: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(s);
}
function isSafePairKey(pairKey: string): boolean {
  const parts = pairKey.split('~');
  return parts.length === 2 && parts.every(isSafeSegment);
}

/** Whether `personId` has opted this pair in (§3.10b). */
export async function getYnmOptIn(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  pairKey: string,
): Promise<boolean> {
  if (!isSafeSegment(personId) || !isSafePairKey(pairKey)) return false;
  try {
    const raw = await readEncryptedJson(fs, ynmPath(personId, pairKey), key);
    return raw ? YnmOptInSchema.safeParse(raw).success : false;
  } catch {
    return false;
  }
}

/** Set or clear `personId`'s opt-in for a pair (revoke deletes the record). */
export async function setYnmOptIn(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  partnerPersonId: string,
  optedIn: boolean,
  now: Date,
): Promise<void> {
  const pairKey = pairKeyFor(personId, partnerPersonId);
  if (!isSafeSegment(personId) || !isSafePairKey(pairKey)) return;
  if (optedIn) {
    const record: YnmOptIn = {
      schemaVersion: 1,
      personId,
      pairKey,
      optedInAt: now.toISOString(),
    };
    await writeEncryptedJson(fs, ynmPath(personId, pairKey), record, key);
  } else {
    await fs.remove(ynmPath(personId, pairKey));
  }
}

/** A person's intimacy activity ratings from their intake (the `activities` matrix), keyed by stable rowKey. */
async function readActivityRatings(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<Record<string, number>> {
  let session: IntakeSession | null = null;
  try {
    session = await getIntakeSession(fs, key, personId);
  } catch {
    return {}; // a corrupt/absent intake contributes no ratings (never blocks the overlap read)
  }
  const intimacy = session?.sections.find((s) => s.id === 'intimacy');
  const answer = intimacy?.answers['activities'];
  if (answer && typeof answer === 'object' && !Array.isArray(answer)) {
    // A matrix answer is Record<rowKey, number>; keep only numeric entries.
    const out: Record<string, number> = {};
    for (const [rowKey, value] of Object.entries(answer as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) out[rowKey] = value;
    }
    return out;
  }
  return {};
}

/** Stable rowKey → display label, from the neutral default activity rows (covers the oral split keys too). */
function activityLabels(): Map<string, string> {
  const labels = new Map<string, string>();
  for (const row of resolveIntakeActivityRows({}))
    labels.set(matrixRowKey(row), matrixRowLabel(row));
  return labels;
}

/**
 * The pure mutual overlap (§3.10b): rowKeys where BOTH partners rated ≥ "curious" (3), resolved to labels.
 * One-sided or below-curious items are excluded. Deterministic; no AI. Sorted by label for a stable list.
 */
export function computeYnmOverlap(
  aRatings: Record<string, number>,
  bRatings: Record<string, number>,
): { key: string; label: string }[] {
  const labels = activityLabels();
  const items: { key: string; label: string }[] = [];
  for (const [rowKey, aValue] of Object.entries(aRatings)) {
    const bValue = bRatings[rowKey];
    if (aValue >= CURIOUS_OR_ABOVE && bValue !== undefined && bValue >= CURIOUS_OR_ABOVE) {
      items.push({ key: rowKey, label: labels.get(rowKey) ?? rowKey });
    }
  }
  return items.sort((x, y) => x.label.localeCompare(y.label));
}

/**
 * The mutual overlap for two partners, computed ONLY when `ready` (the bridge has verified both opt-ins + both
 * acks + the live edge). When not ready, returns an empty, not-ready result — never a partial or one-sided list.
 */
export async function ynmOverlapFor(
  fs: FileSystem,
  key: Uint8Array,
  personA: string,
  personB: string,
  ready: boolean,
): Promise<TogetherYnmOverlap> {
  if (!ready) return { ready: false, items: [] };
  const [aRatings, bRatings] = await Promise.all([
    readActivityRatings(fs, key, personA),
    readActivityRatings(fs, key, personB),
  ]);
  return { ready: true, items: computeYnmOverlap(aRatings, bRatings) };
}

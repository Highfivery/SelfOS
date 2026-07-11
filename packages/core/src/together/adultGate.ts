import type { FileSystem } from '../host';
import { getGuidancePrefs } from '../conversations/guidanceService';

// The N-party 18+ conjunction (58 §5.2 / Phase F) — the first multi-person ack check in the app. EVERY
// explicit-register surface (the `together-desire` catalog group, the register block in the couples prompt,
// and all three YNM channels) gates host-side on EVERY participant's shared `adultAcknowledged` (the 16/48/50
// guidance-prefs flag). Never the UI-only `sessions:startGuided` pattern — the withholding is server-side.

/** True iff EVERY participant has acknowledged adult content (`guidance/prefs.enc adultAcknowledged`). */
export async function allAdultAcknowledged(
  fs: FileSystem,
  key: Uint8Array,
  participantIds: string[],
): Promise<boolean> {
  if (participantIds.length === 0) return false;
  for (const pid of participantIds) {
    const prefs = await getGuidancePrefs(fs, key, pid);
    if (prefs.adultAcknowledged !== true) return false;
  }
  return true;
}

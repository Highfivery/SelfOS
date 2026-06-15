import type { IntakeSession } from '../schemas';
import type { IntakeAnswerValue } from '../schemas';

/**
 * Deterministic portrait-freshness maths (18-personal-onboarding §15). Lets the app tell the person their
 * portrait is "X% out of date" once they've added/edited/cleared answers since it was last generated — a
 * cheap, no-AI nudge to regenerate so the AI's picture stays current. Pure + tested so it can't drift.
 */

/** A stable, compact djb2 hash of a serialized answer (so we snapshot a signature, not the raw content). */
function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) hash = (hash * 33) ^ input.charCodeAt(i);
  return hash >>> 0; // unsigned 32-bit
}

/** Whether an answer value is actually filled in (matches the renderer's `isAnswered`). */
function filled(value: IntakeAnswerValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true; // number / boolean
}

/** A deterministic serialization of an answer value (arrays sorted so order never counts as a change). */
function serialize(value: IntakeAnswerValue): string {
  if (Array.isArray(value)) return JSON.stringify([...value].map(String).sort());
  return JSON.stringify(value);
}

/** A per-answer signature for every filled answer in the session, keyed `sectionId.questionId`. */
export function intakeAnswerHashes(session: IntakeSession): Record<string, number> {
  const out: Record<string, number> = {};
  for (const section of session.sections) {
    for (const [questionId, value] of Object.entries(section.answers)) {
      if (!filled(value)) continue;
      out[`${section.id}.${questionId}`] = hashString(serialize(value));
    }
  }
  return out;
}

export interface PortraitStaleness {
  /** Has a portrait been generated at all? (No portrait → not "stale", just not-yet-made.) */
  hasPortrait: boolean;
  /** Answers added / edited / cleared since the portrait was generated. */
  changed: number;
  /** Answers filled in right now. */
  current: number;
  /** Roughly how much of the current picture is new/changed since the portrait (0–100). */
  pct: number;
  /** True when there's anything new to fold into a regenerated portrait. */
  stale: boolean;
}

/**
 * Compare the answers snapshotted at the last portrait synthesis (`session.portraitAnswerSig`) against the
 * answers now, counting additions, edits, and clears as "changed".
 */
export function portraitStaleness(session: IntakeSession): PortraitStaleness {
  const snapshot = session.portraitAnswerSig;
  const current = intakeAnswerHashes(session);
  const currentCount = Object.keys(current).length;
  if (!snapshot) {
    return { hasPortrait: false, changed: 0, current: currentCount, pct: 0, stale: false };
  }
  const keys = new Set([...Object.keys(snapshot), ...Object.keys(current)]);
  let changed = 0;
  for (const k of keys) if (snapshot[k] !== current[k]) changed += 1;
  const denom = Math.max(currentCount, Object.keys(snapshot).length, 1);
  const pct = Math.min(100, Math.round((changed / denom) * 100));
  return { hasPortrait: true, changed, current: currentCount, pct, stale: changed > 0 };
}

import type { FileSystem } from '../host';
import { PreScreenResultSchema, type PreScreenResult } from '../schemas';
import { readEncryptedJson, writeEncryptedJson } from '../vault';

// ── The private couples pre-screen (58 §8.2) — deterministic, AI-free, outcome-only ───────────────
// Couples-work best practice screens each partner individually before joint work and treats active
// coercion/fear as a reason NOT to start together. This mirrors that: a short, gentle, no-wrong-answers
// check before a person's FIRST session. Evaluation is PURE (the `wellbeingCrisis.ts` pattern) — it works
// AI-off and is never behind a setting. RAW ANSWERS ARE NEVER PERSISTED (data minimization, §8.2): the
// answers would be the most dangerous record in the vault; only the outcome (`flagged`) is retained.

/** The item-set version — bump when the items/flag rule change, so a re-offer/re-evaluate can be triggered. */
export const PRESCREEN_ITEM_CATALOG_VERSION = 1;

/** Days after a CLEAR result before the screen is gently re-offered (not re-gated) — §8.2. */
export const PRESCREEN_REOFFER_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PreScreenChoice {
  value: string;
  label: string;
}
export interface PreScreenItem {
  id: string;
  prompt: string;
  choices: PreScreenChoice[];
}

/**
 * The four items (mockup, §8.2). Worded gently, no wrong answers. The conservative flag rule (owner decision
 * 2026-07-10): a flag on any not-safe-being-honest / afraid-of-reactions / not-my-own-choice signal; the fear
 * item at "often" additionally surfaces crisis resources; "prefer solo first" offers the solo route but is NOT
 * itself a hard flag (wanting to prep alone isn't a safety signal).
 */
export const PRESCREEN_ITEMS: readonly PreScreenItem[] = [
  {
    id: 'safe-honest',
    prompt: 'When you and your partner disagree, do you feel safe being honest?',
    choices: [
      { value: 'yes', label: 'Yes, usually' },
      { value: 'sometimes', label: 'Sometimes' },
      { value: 'no', label: 'Not really' },
    ],
  },
  {
    id: 'afraid',
    prompt: 'Do you ever feel afraid of how they might react?',
    choices: [
      { value: 'never', label: 'Never' },
      { value: 'sometimes', label: 'Sometimes' },
      { value: 'often', label: 'Often' },
    ],
  },
  {
    id: 'own-choice',
    prompt: 'Is doing this together your own choice?',
    choices: [
      { value: 'yes', label: 'Yes, my choice' },
      { value: 'pressure', label: 'I feel some pressure' },
      { value: 'no', label: 'No, not really' },
    ],
  },
  {
    id: 'prefer-solo',
    prompt: 'Would you rather start with your own coach first?',
    choices: [
      { value: 'ready', label: 'No, I’m ready for this' },
      { value: 'maybe', label: 'Maybe' },
      { value: 'yes', label: 'Yes, I’d prefer that' },
    ],
  },
] as const;

export interface PreScreenEvaluation {
  /** True ⇒ Together holds privately for this person; individual support is suggested (§8.2). */
  flagged: boolean;
  /** True ⇒ additionally surface crisis resources (the fear item at "often"). */
  showCrisis: boolean;
  /** True ⇒ prominently offer the "start with your own coach first" route (never itself a hard flag). */
  suggestSolo: boolean;
}

/**
 * The pure, AI-free evaluation (conservative rule). `answers` maps itemId → chosen value. An unanswered item
 * contributes nothing (the caller requires all four answered before submit). No raw answer is ever stored.
 */
export function evaluatePreScreen(answers: Record<string, string>): PreScreenEvaluation {
  const flagged =
    answers['safe-honest'] === 'no' ||
    answers['afraid'] === 'sometimes' ||
    answers['afraid'] === 'often' ||
    answers['own-choice'] === 'pressure' ||
    answers['own-choice'] === 'no';
  const showCrisis = answers['afraid'] === 'often';
  const suggestSolo =
    flagged || answers['prefer-solo'] === 'yes' || answers['prefer-solo'] === 'maybe';
  return { flagged, showCrisis, suggestSolo };
}

/** Whether every item has an answer — the submit precondition (a partial screen is never stored/evaluated). */
export function isPreScreenComplete(answers: Record<string, string>): boolean {
  return PRESCREEN_ITEMS.every((item) => typeof answers[item.id] === 'string');
}

// ── Outcome-only storage (§4.1) ────────────────────────────────────────────────────────────────────

function preScreenPath(personId: string): string {
  return `people/${personId}/together/prescreen.enc`;
}

/** The person's OWN latest pre-screen outcome, or null. A corrupt file ⇒ treated as missing (re-screen, §7). */
export async function getPreScreen(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
): Promise<PreScreenResult | null> {
  try {
    const raw = await readEncryptedJson(fs, preScreenPath(personId), key);
    return raw === null ? null : PreScreenResultSchema.parse(raw);
  } catch {
    return null; // corrupt ⇒ missing ⇒ re-screen (fail-closed against a stale "cleared" flag)
  }
}

/** Persist ONLY the outcome (never the raw answers). Returns the stored result. */
export async function savePreScreenOutcome(
  fs: FileSystem,
  key: Uint8Array,
  personId: string,
  flagged: boolean,
  now: Date,
): Promise<PreScreenResult> {
  const result: PreScreenResult = {
    schemaVersion: 1,
    personId,
    flagged,
    itemCatalogVersion: PRESCREEN_ITEM_CATALOG_VERSION,
    completedAt: now.toISOString(),
  };
  await writeEncryptedJson(fs, preScreenPath(personId), result, key);
  return result;
}

/**
 * The GATE (§5.2 one rule): a person may create/accept/take a turn only when their LATEST pre-screen is
 * present AND not flagged. Missing or flagged ⇒ held. (Age never re-gates — a clear result unlocks forever;
 * 180 days only triggers a gentle re-offer, `preScreenNeedsReoffer`.)
 */
export function preScreenClears(result: PreScreenResult | null): boolean {
  return result !== null && !result.flagged;
}

/** Whether to gently RE-OFFER the screen: cleared, but older than 180 quiet days. Never gates (§8.2). */
export function preScreenNeedsReoffer(result: PreScreenResult | null, now: Date): boolean {
  if (!result || result.flagged) return false;
  const at = Date.parse(result.completedAt);
  return !Number.isNaN(at) && now.getTime() - at > PRESCREEN_REOFFER_DAYS * DAY_MS;
}

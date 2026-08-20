/**
 * 74 §8.3/§8.4 — the safety carve-out, in code.
 *
 * An adaptive take asks open questions about sex, so a free-text answer can carry a disclosure: an assault, a
 * coercive relationship, a desire traced to harm. Two things must then be true, and neither can be left to the
 * model that is generating the erotic material:
 *
 * 1. the take is FLAGGED, so the report leads with resources and the result feeds `aggregateCrisisSignal`
 *    like any other crisis flag;
 * 2. that text — and anything derived from it — NEVER enters an erotic-suggestion prompt, for them or for
 *    their partner. §8 forbids treating a disclosure as erotic material anywhere in SelfOS.
 *
 * This is a deterministic heuristic, not a content filter. The app's "never a keyword filter" rule is about
 * BOUNDARIES on consensual content; this is a safety net over disclosures, the same shape as the
 * `wellbeingCrisis` item hook. It errs toward flagging: a false positive costs one turn of erotic material and
 * shows a support line, a false negative puts an assault into a prompt about what to say in bed.
 */

/** Phrases that indicate a real-world disclosure rather than a scene. Matched case-insensitively. */
const DISTRESS_MARKERS: readonly string[] = [
  'raped me',
  'i was raped',
  'assaulted me',
  'i was assaulted',
  'sexual assault',
  'molested',
  'abused me',
  'i was abused',
  'without my consent',
  "didn't consent",
  'did not consent',
  'made me do',
  'forced me',
  'i was forced',
  'against my will',
  'traumatis',
  'traumatiz',
  'ptsd',
  'flashback',
  'i feel unsafe',
  "i'm scared of him",
  "i'm scared of her",
  'afraid of my partner',
  'hurt myself',
  'kill myself',
  'end my life',
  "don't want to be here",
  'suicidal',
];

/** Whether a free-text answer reads as a real-world disclosure rather than something they want in bed. */
export function readsAsDistress(text: string): boolean {
  const lower = text.toLowerCase();
  return DISTRESS_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Whether any free-text turn in a take carries a disclosure.
 *
 * `answer` is OPTIONAL since 74 §3.6.35 — a generated item recorded before anyone responded to it has none —
 * and the `typeof` check below already reads that as "not free text", which is correct: nothing they wrote,
 * nothing to detect.
 */
export function takeCarriesDistress(turns: readonly { answer?: unknown }[] | undefined): boolean {
  return (turns ?? []).some(
    (turn) => typeof turn.answer === 'string' && readsAsDistress(turn.answer),
  );
}

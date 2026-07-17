/**
 * A conservative backstop for the self-contained-question rule (08-questionnaires §25.4). The recipient
 * sees ONLY a question's text — never the generation context nor their other answers — so a question that
 * gestures at unseen context ("that health worry you mentioned", "your earlier answer") reads as broken.
 *
 * The PRIMARY fix is the generation prompt (`GENERATION_SYSTEM`), which tells the model to name things
 * plainly and never gesture at context the recipient can't see. This deterministic check is only a belt-
 * and-suspenders backstop for the UNAMBIGUOUS back-reference phrases a self-contained question rarely
 * uses (a reference to a prior statement). It DELIBERATELY does not match bare "that/this
 * <noun>" demonstratives — those are far too common in legitimate questions ("the thing that weighs on
 * you", "what is it that drives you") — so it stays conservative and almost never drops a good question
 * (a rare over-drop is absorbed by generation's over-ask buffer); the demonstrative-dangle case
 * ("that health worry") is left to the prompt rule. Pure + DOM-free so it's unit-tested in core.
 */
const DANGLING_PATTERNS: readonly RegExp[] = [
  // A reference to something the recipient supposedly told us — but they've said nothing in THIS question.
  /\byou (mentioned|told me)\b/i,
  // "as you mentioned", "as we discussed", "as you put it" — presupposes a prior exchange.
  /\bas (you|we) (mentioned|said|discussed|noted|put it)\b/i,
  // "you said/noted/mentioned earlier/before/previously".
  /\byou (said|noted|mentioned)\s+(earlier|before|previously|a moment ago)\b/i,
  // "your earlier/previous/prior/last answer/response/reply".
  /\byour (earlier|previous|prior|last)\s+(answer|response|reply|message)\b/i,
];

/** Whether a generated question prompt makes an unambiguous back-reference to unseen context (§25.4). */
export function hasDanglingReference(prompt: string): boolean {
  return DANGLING_PATTERNS.some((re) => re.test(prompt));
}

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

/**
 * Recitation: quoting a known fact back at the person before asking about it (spec 71 §5.7).
 *
 * `GENERATION_SYSTEM` already forbids this — _"do not recite it back word-for-word or turn a known fact into
 * 'you said X, tell me about X'"_ — but a prompt rule with no backstop silently rots. On a real vault, seven
 * of one recipient's questions opened exactly this way ("You've marked explicit dirty talk as something
 * you're curious about…"), which is both the tell of a re-ask and the thing that makes a questionnaire read
 * like a transcript of itself.
 *
 * Deliberately narrower than "mentions something known": NAMING a fact plainly inside the question is
 * required (§25.4 self-containment) and must not trip this. Only ATTRIBUTION to the person is a recitation,
 * so this matches "you've said / you marked / you rated"-style openers, not "when a worry about your health
 * shows up".
 */
const RECITATION_PATTERNS: readonly RegExp[] = [
  // Contracted attribution anywhere — "you've said", "you have marked". Inherently a recitation.
  /\byou(?:'ve|’ve| have)\s+(said|told|marked|mentioned|noted|described|rated|listed|shared)\b/i,
  // Bare past-tense attribution, but only as an OPENER — so "if you said no, what happens?" is left alone.
  /^\s*(?:so[,\s]+|and\s+|okay[,\s]+)?you\s+(said|marked|mentioned|noted|described|rated|listed)\b/i,
];

/** Whether a prompt recites a known fact back at the person rather than simply naming it (§5.7). */
export function hasRecitation(prompt: string): boolean {
  return RECITATION_PATTERNS.some((re) => re.test(prompt));
}

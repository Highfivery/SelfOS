/**
 * The challenge-coach prompt (52-challenge-sessions §5.2) — code, not vault data. Two reserved built-in
 * guides resolved by `getExercise` but NOT in the browsable `GUIDED_CATALOG`: `challenge-coach` (propose →
 * negotiate → capture a stretch action) and `challenge-reflect` (a short reflective check-in after one). A
 * challenge session is otherwise an ordinary 05 Conversation carrying a `guideId`, so streaming, metering,
 * the 18+ ack, and memory all reuse unchanged.
 *
 * SAFETY (§8, the heart of the spec): a coach with "push and challenge" energy must challenge the
 * comfortable-uncomfortable, NEVER the unsafe. The addendum is appended AFTER persona + safety + context
 * (promptBuilder), so the not-therapy / consent / crisis boundary always leads; it reinforces, never weakens
 * it. The coach proposes and negotiates — it never coerces; a challenge is always the person's choice.
 */

import type { ChallengeDomain } from '../schemas';
import type { GuidedExercise } from './guidedCatalog';

export const CHALLENGE_COACH_ID = 'challenge-coach';
export const CHALLENGE_REFLECT_ID = 'challenge-reflect';

/** The not-therapy boundary, in the coach's own instructions — the challenge analogue of the guided `frame`. */
const CHALLENGE_FRAME = `This is a self-guided "challenge" — a small experiment to try, NOT therapy, \
treatment, an exposure-therapy protocol, a prescription, or a medical plan, and you are an AI companion, not a \
clinician. The persona and safety guidance above always take precedence and you reinforce them, never weaken \
them: stay warm and reflective, never diagnose or prescribe, and route any crisis to professional help.`;

/** The marker convention taught in-prompt (the `buildStepInstruction` analogue, 16 §3.3). */
const CHALLENGE_MARKER_INSTRUCTION = `When — and ONLY when — the person clearly agrees to a concrete, specific \
action, reflect it back in one or two crisp sentences, then privately append, as the very last thing in your \
reply, the exact token [[SELFOS:CHALLENGE:{"action":"…","comfort":N,"lifeArea":"…","checkInDays":N}]] where \
"action" is the agreed action in their own words, "comfort" is the stretch level they settled on (1 = a gentle \
nudge … 5 = a big leap), "lifeArea" is the most relevant life-area, and "checkInDays" is when to check in \
(default 7). This token is a silent signal to the app; it is never shown to the person, so never mention, \
explain, or use it before they have agreed. If they decline, negotiate it away to nothing, or never settle on \
a concrete action, do NOT append it — no challenge is created, and that is a perfectly good outcome.`;

/** The consent / never-coerce core, stated verbatim in intent (§8.1). */
const CHALLENGE_CONSENT = `Propose ONE grounded stretch action drawn from what you know about them (an avoided \
situation, an open goal, a stated value, a habit they want, something new), framed as an INVITATION: small, \
specific, time-boxed, achievable-but-stretching, and entirely their choice. Then negotiate it to their \
comfort — make it smaller if it feels too big, a little bigger if too easy; clarify what exactly, when, and \
what counts as done, and surface what might get in the way with a tiny if-then plan. NEVER pressure, guilt, or \
push past a stated boundary: offer once, shrink or swap on any hesitation, and respect a "no" or "not now" \
IMMEDIATELY by letting it go. Difficulty is dialled BY THEM — you calibrate to their comfort, you never \
dictate it. A challenge that points at something clinical (a phobia, addiction, an eating pattern, persistent \
distress) is named gently and routed to professional support — never positioned as treatment, and you do not \
design a graded-exposure or recovery protocol.`;

/** Crisis yields absolutely (§8.2). */
const CHALLENGE_CRISIS = `If the person expresses distress or anything crisis-adjacent while you talk, DROP the \
challenge entirely and respond with care — take it seriously, stay warm, and route to professional or \
emergency help. A challenge is NEVER a way to "push through" a crisis, and the push always yields to safety.`;

/**
 * The DEFAULT intimacy stance — used when the 18+ ack is ABSENT (§7/§8.3). The coach must NOT engage with
 * explicit sexual content before the person has acknowledged they're an adult; it warmly redirects to the
 * gated path and keeps the challenge non-sexual. This is the always-on part of the addendum, so an un-acked
 * person who steers toward sex from a non-intimacy challenge is steered away (not just gated in the bridge).
 */
const CHALLENGE_INTIMACY_GATED = `If the person steers toward a sexual or intimate challenge, do NOT engage \
with explicit sexual content here. Warmly explain that intimacy challenges first need them to confirm they're \
18 or older — they can choose the "Intimacy" option on the Take-on-a-challenge screen once they've done so — \
and keep THIS challenge non-sexual.`;

/**
 * The explicit sexual/intimacy register — appended by `buildSystemPrompt` ONLY when the per-person 18+ ack is
 * present (§8.3). Verbatim-in-intent boundary: consensual adults, hard-nos respected absolutely, partner
 * buy-in, trauma-aware, within Anthropic policy. Exported so the prompt builder can gate it on the ack.
 */
export const CHALLENGE_INTIMACY_REGISTER = `The person has confirmed they're 18+, so if — and only if — they \
steer toward a sexual or intimate challenge, you may engage frankly as consensual-adult sexual wellness, \
within Anthropic's usage policy. Boundary: consensual adults only; taboo content only as fantasy/roleplay \
(e.g. consensual non-consent as pre-agreed roleplay); NEVER minors, real (non-roleplay) non-consent, or \
illegal acts. Respect hard-nos ABSOLUTELY: never propose or push anything they have marked a hard no or stated \
as a boundary — draw a sexual challenge only from their own interests and "Maybe" curiosities, never their \
nos; a "Maybe" may be gently invited, a "No" is off-limits. For any act that involves a partner, frame it to \
require the partner's genuine consent and enthusiasm — steer toward conversation, negotiation, and a real yes, \
never pressuring either person, and never assume a partner who isn't there (a single person gets a solo / \
self-understanding framing). Be trauma-aware: if shame, trauma, or an assault history surfaces, slow down, \
validate, STOP pushing, and route to professional support (a sex therapist / therapist / crisis line) — never \
frame trauma as kink, never treat a disclosed assault as erotic.`;

const CHALLENGE_COACH_ADDENDUM = `${CHALLENGE_FRAME} You are helping them take on a small CHALLENGE — a \
deliberately-stretching experiment to try between now and a check-in, grounded in what you know about them. \
${CHALLENGE_CONSENT} ${CHALLENGE_CRISIS} ${CHALLENGE_INTIMACY_GATED} ${CHALLENGE_MARKER_INSTRUCTION}`;

const CHALLENGE_REFLECT_ADDENDUM = `${CHALLENGE_FRAME} They are checking in on a challenge they took on — a \
small experiment they agreed to try. Ask, warmly and without judgement, how it went: what they actually did \
(or didn't — both are fine and informative), how it felt, what they noticed or learned, and what they might \
try next. Celebrate showing up far more than any "result"; if they didn't do it, there is no failure here — \
get curious about what got in the way, with zero guilt. ${CHALLENGE_CRISIS} Keep it short and kind; you are \
reflecting on an experiment, not running a new one — do not propose or capture a new challenge in this session.`;

const DOMAIN_OPENER: Record<ChallengeDomain, string> = {
  overcome:
    "Let's pick a small step toward something you've been avoiding or wanting to overcome — at a pace that " +
    'feels doable. What have you had in mind?',
  habit:
    "Let's design one tiny habit to start (or one to interrupt for a bit). Keeping it small is the whole " +
    'trick. What would you like to build or break?',
  horizons:
    "Let's find a small way to broaden your horizons — a new place, activity, idea, or person to talk to. " +
    'What are you curious about, or shall I suggest something based on what I know about you?',
  novelty:
    "Let's try something new, just as a one-off experiment. What have you been curious to try — or want me " +
    'to surprise you?',
  intimacy:
    "Let's pick a small intimacy or connection experiment — something consensual to try or talk through, at " +
    'your pace and entirely your choice. Where would you like to start?',
};

/**
 * The challenge session's static opening message (§3.1) — no model call (works offline, the 16 §11.4 opener
 * precedent). Domain-aware when the person seeded one at launch, otherwise an open chooser.
 */
export function challengeOpeningMessage(domain?: ChallengeDomain): string {
  if (domain) return DOMAIN_OPENER[domain];
  return (
    "I'd love to suggest a small challenge to try — a little experiment to stretch your comfort zone, and " +
    "entirely your choice. Want it grounded in something specific — a habit, a fear you've mentioned, " +
    'something new to try — or shall I surprise you?'
  );
}

/**
 * The two reserved challenge guides. They carry the `GuidedExercise` shape (so `getExercise`/`buildSystemPrompt`
 * resolve their addendum after persona+safety+context) but are deliberately absent from `GUIDED_CATALOG` /
 * `listExercises()` — a challenge is launched via "Take on a challenge", not browsed in the guided catalog.
 * `group: 'challenge'` is NOT in `GUIDED_GROUPS`, so the browsable catalog never renders it.
 */
export const CHALLENGE_GUIDES: ReadonlyArray<GuidedExercise> = [
  {
    id: CHALLENGE_COACH_ID,
    group: 'challenge',
    title: 'Take on a challenge',
    framework: 'Behavioral experiment',
    blurb: 'A small experiment to stretch your comfort zone.',
    kind: 'chat',
    openingMessage: challengeOpeningMessage(),
    systemPromptAddendum: CHALLENGE_COACH_ADDENDUM,
  },
  {
    id: CHALLENGE_REFLECT_ID,
    group: 'challenge',
    title: 'How did it go?',
    framework: 'Reflective practice',
    blurb: 'Reflect on a challenge you took on.',
    kind: 'chat',
    openingMessage:
      "Let's reflect on the challenge you took on. No pressure and no wrong answers — did you give it a " +
      'go, and how did it feel? Whatever happened, it tells us something useful.',
    systemPromptAddendum: CHALLENGE_REFLECT_ADDENDUM,
  },
];

/** Whether a guideId is one of the challenge guides (so the renderer can treat its thread as a challenge). */
export function isChallengeGuide(guideId: string | undefined): boolean {
  return guideId === CHALLENGE_COACH_ID || guideId === CHALLENGE_REFLECT_ID;
}

/** The challenge-reflect guide (its static opener seeds a reflection session, §3.5). */
export function getReflectGuide(): GuidedExercise {
  const guide = CHALLENGE_GUIDES.find((g) => g.id === CHALLENGE_REFLECT_ID);
  if (!guide) throw new Error('challenge-reflect guide missing'); // unreachable — it's a code constant
  return guide;
}

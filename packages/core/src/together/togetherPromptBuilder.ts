import type { FileSystem } from '../host';
import type { ContextTopic, TogetherSession } from '../schemas';
import { buildContext, getPerson } from '../people';
import { FORMATTING, PERSONA, SAFETY } from '../conversations/promptBuilder';
import { buildGroundingPack } from './groundingPack';
import { listStates } from './togetherService';
import { getTogetherGuide, togetherGuideLifeAreas } from './togetherCatalog';
import { buildStepInstruction } from '../conversations/guidedSteps';

// ── The couples coach prompt (58 §6.3) — order is load-bearing ────────────────────────────────────
// PERSONA + SAFETY always lead (verbatim, 05); then the Together facilitator addendum; then a
// per-participant context block wrapped in the confidentiality contract (each fed via
// buildContext(..., { excludeRestricted: true }) — the CODE-enforced restricted exclusion, §6.3); then the
// grounding pack; then (Phase E) the guide addendum; then (Phase F) the explicit register when BOTH acked;
// then FORMATTING. This file owns the couples voice; the solo `buildSystemPrompt` is untouched.

/** The not-therapy couples frame (the `frame()` sibling, §8.1) — leads the addendum; SAFETY still precedes it. */
export const TOGETHER_FRAME = `This is a Together session: a self-guided practice for the two of you, \
informed by research-backed approaches like Gottman, EFT, and Masters & Johnson — it is NOT therapy, \
diagnosis, or treatment, and you are an AI facilitator, not a clinician. The persona and safety guidance \
above always take precedence; route any crisis to professional help.`;

/**
 * The facilitator persona (§6.3 step 2). Hold-space cadence, speaker balance, EFT/Gottman-informed
 * facilitation, the coercion-awareness clauses (§8.5), and the secrets/aside stance (§8.4 — the
 * non-confirming DEFLECTION phrase + the explicit no-sabotage line are refined in Phase C). Never adjudicates.
 */
export const TOGETHER_ADDENDUM = `You are facilitating a shared conversation between two partners. Both \
of them can read everything either of them writes here, and you reply to each message.

Hold space. While only one partner has weighed in on what's currently being discussed, stay brief — \
acknowledge, ask a small clarifying question, and explicitly defer the bigger moves until you've heard \
from the other person ("I'd like to hear how this lands for the other of you before we go further"). \
Once both have contributed, facilitate fully: name the cycle you notice (EFT), keep turns fair, reflect \
each person's underlying need, and offer concrete repair moves (Gottman). Never take a side or declare a \
winner. When exchanges escalate or someone sounds flooded, slow down, validate both, and suggest a short \
structured pause rather than pushing on.

Watch, gently, for signs that one partner is being pressured — to participate, to escalate, to \
"consent," or fear-tinged language. If you sense it, de-escalate and, in that person's private channel, \
suggest individual support; never name a suspicion about one partner in front of the other, and never \
frame pressure or coercion as part of intimacy. Consent is absolute; any hard "no" ends that thread.

You know private things about each of them. NEVER quote, attribute, reveal, or hint at what you know \
about one partner to the other — not even indirectly, and not even about the person themselves in front \
of their partner. Use private background only to pace and steer your support safely.

Some notes are marked "[PRIVATE ...]" — a private aside only that author can see. When you reply to a \
private aside, keep your reply inside that private channel: respond to them alone, mint no shared \
suggestions or agreements from it, and — when something private would help the two of them — encourage \
that partner to raise it themselves in the open conversation when the moment feels right.

If one partner asks whether the other has told you something privately, answer the SAME way whether or \
not anything exists — never confirm or deny: "I keep each of your private reflections private — I'd tell \
you the same thing either way." Never use a private note to covertly steer or sabotage the other partner. \
You won't hold, indefinitely, a private secret that undermines the joint work — instead work with the \
person who shared it toward bringing it into the open themselves, or toward naming that it belongs in \
their own individual work; you never disclose it for them.`;

/**
 * The full explicit register for a couples session (§6.3 step 5 / Phase F) — appended ONLY when
 * `allAdultAcknowledged(participants)`. The frank-but-bounded sibling of the 52 `CHALLENGE_INTIMACY_REGISTER`,
 * adapted for two partners. SAFETY is never loosened; this only WIDENS the register when both have acked.
 */
export const EXPLICIT_INTIMACY_REGISTER = `Both partners have confirmed they're 18+, so when the conversation \
turns to sex or intimacy you may engage frankly, as consensual-adult sexual wellness, within Anthropic's usage \
policy — explicit, specific, plain language is welcome. Boundary: consensual adults only; taboo content only \
as fantasy/roleplay (e.g. consensual non-consent as pre-agreed roleplay); NEVER minors, real (non-roleplay) \
non-consent, or illegal acts. Everything here is between the two of THEM: steer toward mutual, enthusiastic \
consent — negotiation, a real yes from both, and honored exits; never pressure either partner, never take a \
side, and never coach one to persuade or wear down the other. Respect a hard no ABSOLUTELY — from either \
partner, it ends that thread. Be trauma-aware: if shame, coercion, or an assault history surfaces, slow down, \
validate, STOP, and route to professional support — never frame trauma as kink, never treat a disclosed \
assault as erotic.`;

/**
 * Teach the coach the agreement-capture convention (§6.4 — the AGREEMENT marker, a Phase-D shared artifact).
 * Only on the OPEN conversation (never from a private aside — that's enforced host-side + restated here).
 */
export const AGREEMENT_INSTRUCTION = `When BOTH partners clearly commit, together, to a concrete agreement \
(e.g. "screen-free dinners on weekdays", "a weekly check-in"), silently append — at the very end of that \
reply — the exact token [[SELFOS:AGREEMENT:{"text":"the agreement in a short sentence","timeframe":"when/how \
often, if stated"}]]. Only capture something BOTH have actually agreed to in the open conversation, never \
from a private aside and never a one-sided idea. This token is a silent signal to the app; it is never shown \
to either partner, so never mention or explain it.`;

/**
 * Teach the coach the JOINT-challenge convention (§5.6 — the CHALLENGE marker, a couples twin of the 52
 * challenge). Only on the OPEN conversation, only when both partners genuinely take it on together.
 */
export const JOINT_CHALLENGE_INSTRUCTION = `When BOTH partners want to take on the SAME small, concrete \
stretch action together before the next time you talk (an experiment for the relationship — e.g. "each share \
one appreciation a day", "plan one screen-free evening"), silently append — at the very end of that reply — \
the exact token [[SELFOS:CHALLENGE:{"action":"the shared action in their words","comfort":N,"lifeArea":"the \
area","checkInDays":N}]], where comfort is 1 (gentle) to 5 (a big stretch) and checkInDays is when to gently \
check in. Only when BOTH clearly commit together in the open conversation — never from a private aside, never \
one-sided. This token is a silent app signal, never shown to either partner; never mention or explain it.`;

/**
 * Teach the coach the SUGGESTION convention (§5.6 — the SUGGEST marker). When a guided exercise or a
 * compatibility check-in would genuinely help this pair, the coach can drop a suggestion CARD they can act on.
 */
export const SUGGEST_INSTRUCTION = `When a specific next step would clearly help this pair — a guided exercise \
from their Together catalog, or a short compatibility check-in on a topic they keep circling — you may silently \
append (at the very end of the reply) the exact token [[SELFOS:SUGGEST:{"kind":"guide"|"questionnaire","prompt":\
"a short, warm phrasing of the suggestion","guideId":"the catalog id if kind is guide","topic":"a short topic \
if kind is questionnaire"}]]. This drops a card they can choose to act on — it NEVER sends or starts anything on \
its own. Suggest sparingly, only when it truly fits, never from a private aside. The token is a silent app \
signal, never shown; never mention or explain it.`;

/** The per-participant confidentiality contract (§6.3 step 3) — prefixes each person's own context block. */
export function confidentialityContract(name: string): string {
  return `The following is private background about ${name}. Use it to shape your support. Never quote, \
reference, attribute, or reveal it — to anyone, including ${name} themselves in front of their partner. \
It informs how you help; it is never something you say out loud.`;
}

export interface TogetherPromptOptions {
  /** The call's topic (life-areas) — a guided couples session derives it from its catalog group (Phase E). */
  topic?: ContextTopic;
  /** Whether EVERY participant has acknowledged adult content — gates the explicit register (Phase F). */
  allAdultAcked?: boolean;
}

/**
 * Assemble the couples system prompt for a session (§6.3). Reads each participant's own context with
 * `excludeRestricted: true`, so no break-glass trauma/intimacy fact ever reaches a prompt the partner reads.
 */
export async function buildTogetherSystemPrompt(
  fs: FileSystem,
  key: Uint8Array,
  session: TogetherSession,
  options: TogetherPromptOptions = {},
): Promise<string> {
  const names = new Map<string, string>();
  for (const pid of session.participantIds) {
    names.set(pid, (await getPerson(fs, key, pid))?.displayName ?? 'this partner');
  }
  const nameOf = (pid: string): string => names.get(pid) ?? 'this partner';

  const parts: string[] = [
    PERSONA,
    SAFETY,
    TOGETHER_FRAME,
    TOGETHER_ADDENDUM,
    AGREEMENT_INSTRUCTION,
    JOINT_CHALLENGE_INSTRUCTION,
    SUGGEST_INSTRUCTION,
  ];

  // A guided couples session (§3.10) foregrounds its group's life-areas for per-call fact selection; a
  // free-start passes the caller's topic (or none). The guide addendum itself is appended AFTER context.
  const guide = session.guideId ? getTogetherGuide(session.guideId) : undefined;
  const topic: ContextTopic | undefined = guide
    ? { lifeAreas: togetherGuideLifeAreas(guide.group) }
    : options.topic;

  // A participant's private background feeds the coach ONLY once they've accepted the rules of the room
  // (§3.4 — the consent moment for full-context personalization). The initiator always has `rulesAckAt` from
  // create; a partner only after accept — so before the partner joins the coach has just the initiator's
  // context, which also implements "it won't go deep before the partner joins" (§3.3). Each block is
  // OWN-context-only (§6.3): no cross-shared partner facts re-admitted; the contract wraps only that person.
  const states = await listStates(fs, key, session.id);
  for (const pid of session.participantIds) {
    if (!states.get(pid)?.rulesAckAt) continue;
    const context = await buildContext(fs, key, pid, topic, {
      excludeRestricted: true,
      ownContextOnly: true,
    });
    if (context) parts.push(`${confidentialityContract(nameOf(pid))}\n${context}`);
  }

  const grounding = await buildGroundingPack(fs, key, session, nameOf);
  if (grounding) parts.push(grounding);

  // The guide addendum + (structured) step convention (Phase E), appended AFTER context + grounding so the
  // boundary always leads. The addendum's `frame()` restates the not-therapy line; a structured guide adds the
  // `[[SELFOS:STEP:n]]` convention the couples turn parses to derive the current step. (Phase F appends the
  // EXPLICIT_INTIMACY_REGISTER here when BOTH partners have acked.)
  if (guide) {
    parts.push(guide.systemPromptAddendum);
    if (guide.kind === 'structured' && guide.steps && guide.steps.length > 0) {
      parts.push(buildStepInstruction(guide.steps));
    }
  }

  // The explicit register (Phase F) — appended ONLY when BOTH partners have acknowledged adult content
  // (`allAdultAcked`, computed host-side over EVERY participant), AFTER context + grounding + guide so the
  // boundary always leads. SAFETY is never loosened; absent ⇒ the conservative register (Phase B/E).
  if (options.allAdultAcked) parts.push(EXPLICIT_INTIMACY_REGISTER);

  parts.push(FORMATTING);
  return parts.filter(Boolean).join('\n\n');
}

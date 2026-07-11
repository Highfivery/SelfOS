import type { FileSystem } from '../host';
import type { ContextTopic, TogetherSession } from '../schemas';
import { buildContext, getPerson } from '../people';
import { FORMATTING, PERSONA, SAFETY } from '../conversations/promptBuilder';
import { buildGroundingPack } from './groundingPack';
import { listStates } from './togetherService';

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

  const parts: string[] = [PERSONA, SAFETY, TOGETHER_FRAME, TOGETHER_ADDENDUM];

  // A participant's private background feeds the coach ONLY once they've accepted the rules of the room
  // (§3.4 — the consent moment for full-context personalization). The initiator always has `rulesAckAt` from
  // create; a partner only after accept — so before the partner joins the coach has just the initiator's
  // context, which also implements "it won't go deep before the partner joins" (§3.3). Each block is
  // OWN-context-only (§6.3): no cross-shared partner facts re-admitted; the contract wraps only that person.
  const states = await listStates(fs, key, session.id);
  for (const pid of session.participantIds) {
    if (!states.get(pid)?.rulesAckAt) continue;
    const context = await buildContext(fs, key, pid, options.topic, {
      excludeRestricted: true,
      ownContextOnly: true,
    });
    if (context) parts.push(`${confidentialityContract(nameOf(pid))}\n${context}`);
  }

  const grounding = await buildGroundingPack(fs, key, session, nameOf);
  if (grounding) parts.push(grounding);

  // The guided-exercise addendum + step instruction (Phase E) and the EXPLICIT_INTIMACY_REGISTER (Phase F,
  // both acked) are appended here, AFTER context + grounding, so the boundary always leads. Absent in Phase B.

  parts.push(FORMATTING);
  return parts.filter(Boolean).join('\n\n');
}

import type { CompatibilityVisibility, PrivacyMode } from '../schemas';

/**
 * The recipient disclosure text, **derived** from the send's privacy/visibility (08-questionnaires
 * §3.2/§3.6/§8.4). Keeping this in one pure place — shared by the sender's Send panel and the recipient's
 * Inbox — is the honesty guard: no configuration can promise more privacy than the system delivers,
 * because both surfaces print the same derived line.
 */

/**
 * The participant context a compatibility recipient's disclosure is derived from (08-questionnaires
 * §16.1). A compatibility send has **two participants** — which may include the sender ("you + someone
 * else") or be two other people. The disclosure is written from one recipient's point of view, so it
 * names **the OTHER participant** (never the sender as a neutral third party), with the sender named only
 * where the visibility actually involves them (`senderSeesAll`).
 */
export interface CompatibilityDisclosureContext {
  /** The name of the OTHER participant, from this recipient's point of view. */
  otherParticipantName: string;
  /** The sender (the report audience / who may reveal raw answers on `senderSeesAll`). */
  senderName: string;
  /** True when this recipient IS the sender (i.e. the sender is one of the two participants). */
  viewerIsSender: boolean;
}

/** What a compatibility-send recipient is told, given the visibility mode + who the participants are. */
export function compatibilityDisclosure(
  visibility: CompatibilityVisibility,
  ctx: CompatibilityDisclosureContext,
): string {
  const { otherParticipantName: other, senderName, viewerIsSender } = ctx;
  switch (visibility) {
    case 'sharedReport':
      return `Your individual answers stay private — neither you nor ${other} sees the other's answers. You'll both get one combined report.`;
    case 'eachSeesOwn':
      return `Your individual answers stay private to you; ${other} won't see them. You'll both get a combined report, and you can review your own answers.`;
    case 'senderSeesAll':
      return viewerIsSender
        ? `You'll be able to see both your own answers and ${other}'s, and you'll both get a combined report.`
        : `Your answers will be shared with ${senderName}, and you'll both get a combined report.`;
    case 'contextOnly':
      return `There's no report, and no one in this exchange sees your answers — they just help your own coach understand you a little better.`;
  }
}

/**
 * What an EXTERNAL (relay) recipient is told, derived from the send's privacy mode (§3.2/§8.4). Computed
 * at send time and sealed into the relay content so the page shows exactly this — the honesty guard
 * applies to external sends too. We **never** surface owner/admin visibility to answerers (a durable
 * product rule), so no admin-access line is appended.
 */
export function externalSendDisclosure(askerName: string, privacy: PrivacyMode): string {
  return privacy === 'standard'
    ? `Your answers will be shared with ${askerName} to help them understand you better.`
    : `Your answers are private — they’re used only to personalize ${askerName}’s coaching, and ${askerName} won’t see your written answers. Numeric ratings may appear in their trends over time.`;
}

import type { CompatibilityVisibility, PrivacyMode } from '../schemas';

/**
 * The recipient disclosure text, **derived** from the send's privacy/visibility (08-questionnaires
 * §3.2/§3.6/§8.4). Keeping this in one pure place — shared by the sender's Send panel and the recipient's
 * Inbox — is the honesty guard: no configuration can promise more privacy than the system delivers,
 * because both surfaces print the same derived line.
 */

/** What a compatibility-send recipient is told, given the author's chosen visibility mode. */
export function compatibilityDisclosure(
  visibility: CompatibilityVisibility,
  askerName: string,
): string {
  switch (visibility) {
    case 'sharedReport':
      return `Your individual answers stay private — neither you nor ${askerName} sees the other's answers. You'll both get one combined report.`;
    case 'eachSeesOwn':
      return `Your individual answers stay private to you; ${askerName} won't see them. You'll both get a combined report, and you can review your own answers.`;
    case 'senderSeesAll':
      return `Your answers will be shared with ${askerName}, and you'll both get a combined report.`;
  }
}

/**
 * The extra line shown to a recipient when `questionnaires.discloseAdminAccess` is ON — the honest
 * acknowledgement that an owner/super-admin could break-glass access their answers (§8.4). Off by default,
 * so recipients feel safe to be honest; on, the disclosure never over-promises.
 */
export const ADMIN_ACCESS_DISCLOSURE =
  'A household owner or administrator may be able to access your answers.';

/**
 * What an EXTERNAL (relay) recipient is told, derived from the send's privacy mode (§3.2/§8.4). Computed
 * at send time and sealed into the relay content so the page shows exactly this — the honesty guard
 * applies to external sends too. `discloseAdminAccess` (the admin-only setting) appends the break-glass
 * acknowledgement when on.
 */
export function externalSendDisclosure(
  askerName: string,
  privacy: PrivacyMode,
  options: { discloseAdminAccess: boolean },
): string {
  const base =
    privacy === 'standard'
      ? `Your answers will be shared with ${askerName} to help them understand you better.`
      : `Your answers are private — they’re used only to personalize ${askerName}’s coaching, and ${askerName} won’t see your written answers. Numeric ratings may appear in their trends over time.`;
  return options.discloseAdminAccess ? `${base} ${ADMIN_ACCESS_DISCLOSURE}` : base;
}

import type { CompatibilityVisibility } from '../schemas';

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
      return `Your individual answers stay private — neither you nor ${askerName} sees the other's raw answers. You'll both see a shared compatibility report.`;
    case 'eachSeesOwn':
      return `Your individual answers stay private to you; ${askerName} won't see them. You'll both see a shared compatibility report, and you can review your own answers.`;
    case 'senderSeesAll':
      return `Your answers will be shared with ${askerName}, and you'll both see a shared compatibility report.`;
  }
}

/**
 * The extra line shown to a recipient when `questionnaires.discloseAdminAccess` is ON — the honest
 * acknowledgement that an owner/super-admin could break-glass access their answers (§8.4). Off by default,
 * so recipients feel safe to be honest; on, the disclosure never over-promises.
 */
export const ADMIN_ACCESS_DISCLOSURE =
  'A household owner or administrator may be able to access your answers.';

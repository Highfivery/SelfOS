import { z } from 'zod';

/**
 * Editable default email/SMS wording for external (relay) sends (08-questionnaires §3.2/§4.5). The
 * household sets a default in Settings (`questionnaires.defaultMessages`); the send panel prefills from
 * it and the sender can still tweak per send. Templates carry `{sender}` + `{link}` placeholders; the
 * PIN is appended (or not) by the per-send "Include the PIN" toggle, so opting out cleanly omits it.
 */
export const RelayMessagesSchema = z.object({
  emailSubject: z.string(),
  emailBody: z.string(),
  smsBody: z.string(),
});
export type RelayMessages = z.infer<typeof RelayMessagesSchema>;

export const DEFAULT_RELAY_MESSAGES: RelayMessages = {
  emailSubject: '{sender} would like your input',
  emailBody:
    '{sender} invited you to answer a short, private questionnaire.\n\nOpen the secure link: {link}\n\nYour answers are encrypted. Sent securely via SelfOS.',
  smsBody: '{sender} invited you to a quick questionnaire: {link}',
};

const fill = (template: string, sender: string, link: string): string =>
  template.replaceAll('{sender}', sender).replaceAll('{link}', link);

export function emailSubjectFrom(messages: RelayMessages, sender: string): string {
  return messages.emailSubject.replaceAll('{sender}', sender);
}

export function emailBodyFrom(
  messages: RelayMessages,
  parts: { sender: string; link: string; pin: string; includePin: boolean },
): string {
  const base = fill(messages.emailBody, parts.sender, parts.link);
  return parts.includePin ? `${base}\n\nPIN: ${parts.pin}` : base;
}

export function smsBodyFrom(
  messages: RelayMessages,
  parts: { sender: string; link: string; pin: string; includePin: boolean },
): string {
  const base = fill(messages.smsBody, parts.sender, parts.link);
  return parts.includePin ? `${base} (PIN: ${parts.pin})` : base;
}

import { Button, Field, Stack, Text, TextInput, Textarea } from '../design-system/components';
import { useSetting } from './useSetting';
import {
  DEFAULT_RELAY_MESSAGES,
  type RelayMessages,
} from '../app/routes/questionnaires/relayMessages';

/**
 * Edits the default email/SMS wording for external (relay) sends (`questionnaires.defaultMessages`,
 * 08-questionnaires §3.2/§4.5). `{sender}` and `{link}` are filled in per send; the PIN is added by the
 * send panel's "Include the PIN" toggle. The sender can still tweak the message per send.
 */
export function RelayMessagesControl(): JSX.Element {
  const [stored, setMessages] = useSetting('questionnaires.defaultMessages');
  const messages = stored ?? DEFAULT_RELAY_MESSAGES; // defend against an unseeded value
  const set = (patch: Partial<RelayMessages>): void => setMessages({ ...messages, ...patch });
  const isDefault = JSON.stringify(messages) === JSON.stringify(DEFAULT_RELAY_MESSAGES);

  return (
    <Stack gap={3}>
      <Text size="sm" tone="secondary">
        Used when you send a questionnaire to someone without SelfOS. Use <code>{'{sender}'}</code>{' '}
        for your name and <code>{'{link}'}</code> for the secure link.
      </Text>
      <Field label="Email subject">
        {(props) => (
          <TextInput
            {...props}
            value={messages.emailSubject}
            onChange={(e) => set({ emailSubject: e.target.value })}
          />
        )}
      </Field>
      <Field label="Email message">
        {(props) => (
          <Textarea
            {...props}
            rows={5}
            value={messages.emailBody}
            onChange={(e) => set({ emailBody: e.target.value })}
          />
        )}
      </Field>
      <Field label="Text message">
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            value={messages.smsBody}
            onChange={(e) => set({ smsBody: e.target.value })}
          />
        )}
      </Field>
      <div>
        <Button
          variant="secondary"
          disabled={isDefault}
          onClick={() => setMessages(DEFAULT_RELAY_MESSAGES)}
        >
          Reset to defaults
        </Button>
      </div>
    </Stack>
  );
}

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RELAY_MESSAGES,
  emailBodyFrom,
  emailSubjectFrom,
  smsBodyFrom,
} from './relayMessages';

const parts = { sender: 'Sam', link: 'https://relay/q/t#k=k', pin: '482913' };

describe('relay message templates', () => {
  it('fills {sender} into the subject', () => {
    expect(emailSubjectFrom(DEFAULT_RELAY_MESSAGES, 'Sam')).toBe('Sam would like your input');
  });

  it('fills {sender} + {link} and appends the PIN only when included', () => {
    const withPin = emailBodyFrom(DEFAULT_RELAY_MESSAGES, { ...parts, includePin: true });
    expect(withPin).toContain('Sam invited you');
    expect(withPin).toContain('https://relay/q/t#k=k');
    expect(withPin).toContain('PIN: 482913');

    const withoutPin = emailBodyFrom(DEFAULT_RELAY_MESSAGES, { ...parts, includePin: false });
    expect(withoutPin).not.toContain('482913');
    expect(withoutPin).not.toContain('PIN:');
  });

  it('builds the SMS with an inline PIN only when included', () => {
    expect(smsBodyFrom(DEFAULT_RELAY_MESSAGES, { ...parts, includePin: true })).toBe(
      'Sam invited you to a quick questionnaire: https://relay/q/t#k=k (PIN: 482913)',
    );
    expect(smsBodyFrom(DEFAULT_RELAY_MESSAGES, { ...parts, includePin: false })).toBe(
      'Sam invited you to a quick questionnaire: https://relay/q/t#k=k',
    );
  });

  it('honors a customized template', () => {
    const custom = {
      emailSubject: 'Hi from {sender}',
      emailBody: 'Open {link}',
      smsBody: 'Go: {link}',
    };
    expect(emailSubjectFrom(custom, 'Sam')).toBe('Hi from Sam');
    expect(emailBodyFrom(custom, { ...parts, includePin: false })).toBe(
      'Open https://relay/q/t#k=k',
    );
  });
});

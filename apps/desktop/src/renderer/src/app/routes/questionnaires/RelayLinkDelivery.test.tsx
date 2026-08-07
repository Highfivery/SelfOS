import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EmailStatus } from '@shared/schemas';
import { RelayLinkDelivery, isLikelyEmail, isLikelyPhone } from './RelayLinkDelivery';
import { useSettingsStore } from '../../../settings/settingsStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useSettingsStore.setState({ values: {} });
});

function renderDelivery(): void {
  installMockBridge();
  render(
    <RelayLinkDelivery
      link="https://relay.example/q/abc"
      pin="123456"
      senderName="Ben"
      sensitive={false}
    />,
  );
}

const READY_STATUS: EmailStatus = {
  configured: true,
  domainVerified: true,
  hasSharedKey: true,
  hasDeviceOverride: false,
  resolvedReady: true,
  source: 'shared',
  intimacyEligible: false,
};

describe('RelayLinkDelivery email/phone validation (38 §3.9)', () => {
  it('disables Email on a malformed address, with a hint, and re-enables when fixed', async () => {
    const user = userEvent.setup();
    renderDelivery();
    const email = screen.getByLabelText(/email/i);
    await user.type(email, 'not-an-email');
    expect(screen.getByRole('button', { name: 'Email' })).toBeDisabled();
    expect(screen.getByText(/that email looks off/i)).toBeInTheDocument();
    // Copy/Share-style affordances stay usable — delivery is never blocked outright.
    expect(screen.getByRole('button', { name: /copy message/i })).toBeEnabled();
    await user.clear(email);
    await user.type(email, 'angel@example.com');
    expect(screen.getByRole('button', { name: 'Email' })).toBeEnabled();
  });

  it('disables Text on a malformed phone, with a hint', async () => {
    const user = userEvent.setup();
    renderDelivery();
    await user.type(screen.getByLabelText(/phone/i), '12');
    expect(screen.getByRole('button', { name: 'Text' })).toBeDisabled();
    expect(screen.getByText(/that number looks off/i)).toBeInTheDocument();
  });

  it('leaves Email/Text enabled when the fields are empty (sender addresses it in their client)', () => {
    renderDelivery();
    expect(screen.getByRole('button', { name: 'Email' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Text' })).toBeEnabled();
  });
});

describe('RelayLinkDelivery real Resend send (67 P1 / family A)', () => {
  it('sends via Resend when email is connected: the button is "Send email" and a success banner shows', async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve({ ok: true as const, entryId: 'e1' }));
    installMockBridge({
      emailStatus: () => Promise.resolve(READY_STATUS),
      emailSendQuestionnaireDelivery: send,
    });
    render(
      <RelayLinkDelivery
        link="https://relay.example/q/abc"
        pin="123456"
        senderName="Ben"
        sensitive={false}
      />,
    );

    // The Email button becomes "Send email" once the ready status resolves.
    const sendBtn = await screen.findByRole('button', { name: 'Send email' });
    // Disabled with no recipient email; enabled once a valid one is entered.
    expect(sendBtn).toBeDisabled();
    await user.type(screen.getByLabelText(/email/i), 'alex@example.com');
    expect(sendBtn).toBeEnabled();

    await user.click(sendBtn);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        toAddress: 'alex@example.com',
        link: 'https://relay.example/q/abc',
      }),
    );
    expect(await screen.findByText(/sent to alex@example\.com/i)).toBeInTheDocument();
  });

  it('surfaces a calm warning + keeps Copy usable when the send fails', async () => {
    const user = userEvent.setup();
    installMockBridge({
      emailStatus: () => Promise.resolve(READY_STATUS),
      emailSendQuestionnaireDelivery: () =>
        Promise.resolve({ ok: false as const, reason: 'SEND_ERROR' as const, message: 'bounced' }),
    });
    render(
      <RelayLinkDelivery
        link="https://relay.example/q/abc"
        pin="123456"
        senderName="Ben"
        sensitive={false}
      />,
    );
    const sendBtn = await screen.findByRole('button', { name: 'Send email' });
    await user.type(screen.getByLabelText(/email/i), 'alex@example.com');
    await user.click(sendBtn);
    expect(await screen.findByText(/couldn’t send that email \(bounced\)/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy message/i })).toBeEnabled();
  });

  it('stays a mailto hand-off (button "Email") when email is not connected', async () => {
    installMockBridge(); // default status: resolvedReady false
    render(
      <RelayLinkDelivery
        link="https://relay.example/q/abc"
        pin="123456"
        senderName="Ben"
        sensitive={false}
      />,
    );
    // Give the async status a tick; the label must remain the mailto "Email".
    await waitFor(() => expect(screen.getByRole('button', { name: 'Email' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Send email' })).not.toBeInTheDocument();
  });
});

describe('email/phone format helpers', () => {
  it('accepts well-formed values and rejects typos', () => {
    expect(isLikelyEmail('a@b.co')).toBe(true);
    expect(isLikelyEmail('a@b')).toBe(false);
    expect(isLikelyEmail('nope')).toBe(false);
    expect(isLikelyPhone('+1 555 123 4567')).toBe(true);
    expect(isLikelyPhone('(555) 123-4567')).toBe(true);
    expect(isLikelyPhone('12')).toBe(false);
    expect(isLikelyPhone('call me')).toBe(false);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

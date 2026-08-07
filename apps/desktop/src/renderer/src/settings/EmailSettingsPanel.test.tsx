import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EmailStatus } from '@selfos/core/schemas';
import { DEFAULT_ROLES } from '@shared/capabilities';
import { EmailSettingsPanel } from './EmailSettingsPanel';
import { useSessionStore } from '../stores/sessionStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

const person = {
  id: 'p1',
  schemaVersion: 1 as const,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

const notConnected: EmailStatus = {
  configured: false,
  domainVerified: false,
  hasSharedKey: false,
  hasDeviceOverride: false,
  resolvedReady: false,
  source: 'none',
};
const connected: EmailStatus = {
  ...notConnected,
  configured: true,
  resolvedReady: true,
  source: 'device',
};

function asRole(roleId: 'owner' | 'member'): void {
  useSessionStore.setState({
    activePerson: person,
    access: { roles: DEFAULT_ROLES, accounts: [{ personId: person.id, roleId, hasPin: false }] },
  });
}

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ activePerson: null, access: null });
});

describe('EmailSettingsPanel (67 §3.1)', () => {
  it('an admin sees the connect controls (AdminOnly) + the "Connect Resend" empty state on toggles', async () => {
    asRole('owner');
    installMockBridge({
      emailStatus: () => Promise.resolve(notConnected),
      emailGetPrefs: () => Promise.resolve(null),
    });
    render(<EmailSettingsPanel />);
    expect(await screen.findByText('Connect Resend')).toBeInTheDocument();
    expect(screen.getByText('Admin only')).toBeInTheDocument();
    expect(screen.getByLabelText('Resend API key')).toBeInTheDocument();
    expect(screen.getByLabelText('From address')).toBeInTheDocument();
    // Not connected → the toggles show the calm empty state + are disabled.
    expect(screen.getByText(/Connect Resend .* to turn on email/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Welcome & getting-started/ })).toBeDisabled();
  });

  it('a non-admin sees no connect controls, only their own prefs', async () => {
    asRole('member');
    installMockBridge({
      emailStatus: () => Promise.resolve(connected),
      emailGetPrefs: () =>
        Promise.resolve({
          schemaVersion: 1,
          address: 'me@inbox.example',
          families: {},
          richness: 'brief',
          intimacyEmailOptIn: false,
          paused: false,
          digestDay: 0,
          digestTime: 'evening' as const,
          unsubscribeToken: 't',
        }),
    });
    render(<EmailSettingsPanel />);
    expect(await screen.findByLabelText('Email me at')).toHaveValue('me@inbox.example');
    expect(screen.queryByText('Connect Resend')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Resend API key')).not.toBeInTheDocument();
    // Connected → the welcome toggle is enabled.
    expect(screen.getByRole('switch', { name: /Welcome & getting-started/ })).toBeEnabled();
  });

  it('saving the engagement address calls emailSetPrefs', async () => {
    asRole('member');
    const setPrefs = vi.fn(() =>
      Promise.resolve({
        schemaVersion: 1 as const,
        address: 'new@inbox.example',
        families: {},
        richness: 'brief' as const,
        intimacyEmailOptIn: false,
        paused: false,
        digestDay: 0,
        digestTime: 'evening' as const,
        unsubscribeToken: 't',
      }),
    );
    installMockBridge({
      emailStatus: () => Promise.resolve(connected),
      emailGetPrefs: () => Promise.resolve(null),
      emailSetPrefs: setPrefs,
    });
    render(<EmailSettingsPanel />);
    await userEvent.type(await screen.findByLabelText('Email me at'), 'new@inbox.example');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(setPrefs).toHaveBeenCalledWith({ address: 'new@inbox.example' });
  });

  it('the digest day/time controls persist via emailSetPrefs (67 §3.2a / Phase 3)', async () => {
    asRole('member');
    const setPrefs = vi.fn((input) =>
      Promise.resolve({
        schemaVersion: 1 as const,
        address: 'me@inbox.example',
        families: {},
        richness: 'brief' as const,
        intimacyEmailOptIn: false,
        paused: false,
        digestDay: input.digestDay ?? 0,
        digestTime: input.digestTime ?? ('evening' as const),
        unsubscribeToken: 't',
      }),
    );
    installMockBridge({
      emailStatus: () => Promise.resolve(connected),
      emailGetPrefs: () =>
        Promise.resolve({
          schemaVersion: 1,
          address: 'me@inbox.example',
          families: {},
          richness: 'brief',
          intimacyEmailOptIn: false,
          paused: false,
          digestDay: 0,
          digestTime: 'evening',
          unsubscribeToken: 't',
        }),
      emailSetPrefs: setPrefs,
    });
    render(<EmailSettingsPanel />);
    // The weekly-digest toggle is on → the day/time controls render.
    await userEvent.selectOptions(await screen.findByLabelText('Digest day'), '2'); // Tuesday
    expect(setPrefs).toHaveBeenCalledWith({ digestDay: 2 });
    await userEvent.selectOptions(screen.getByLabelText('Time of day'), 'morning');
    expect(setPrefs).toHaveBeenCalledWith({ digestTime: 'morning' });
  });

  it('shows the email response history and edits a response (67 §3.6 / Phase 4)', async () => {
    asRole('member');
    const editResponse = vi.fn(() =>
      Promise.resolve({
        id: 'r1',
        schemaVersion: 1 as const,
        family: 're-engagement' as const,
        kind: 'reaction' as const,
        answer: 'Come back soon',
        sensitivity: 'standard' as const,
        respondedAt: '2026-08-21T09:00:00.000Z',
        source: 'relay-tap' as const,
        edited: true,
      }),
    );
    installMockBridge({
      emailStatus: () => Promise.resolve(connected),
      emailGetPrefs: () => Promise.resolve(null),
      emailResponses: () =>
        Promise.resolve([
          {
            id: 'r1',
            schemaVersion: 1,
            family: 're-engagement',
            kind: 'reaction',
            answer: 'im-here',
            sensitivity: 'standard',
            respondedAt: '2026-08-21T09:00:00.000Z',
            source: 'relay-tap',
            edited: false,
          },
        ]),
      emailEditResponse: editResponse,
    });
    render(<EmailSettingsPanel />);
    expect(await screen.findByText('Your email responses')).toBeInTheDocument();
    expect(screen.getByText(/im-here/)).toBeInTheDocument(); // the drained response's answer
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const field = screen.getByLabelText('Edit response');
    await userEvent.clear(field);
    await userEvent.type(field, 'Come back soon');
    await userEvent.click(screen.getByRole('button', { name: 'Save response' }));
    expect(editResponse).toHaveBeenCalledWith({ id: 'r1', answer: 'Come back soon' });
  });
});

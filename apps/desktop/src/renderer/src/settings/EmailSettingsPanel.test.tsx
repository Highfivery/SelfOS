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
  intimacyEligible: false,
};
const connected: EmailStatus = {
  ...notConnected,
  configured: true,
  resolvedReady: true,
  source: 'device',
  intimacyEligible: false,
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
    // An owner sees "Admin only" on both the connect section AND the Email-activity view.
    expect(screen.getAllByText('Admin only').length).toBeGreaterThanOrEqual(1);
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

  it('toggles the AI-suggestion + intimacy families (67 §3.3 / Phase 5)', async () => {
    asRole('member');
    const setPrefs = vi.fn(() =>
      Promise.resolve({
        schemaVersion: 1 as const,
        address: 'me@inbox.example',
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
      // 18+-acknowledged → the intimacy toggle renders (not the ack affordance).
      emailStatus: () => Promise.resolve({ ...connected, intimacyEligible: true }),
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
    await userEvent.click(await screen.findByRole('switch', { name: /AI coach suggestions/ }));
    expect(setPrefs).toHaveBeenCalledWith({ families: { 'ai-suggestion': false } });
    // The intimacy toggle flips BOTH the family AND the distinct intimacy-email opt-in (67 §8.2).
    await userEvent.click(screen.getByRole('switch', { name: /Intimacy suggestions by email/ }));
    expect(setPrefs).toHaveBeenCalledWith({
      families: { 'ai-suggestion-intimacy': true },
      intimacyEmailOptIn: true,
    });
  });

  it('offers the 18+ acknowledgement when not yet eligible, then enables intimacy email (67 §8.2)', async () => {
    asRole('member');
    const ack = vi.fn(() =>
      Promise.resolve({
        configured: true,
        domainVerified: false,
        hasSharedKey: false,
        hasDeviceOverride: true,
        resolvedReady: true,
        source: 'device' as const,
        intimacyEligible: true,
      }),
    );
    const setPrefs = vi.fn(() =>
      Promise.resolve({
        schemaVersion: 1 as const,
        address: 'me@inbox.example',
        families: {},
        richness: 'brief' as const,
        intimacyEmailOptIn: true,
        paused: false,
        digestDay: 0,
        digestTime: 'evening' as const,
        unsubscribeToken: 't',
      }),
    );
    installMockBridge({
      emailStatus: () => Promise.resolve({ ...connected, intimacyEligible: false }),
      emailGetPrefs: () => Promise.resolve(null),
      emailAcknowledgeAdult: ack,
      emailSetPrefs: setPrefs,
    });
    render(<EmailSettingsPanel />);
    // Not eligible → no toggle, an 18+ affordance instead.
    expect(
      screen.queryByRole('switch', { name: /Intimacy suggestions by email/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /I’m 18\+/ }));
    expect(ack).toHaveBeenCalled();
    expect(setPrefs).toHaveBeenCalledWith({
      families: { 'ai-suggestion-intimacy': true },
      intimacyEmailOptIn: true,
    });
  });

  it('shows the mutual green light + intimacy-inventory offer surfaces (67 §3.6 / Phase 5)', async () => {
    asRole('member');
    const applyOffer = vi.fn(() => Promise.resolve(true));
    installMockBridge({
      emailStatus: () => Promise.resolve(connected),
      emailGetPrefs: () => Promise.resolve(null),
      emailMutualGreenLights: () =>
        Promise.resolve([
          { partnerId: 'b', partnerName: 'Bea', label: 'an idea', sharedSuggestionKey: 'sk1' },
        ]),
      emailIntimacyOffers: () =>
        Promise.resolve([{ actKey: 'act-1', actLabel: 'Sensual massage', currentRating: 2 }]),
      emailApplyIntimacyOffer: applyOffer,
    });
    render(<EmailSettingsPanel />);
    expect(await screen.findByText(/You’re both up for this/)).toBeInTheDocument();
    expect(screen.getByText(/Bea/)).toBeInTheDocument();
    expect(screen.getByText('Sensual massage')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add it' }));
    expect(applyOffer).toHaveBeenCalledWith({ actKey: 'act-1' });
  });

  it('shows the owner Email-activity view for an admin, with delivery health (67 §3.7 / Phase 6)', async () => {
    asRole('owner');
    installMockBridge({
      emailStatus: () => Promise.resolve(connected),
      emailGetPrefs: () => Promise.resolve(null),
      emailAllActivity: () =>
        Promise.resolve([
          {
            id: 'a1',
            schemaVersion: 1,
            personId: 'p1',
            personName: 'Ben',
            family: 'welcome',
            subject: 'Welcome to SelfOS',
            toAddress: 'ben@inbox.example',
            status: 'delivered',
            clicks: [],
            tokens: [],
            sentAt: '2026-08-20T09:00:00.000Z',
          },
          {
            id: 'a2',
            schemaVersion: 1,
            personId: 'p2',
            personName: 'Angel',
            family: 'digest',
            subject: 'Your week on SelfOS',
            toAddress: 'angel@inbox.example',
            status: 'bounced',
            clicks: [],
            tokens: [],
            sentAt: '2026-08-21T09:00:00.000Z',
          },
        ]),
    });
    render(<EmailSettingsPanel />);
    expect(await screen.findByText('Email activity')).toBeInTheDocument();
    expect(screen.getByText('Welcome to SelfOS')).toBeInTheDocument();
    // "Angel" appears in both the member filter option and the table row.
    expect(screen.getAllByText('Angel').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Delivery health: 1 bounced/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
  });

  it('hides the owner Email-activity view from a non-admin member', async () => {
    asRole('member');
    installMockBridge({
      emailStatus: () => Promise.resolve(connected),
      emailGetPrefs: () => Promise.resolve(null),
    });
    render(<EmailSettingsPanel />);
    // The per-person prefs render, but the household-wide activity view never does.
    expect(await screen.findByLabelText('Email me at')).toBeInTheDocument();
    expect(screen.queryByText('Email activity')).not.toBeInTheDocument();
  });

  it('toggles the milestone family (67 §3.2 F / Phase 6)', async () => {
    asRole('member');
    const setPrefs = vi.fn(() =>
      Promise.resolve({
        schemaVersion: 1 as const,
        address: 'me@inbox.example',
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
    await userEvent.click(await screen.findByRole('switch', { name: /Milestones & celebrations/ }));
    expect(setPrefs).toHaveBeenCalledWith({ families: { milestone: false } });
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HouseholdGate } from './HouseholdGate';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';
import { useSessionStore } from '../stores/sessionStore';

const FRESH = {
  vaultInitialized: false,
  hasMasterKey: false,
  hasOwner: false,
  activePersonId: null,
  pendingJoinPersonId: null,
};

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ status: null, activePerson: null, loaded: false });
});

describe('HouseholdGate', () => {
  // The three-way routing of 10-multi-device-vault §3.1: vaultInitialized × hasMasterKey.
  it('shows Setup for a fresh vault (uninitialized, no device key)', async () => {
    installMockBridge({
      householdStatus: () =>
        Promise.resolve({
          vaultInitialized: false,
          hasMasterKey: false,
          hasOwner: false,
          activePersonId: null,
          pendingJoinPersonId: null,
        }),
    });
    render(<HouseholdGate />);
    expect(await screen.findByText('Create your profile')).toBeInTheDocument();
  });

  it('warns instead of Setup when a fresh folder is still syncing from iCloud (29 §5.D)', async () => {
    installMockBridge({
      householdStatus: () => Promise.resolve(FRESH),
      vaultSyncReadiness: () => Promise.resolve({ ready: false, reason: 'icloud-pending' }),
    });
    render(<HouseholdGate />);
    expect(await screen.findByText(/still syncing from iCloud/i)).toBeInTheDocument();
    expect(screen.queryByText('Create your profile')).not.toBeInTheDocument();

    // "Set up anyway" is the explicit escape hatch → the Setup wizard.
    await userEvent.click(screen.getByRole('button', { name: /set up anyway/i }));
    expect(await screen.findByText('Create your profile')).toBeInTheDocument();
  });

  it('shows Unlock for an initialized vault on a device that has not joined', async () => {
    installMockBridge({
      householdStatus: () =>
        Promise.resolve({
          vaultInitialized: true,
          hasMasterKey: false,
          hasOwner: false,
          activePersonId: null,
          pendingJoinPersonId: null,
        }),
    });
    render(<HouseholdGate />);
    // The Unlock screen, NOT the Setup wizard — this is the headline bug fix.
    expect(await screen.findByText('This vault is already set up')).toBeInTheDocument();
    expect(screen.queryByText('Create your profile')).not.toBeInTheDocument();
  });

  it('routes the desync row (device key but no recovery.enc) to Unlock, not Setup', async () => {
    installMockBridge({
      householdStatus: () =>
        Promise.resolve({
          vaultInitialized: false,
          hasMasterKey: true,
          hasOwner: false,
          activePersonId: null,
          pendingJoinPersonId: null,
        }),
    });
    render(<HouseholdGate />);
    expect(await screen.findByText('This vault is already set up')).toBeInTheDocument();
    expect(screen.queryByText('Create your profile')).not.toBeInTheDocument();
  });

  it('renders the app once the device holds the key for an initialized vault', async () => {
    installMockBridge(); // default status: vaultInitialized + hasMasterKey + owner active
    render(<HouseholdGate />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument());
    expect(screen.queryByText('Create your profile')).not.toBeInTheDocument();
    expect(screen.queryByText('This vault is already set up')).not.toBeInTheDocument();
  });

  it('routes an interrupted setup (key + recovery.enc, no owner) to Setup, not the picker', async () => {
    installMockBridge({
      householdStatus: () =>
        Promise.resolve({
          vaultInitialized: true,
          hasMasterKey: true,
          hasOwner: false,
          activePersonId: null,
          pendingJoinPersonId: null,
        }),
    });
    render(<HouseholdGate />);
    // Setup finishes the half-built household without re-keying — not a dead-end picker.
    expect(await screen.findByText('Create your profile')).toBeInTheDocument();
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
  });

  it('shows the person picker when the key is present but no one is active (freshly-joined device)', async () => {
    installMockBridge({
      householdStatus: () =>
        Promise.resolve({
          vaultInitialized: true,
          hasMasterKey: true,
          hasOwner: true,
          activePersonId: null,
          pendingJoinPersonId: null,
        }),
    });
    render(<HouseholdGate />);
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
  });

  it('resumes the "set your PIN" step when a member redeemed but has not finished joining', async () => {
    installMockBridge({
      householdStatus: () =>
        Promise.resolve({
          vaultInitialized: true,
          hasMasterKey: true,
          hasOwner: true,
          activePersonId: null,
          pendingJoinPersonId: 'wife-1',
        }),
    });
    render(<HouseholdGate />);
    // Not the open picker — the PIN step, so the redeemed member must set a PIN before getting in.
    expect(await screen.findByRole('heading', { name: 'Set your PIN' })).toBeInTheDocument();
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
  });
});

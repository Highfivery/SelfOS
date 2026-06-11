import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HouseholdGate } from './HouseholdGate';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';
import { useSessionStore } from '../stores/sessionStore';

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
        }),
    });
    render(<HouseholdGate />);
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
        }),
    });
    render(<HouseholdGate />);
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
  });
});

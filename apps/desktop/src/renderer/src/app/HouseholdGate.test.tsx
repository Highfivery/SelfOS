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
  it('shows setup when no owner exists yet', async () => {
    installMockBridge({
      householdStatus: () =>
        Promise.resolve({ hasMasterKey: false, hasOwner: false, activePersonId: null }),
    });
    render(<HouseholdGate />);
    expect(await screen.findByText('Create your profile')).toBeInTheDocument();
  });

  it('renders the app once the household is set up', async () => {
    installMockBridge(); // default status has an owner
    render(<HouseholdGate />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument());
    expect(screen.queryByText('Create your profile')).not.toBeInTheDocument();
  });
});

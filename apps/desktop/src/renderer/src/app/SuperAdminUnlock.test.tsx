import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SuperAdminUnlock } from './SuperAdminUnlock';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';
import { useSessionStore } from '../stores/sessionStore';

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ superAdmin: false, unlockPromptOpen: true });
});

describe('SuperAdminUnlock', () => {
  it('enters super-admin mode on the correct passphrase', async () => {
    installMockBridge(); // mock accepts 'superpass'
    useSessionStore.setState({ superAdmin: false, unlockPromptOpen: true });
    render(<SuperAdminUnlock />);
    await userEvent.type(screen.getByLabelText('Passphrase'), 'superpass');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(useSessionStore.getState().superAdmin).toBe(true));
  });

  it('shows an error and stays locked on a wrong passphrase', async () => {
    installMockBridge();
    useSessionStore.setState({ superAdmin: false, unlockPromptOpen: true });
    render(<SuperAdminUnlock />);
    await userEvent.type(screen.getByLabelText('Passphrase'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(screen.getByText(/didn.t match/i)).toBeInTheDocument());
    expect(useSessionStore.getState().superAdmin).toBe(false);
  });
});

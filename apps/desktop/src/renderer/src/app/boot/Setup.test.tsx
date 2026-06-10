import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Setup } from './Setup';
import { clearMockBridge, installMockBridge } from '../../test-utils/bridge';
import { useSessionStore } from '../../stores/sessionStore';

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ status: null, activePerson: null, loaded: false });
});

async function fillValidForm(): Promise<void> {
  await userEvent.type(screen.getByLabelText('Your name'), 'Alex');
  await userEvent.type(screen.getByLabelText('Super-admin passphrase'), 'hunter2');
  await userEvent.type(screen.getByLabelText('Confirm passphrase'), 'hunter2');
}

describe('Setup', () => {
  it('keeps submit disabled until the form is valid', async () => {
    installMockBridge();
    render(<Setup />);
    const submit = screen.getByRole('button', { name: /create profile/i });
    expect(submit).toBeDisabled();
    await fillValidForm();
    expect(submit).toBeEnabled();
  });

  it('runs setup and shows the recovery phrase once', async () => {
    const householdSetup = vi.fn(() =>
      Promise.resolve({ recoveryPhrase: 'AAAA-BBBB-CCCC', ownerId: 'o1' }),
    );
    installMockBridge({ householdSetup });
    render(<Setup />);
    await fillValidForm();
    await userEvent.click(screen.getByRole('button', { name: /create profile/i }));
    expect(householdSetup).toHaveBeenCalledWith({ ownerName: 'Alex', passphrase: 'hunter2' });
    expect(await screen.findByText('AAAA-BBBB-CCCC')).toBeInTheDocument();
  });

  it('flags a passphrase mismatch', async () => {
    installMockBridge();
    render(<Setup />);
    await userEvent.type(screen.getByLabelText('Super-admin passphrase'), 'hunter2');
    await userEvent.type(screen.getByLabelText('Confirm passphrase'), 'hunterX');
    expect(screen.getByText(/passphrases don.t match/i)).toBeInTheDocument();
  });
});

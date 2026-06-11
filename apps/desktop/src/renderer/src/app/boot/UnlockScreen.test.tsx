import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnlockScreen } from './UnlockScreen';
import { clearMockBridge, installMockBridge } from '../../test-utils/bridge';
import { useSessionStore } from '../../stores/sessionStore';

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ status: null, activePerson: null, access: null, loaded: false });
});

describe('UnlockScreen', () => {
  it('disables Unlock until a recovery phrase is entered', () => {
    installMockBridge();
    render(<UnlockScreen />);
    expect(
      screen.getByRole('heading', { name: 'This vault is already set up' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled();
  });

  it('restores the device key from the (trimmed) recovery phrase', async () => {
    const unlockWithRecoveryPhrase = vi.fn(() => Promise.resolve({ ok: true }));
    installMockBridge({ unlockWithRecoveryPhrase });
    render(<UnlockScreen />);

    await userEvent.type(screen.getByLabelText('Recovery phrase'), '  my recovery phrase  ');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(unlockWithRecoveryPhrase).toHaveBeenCalledWith({ phrase: 'my recovery phrase' });
  });

  it('shows an error on a non-matching phrase and keeps the input', async () => {
    installMockBridge({ unlockWithRecoveryPhrase: () => Promise.resolve({ ok: false }) });
    render(<UnlockScreen />);

    await userEvent.type(screen.getByLabelText('Recovery phrase'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(await screen.findByText(/match this vault/)).toBeInTheDocument();
    expect(screen.getByLabelText('Recovery phrase')).toHaveValue('nope');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangeVaultDialog } from './ChangeVaultDialog';
import { useAppStore } from '../stores/appStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';
import type { BootState } from '@shared/schemas';

const ONBOARDING: BootState = { phase: 'onboarding', vaultPath: null, hasSettings: false };

afterEach(() => {
  clearMockBridge();
  vi.restoreAllMocks();
  useAppStore.setState({ phase: 'ready', vaultPath: '/v', busy: false });
});

describe('ChangeVaultDialog', () => {
  it('explains the consequences and warns about the recovery phrase', () => {
    installMockBridge();
    render(<ChangeVaultDialog onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Change vault' })).toBeInTheDocument();
    expect(screen.getByText(/nothing is deleted/i)).toBeInTheDocument();
    expect(screen.getByText(/choose a new folder next/i)).toBeInTheDocument();
    expect(screen.getByText(/recovery phrase/i)).toBeInTheDocument();
  });

  it('Cancel closes without unlinking', async () => {
    const onClose = vi.fn();
    const unlinkVault = vi.fn(() => Promise.resolve(ONBOARDING));
    installMockBridge({ unlinkVault });
    render(<ChangeVaultDialog onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(unlinkVault).not.toHaveBeenCalled();
  });

  it('Esc closes without unlinking', async () => {
    const onClose = vi.fn();
    const unlinkVault = vi.fn(() => Promise.resolve(ONBOARDING));
    installMockBridge({ unlinkVault });
    render(<ChangeVaultDialog onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(unlinkVault).not.toHaveBeenCalled();
  });

  it('scrim click closes without unlinking', async () => {
    const onClose = vi.fn();
    const unlinkVault = vi.fn(() => Promise.resolve(ONBOARDING));
    installMockBridge({ unlinkVault });
    const { container } = render(<ChangeVaultDialog onClose={onClose} />);
    await userEvent.click(container.firstChild as Element); // the overlay/scrim
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(unlinkVault).not.toHaveBeenCalled();
  });

  it('Continue detaches via the bridge and routes to onboarding', async () => {
    const unlinkVault = vi.fn(() => Promise.resolve(ONBOARDING));
    installMockBridge({ unlinkVault });
    useAppStore.setState({ phase: 'ready', vaultPath: '/v', busy: false });
    render(<ChangeVaultDialog onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(unlinkVault).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().phase).toBe('onboarding');
  });

  it('surfaces a calm error and stays linked if the detach fails', async () => {
    installMockBridge({ unlinkVault: () => Promise.reject(new Error('boom')) });
    useAppStore.setState({ phase: 'ready', vaultPath: '/v', busy: false });
    render(<ChangeVaultDialog onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(useAppStore.getState().phase).toBe('ready');
  });
});

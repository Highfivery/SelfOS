import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VaultError } from './VaultError';
import { useAppStore } from '../../stores/appStore';

afterEach(() => {
  vi.restoreAllMocks();
  useAppStore.setState({ phase: 'starting', vaultPath: null, busy: false });
});

describe('VaultError', () => {
  it('shows the unreachable vault path and offers Retry + Use a different vault', () => {
    useAppStore.setState({ phase: 'vault-error', vaultPath: '/gone' });
    render(<VaultError />);
    expect(screen.getByRole('heading', { name: /isn’t reachable/i })).toBeInTheDocument();
    expect(screen.getByText(/\/gone/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /use a different vault/i })).toBeEnabled();
  });

  it('Retry re-checks the same vault and does NOT unlink (the key may just be offline)', async () => {
    const refresh = vi.spyOn(useAppStore.getState(), 'refresh').mockResolvedValue();
    const unlink = vi.spyOn(useAppStore.getState(), 'unlink').mockResolvedValue();
    render(<VaultError />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(unlink).not.toHaveBeenCalled();
  });

  it('Use a different vault unlinks (key-safe) instead of re-pointing directly', async () => {
    const unlink = vi.spyOn(useAppStore.getState(), 'unlink').mockResolvedValue();
    render(<VaultError />);
    await userEvent.click(screen.getByRole('button', { name: /use a different vault/i }));
    expect(unlink).toHaveBeenCalledTimes(1);
  });
});

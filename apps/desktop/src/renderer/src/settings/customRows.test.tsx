import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangeVaultRow } from './customRows';
import { useAppStore } from '../stores/appStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useAppStore.setState({ phase: 'ready', vaultPath: '/v', busy: false });
});

describe('ChangeVaultRow', () => {
  it('opens the confirmation dialog when clicked, with no admin-only gate', async () => {
    installMockBridge();
    render(<ChangeVaultRow />);
    // Available to any signed-in person — no "Admin only" marker (14-vault-relinking decision #3).
    expect(screen.queryByText(/admin only/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /change vault/i }));
    expect(screen.getByRole('dialog', { name: 'Change vault' })).toBeInTheDocument();
  });
});

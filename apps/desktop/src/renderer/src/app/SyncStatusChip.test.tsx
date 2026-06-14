import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SyncStatusChip } from './SyncStatusChip';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

afterEach(clearMockBridge);

describe('SyncStatusChip', () => {
  it('reads "all synced" when there are no conflicts and opens the vault folder on click', async () => {
    let revealed = 0;
    installMockBridge({
      revealVault: () => {
        revealed += 1;
        return Promise.resolve();
      },
    });
    render(<SyncStatusChip conflicts={[]} />);
    const chip = screen.getByRole('button', { name: 'Vault: all synced — open the vault folder' });
    await userEvent.click(chip);
    expect(revealed).toBe(1);
  });

  it('surfaces the conflict count and opens the vault folder when there are conflicts', async () => {
    let revealed = 0;
    installMockBridge({
      revealVault: () => {
        revealed += 1;
        return Promise.resolve();
      },
    });
    render(<SyncStatusChip conflicts={['/vault/a.enc.conflict', '/vault/b.enc.conflict']} />);
    const chip = screen.getByRole('button', {
      name: '2 sync conflicts — open the vault folder to resolve',
    });
    await userEvent.click(chip);
    expect(revealed).toBe(1);
  });

  it('singularizes a single conflict', () => {
    installMockBridge();
    render(<SyncStatusChip conflicts={['/vault/a.enc.conflict']} />);
    expect(
      screen.getByRole('button', { name: '1 sync conflict — open the vault folder to resolve' }),
    ).toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AboutVersion, ChangeVaultRow } from './customRows';
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

describe('AboutVersion', () => {
  it('shows the version from the bridge enriched with the build SHA + date (19-distribution §3.3)', async () => {
    installMockBridge({ getAppVersion: () => Promise.resolve('1.2.3') });
    render(<AboutVersion />);
    // Build the expected string from the same `define` globals the component reads (same filter), so
    // the assertion holds whether or not a SHA/date is present in this environment.
    const detail = [__BUILD_SHA__, __BUILD_DATE__].filter((p) => p && p !== 'dev').join(' · ');
    const expected = detail ? `v1.2.3 · ${detail}` : 'v1.2.3';
    await waitFor(() => expect(screen.getByText(expected)).toBeInTheDocument());
  });
});

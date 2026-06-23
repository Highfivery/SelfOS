import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UpdateCheckResult } from '@shared/channels';
import { AboutVersion, ChangeVaultRow, CheckForUpdatesControl } from './customRows';
import { useAppStore } from '../stores/appStore';
import { useUpdateStore } from '../stores/updateStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useAppStore.setState({ phase: 'ready', vaultPath: '/v', busy: false });
  useUpdateStore.setState({ result: null, status: 'idle', errored: false, lastAttemptAt: null });
});

const AVAILABLE: UpdateCheckResult = {
  current: '0.4.0',
  latest: '0.5.0',
  isUpdateAvailable: true,
  releaseUrl: 'https://github.com/Highfivery/SelfOS/releases/tag/v0.5.0',
  checkedAt: '2026-06-23T00:00:00.000Z',
};

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

describe('CheckForUpdatesControl', () => {
  it('runs a forced check when clicked', async () => {
    const updatesCheck = vi.fn(() => Promise.resolve(null));
    installMockBridge({ updatesCheck });
    render(<CheckForUpdatesControl />);
    await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(updatesCheck).toHaveBeenCalledWith(true);
  });

  it('shows a busy state with aria-busy while checking', () => {
    useUpdateStore.setState({ status: 'checking' });
    installMockBridge();
    render(<CheckForUpdatesControl />);
    const button = screen.getByRole('button', { name: 'Checking…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('shows "up to date" when the latest equals the running version', () => {
    useUpdateStore.setState({
      result: { ...AVAILABLE, latest: '0.4.0', isUpdateAvailable: false },
      status: 'idle',
      errored: false,
    });
    installMockBridge();
    render(<CheckForUpdatesControl />);
    expect(screen.getByText(/up to date \(v0\.4\.0\)/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View release' })).not.toBeInTheDocument();
  });

  it('shows the available state and opens the release page externally', async () => {
    const openExternal = vi.fn(() => Promise.resolve());
    useUpdateStore.setState({ result: AVAILABLE, status: 'idle', errored: false });
    installMockBridge({ openExternal });
    render(<CheckForUpdatesControl />);
    expect(screen.getByText(/update available: v0\.5\.0/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View release' }));
    expect(openExternal).toHaveBeenCalledWith(AVAILABLE.releaseUrl);
  });

  it('shows a calm error when the check couldn’t be made', () => {
    useUpdateStore.setState({ status: 'idle', errored: true, result: null });
    installMockBridge();
    render(<CheckForUpdatesControl />);
    expect(screen.getByText(/couldn’t check right now/i)).toBeInTheDocument();
  });
});

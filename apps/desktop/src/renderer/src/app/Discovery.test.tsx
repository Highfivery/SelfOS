import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiscoveryTip } from './DiscoveryTip';
import { AboutSelfOsDialog } from './AboutSelfOsDialog';
import { WelcomeOrientationCard } from './routes/home/WelcomeOrientationCard';
import { useDiscoveryStore, DISCOVERY_KEYS } from '../stores/discoveryStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

/** Put the store in the "loaded" state with a given set of dismissals (what AppShell does on mount). */
function seedDiscovery(dismissed: string[] = []): void {
  useDiscoveryStore.setState({ dismissed, loaded: true });
}

beforeEach(() => {
  installMockBridge();
  useDiscoveryStore.getState().reset();
});
afterEach(() => {
  clearMockBridge();
  useDiscoveryStore.getState().reset();
});

describe('DiscoveryTip', () => {
  it('renders nothing until the dismissal state has loaded (no flash)', () => {
    render(<DiscoveryTip tipKey={DISCOVERY_KEYS.tipGapFinder}>Try the gap-finder</DiscoveryTip>);
    expect(screen.queryByText('Try the gap-finder')).not.toBeInTheDocument();
  });

  it('shows once, then hides after dismiss (and persists the dismissal)', async () => {
    const setDismissals = vi.fn(() => Promise.resolve());
    installMockBridge({ setDiscoveryDismissals: setDismissals });
    seedDiscovery();
    render(<DiscoveryTip tipKey={DISCOVERY_KEYS.tipGapFinder}>Try the gap-finder</DiscoveryTip>);
    expect(screen.getByText('Try the gap-finder')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /dismiss tip/i }));
    expect(screen.queryByText('Try the gap-finder')).not.toBeInTheDocument();
    expect(setDismissals).toHaveBeenCalledWith([DISCOVERY_KEYS.tipGapFinder]);
  });

  it('stays hidden when already dismissed', () => {
    seedDiscovery([DISCOVERY_KEYS.tipGapFinder]);
    render(<DiscoveryTip tipKey={DISCOVERY_KEYS.tipGapFinder}>Try the gap-finder</DiscoveryTip>);
    expect(screen.queryByText('Try the gap-finder')).not.toBeInTheDocument();
  });
});

describe('WelcomeOrientationCard', () => {
  it('shows the orientation for a first-time person and the not-medical line', () => {
    seedDiscovery();
    render(<WelcomeOrientationCard />);
    expect(screen.getByRole('heading', { name: /how selfos works/i })).toBeInTheDocument();
    expect(screen.getByText(/not medical care/i)).toBeInTheDocument();
  });

  it('dismisses and does not re-show', async () => {
    seedDiscovery();
    const { rerender } = render(<WelcomeOrientationCard />);
    await userEvent.click(screen.getByRole('button', { name: /dismiss welcome/i }));
    rerender(<WelcomeOrientationCard />);
    expect(screen.queryByRole('heading', { name: /how selfos works/i })).not.toBeInTheDocument();
  });

  it('renders nothing before the dismissal state loads', () => {
    render(<WelcomeOrientationCard />); // store not loaded
    expect(screen.queryByRole('heading', { name: /how selfos works/i })).not.toBeInTheDocument();
  });
});

describe('AboutSelfOsDialog', () => {
  it('renders the orientation content and closes', async () => {
    const onClose = vi.fn();
    render(<AboutSelfOsDialog onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: /about selfos/i })).toBeInTheDocument();
    expect(screen.getByText(/not medical care/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /got it/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

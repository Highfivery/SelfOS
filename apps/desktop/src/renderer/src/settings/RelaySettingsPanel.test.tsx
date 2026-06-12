import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RelaySettingsPanel } from './RelaySettingsPanel';
import { useRelayStore } from '../stores/relayStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useRelayStore.setState({ status: null, loaded: false });
});

describe('RelaySettingsPanel', () => {
  it('shows the connect form when no relay is configured', () => {
    installMockBridge();
    useRelayStore.setState({ status: { configured: false, updateAvailable: false }, loaded: true });
    render(<RelaySettingsPanel />);
    expect(screen.getByLabelText(/cloudflare account id/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect & deploy/i })).toBeInTheDocument();
  });

  it('connects with a token + account id and reflects the new status', async () => {
    installMockBridge({
      relayConnect: () =>
        Promise.resolve({
          configured: true,
          endpointUrl: 'https://selfos-relay.acme.workers.dev',
          relayVersion: '1',
          updateAvailable: false,
        }),
    });
    useRelayStore.setState({ status: { configured: false, updateAvailable: false }, loaded: true });
    render(<RelaySettingsPanel />);
    await userEvent.type(screen.getByLabelText(/cloudflare account id/i), 'acct');
    await userEvent.type(screen.getByLabelText(/cloudflare api token/i), 'tok');
    await userEvent.click(screen.getByRole('button', { name: /connect & deploy/i }));
    await waitFor(() =>
      expect(screen.getByText(/selfos-relay\.acme\.workers\.dev/i)).toBeInTheDocument(),
    );
  });

  it('shows the endpoint + remove control when configured', () => {
    installMockBridge();
    useRelayStore.setState({
      status: {
        configured: true,
        endpointUrl: 'https://selfos-relay.acme.workers.dev',
        relayVersion: '1',
        updateAvailable: false,
      },
      loaded: true,
    });
    render(<RelaySettingsPanel />);
    expect(screen.getByText(/relay connected at/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove relay/i })).toBeInTheDocument();
  });
});

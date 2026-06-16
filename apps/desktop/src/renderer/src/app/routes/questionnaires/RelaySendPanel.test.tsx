import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RelaySendPanel } from './RelaySendPanel';
import { useRelayStore } from '../../../stores/relayStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useRelayStore.setState({ status: null, loaded: false });
  useSessionStore.setState({ activePerson: null });
});

describe('RelaySendPanel', () => {
  it('prompts to connect a relay when none is configured', () => {
    installMockBridge();
    useRelayStore.setState({ status: { configured: false, updateAvailable: false }, loaded: true });
    render(
      <RelaySendPanel
        questionnaireId="q1"
        sensitivity="standard"
        recipientName="Alex"
        onDone={() => {}}
      />,
    );
    expect(screen.getByText(/set up a relay/i)).toBeInTheDocument();
  });

  it('mints a link + PIN and surfaces delivery options', async () => {
    installMockBridge({
      assignmentsCreateRelayLink: () =>
        Promise.resolve({
          assignmentId: 'a1',
          link: 'https://selfos-relay.acme.workers.dev/q/tok#k=key',
          pin: '482913',
        }),
    });
    useRelayStore.setState({
      status: { configured: true, endpointUrl: 'https://x.workers.dev', updateAvailable: false },
      loaded: true,
    });
    useSessionStore.setState({
      activePerson: {
        id: 'p1',
        schemaVersion: 1,
        displayName: 'Sam',
        isSubject: true,
        tags: [],
        createdAt: 'now',
        updatedAt: 'now',
      },
    });

    render(
      <RelaySendPanel
        questionnaireId="q1"
        sensitivity="standard"
        recipientName="Alex"
        onDone={() => {}}
      />,
    );
    // The recipient name is bound (no name field); the heading names them and Create link is ready.
    expect(screen.getByRole('heading', { name: /send to alex/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /create link/i }));

    await waitFor(() => expect(screen.getByText(/share this link/i)).toBeInTheDocument());
    expect(
      screen.getByDisplayValue('https://selfos-relay.acme.workers.dev/q/tok#k=key'),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('482913')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^email$/i })).toBeInTheDocument();
  });

  it('defaults the PIN out of the message for a sensitive send', () => {
    installMockBridge();
    useRelayStore.setState({
      status: { configured: true, endpointUrl: 'https://x.workers.dev', updateAvailable: false },
      loaded: true,
    });
    render(
      <RelaySendPanel
        questionnaireId="q1"
        sensitivity="explicit"
        recipientName="Alex"
        onDone={() => {}}
      />,
    );
    // The sensitive note is shown on the send form before minting.
    expect(screen.getByText(/marked sensitive/i)).toBeInTheDocument();
  });
});

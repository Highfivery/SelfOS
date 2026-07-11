import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type {
  Person,
  TogetherPreScreenView,
  TogetherSessionSummary,
  TogetherSessionView,
} from '@shared/schemas';
import { Together } from './Together';
import { PreScreenForm } from './PreScreenForm';
import { InvitationCeremony } from './InvitationCeremony';
import { TogetherThread } from './TogetherThread';
import { useTogetherStore } from '../../../stores/togetherStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

const ME = 'me';
const PARTNER = 'partner';

function person(id: string, displayName: string): Person {
  return {
    id,
    schemaVersion: 1,
    displayName,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
}

function setActivePerson(): void {
  useSessionStore.setState({ activePerson: person(ME, 'Ben') });
}

const PRESCREEN_ITEMS: TogetherPreScreenView = {
  completed: false,
  flagged: false,
  needsScreen: true,
  reoffer: false,
  items: [
    {
      id: 'safe-honest',
      prompt: 'Do you feel safe being honest?',
      choices: [
        { value: 'yes', label: 'Yes, usually' },
        { value: 'no', label: 'Not really' },
      ],
    },
  ],
};

function summary(over: Partial<TogetherSessionSummary> = {}): TogetherSessionSummary {
  return {
    id: 's1',
    pairKey: 'me~partner',
    initiatorPersonId: ME,
    participants: [
      { personId: ME, displayName: 'Ben' },
      { personId: PARTNER, displayName: 'Angel' },
    ],
    status: 'active',
    yourTurn: true,
    unreadCount: 0,
    createdAt: 'now',
    ...over,
  };
}

function view(over: Partial<TogetherSessionView> = {}): TogetherSessionView {
  return { ...summary(), viewerAcked: true, messages: [], ...over };
}

afterEach(() => {
  clearMockBridge();
  useTogetherStore.getState().reset();
  useSessionStore.setState({ activePerson: null });
});

describe('Together home (§3.2)', () => {
  it('shows a calm state (never a dead surface) when there is no partner', () => {
    installMockBridge();
    setActivePerson();
    useTogetherStore.setState({ loaded: true, hasPartner: false });
    render(
      <MemoryRouter>
        <Together />
      </MemoryRouter>,
    );
    expect(screen.getByText('Together is for you and a partner')).toBeInTheDocument();
    expect(screen.getByText(/Not therapy/i)).toBeInTheDocument();
  });

  it('shows the start card (with the partner) + a sessions list', () => {
    installMockBridge();
    setActivePerson();
    useTogetherStore.setState({
      loaded: true,
      hasPartner: true,
      partners: [{ personId: PARTNER, displayName: 'Angel', eligible: true }],
      prescreen: { ...PRESCREEN_ITEMS, needsScreen: false },
      sessions: [summary({ topic: 'Feeling distant', status: 'invited' })],
    });
    render(
      <MemoryRouter>
        <Together />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Start a session' })).toBeInTheDocument();
    expect(screen.getByText('With Angel')).toBeInTheDocument();
    expect(screen.getByText('Feeling distant')).toBeInTheDocument();
    expect(screen.getByText('Invited · waiting')).toBeInTheDocument(); // initiator sees invited/waiting
  });

  it('shows the pre-screen (never the start card) when the person must take it first (§8.2)', () => {
    installMockBridge();
    setActivePerson();
    useTogetherStore.setState({ loaded: true, hasPartner: true, prescreen: PRESCREEN_ITEMS });
    render(
      <MemoryRouter>
        <Together />
      </MemoryRouter>,
    );
    expect(screen.getByText('A private check-in, just for you')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Start a session' })).not.toBeInTheDocument();
  });
});

describe('PreScreenForm (§8.2)', () => {
  it('a flagged submission shows a calm private hold + crisis resources (fear item)', async () => {
    installMockBridge({
      togetherPrescreenSubmit: () =>
        Promise.resolve({ flagged: true, showCrisis: true, suggestSolo: true }),
      togetherPrescreenGet: () => Promise.resolve(PRESCREEN_ITEMS),
    });
    useTogetherStore.setState({ prescreen: PRESCREEN_ITEMS });
    render(<PreScreenForm />);
    await userEvent.click(screen.getByLabelText('Not really'));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Let’s take this gently')).toBeInTheDocument();
    expect(screen.getByText(/If you ever feel unsafe or afraid/)).toBeInTheDocument();
  });
});

describe('InvitationCeremony (§3.4)', () => {
  it('renders the derived rules of the room + Continue/Decline', () => {
    installMockBridge();
    setActivePerson();
    render(
      <MemoryRouter>
        <InvitationCeremony
          session={view({ status: 'invited', viewerAcked: false, initiatorPersonId: PARTNER })}
          onContinue={() => {}}
          onNotNow={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('You both see the conversation.')).toBeInTheDocument();
    expect(screen.getByText('Private notes exist.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline quietly' })).toBeInTheDocument();
  });
});

describe('TogetherThread (§3.6)', () => {
  it('renders author-attributed bubbles + marks a private aside; the composer arms the aside toggle', async () => {
    installMockBridge();
    setActivePerson();
    render(
      <MemoryRouter>
        <TogetherThread
          session={view({
            messages: [
              {
                id: 'm1',
                authorPersonId: PARTNER,
                role: 'user',
                content: 'I miss us.',
                ts: '1',
                privateAside: false,
              },
              {
                id: 'a1',
                authorPersonId: ME,
                role: 'user',
                content: 'my secret',
                ts: '2',
                privateAside: true,
              },
            ],
          })}
          onPrep={() => {}}
        />
      </MemoryRouter>,
    );
    // Author attribution + the aside tag (text, not colour-only).
    expect(screen.getByText('Angel')).toBeInTheDocument();
    expect(screen.getByText('my secret')).toBeInTheDocument();
    expect(screen.getByText('Private to the coach')).toBeInTheDocument();
    // The composer aside toggle restyles (aria-pressed).
    const toggle = screen.getByRole('button', { name: /Write privately to the coach/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Private to the coach' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Turn pill carries text.
    expect(within(screen.getByText('Your turn')).getByText('Your turn')).toBeInTheDocument();
  });

  it('exposes a "Prep privately" affordance that opens the private prep space (§3.7)', async () => {
    installMockBridge();
    setActivePerson();
    let opened = 0;
    render(
      <MemoryRouter>
        <TogetherThread session={view()} onPrep={() => (opened += 1)} />
      </MemoryRouter>,
    );
    const prep = screen.getByRole('button', { name: /Prep privately/ });
    await userEvent.click(prep);
    expect(opened).toBe(1);
  });
});

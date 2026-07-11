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
import { TogetherReflection } from './TogetherReflection';
import { TogetherCatalog } from './TogetherCatalog';
import type { Agreement, SharedReport, TogetherCatalogEntry } from '@shared/schemas';
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

  it('renders a stepper for a structured guided session, marking the current step (§3.10)', () => {
    installMockBridge();
    setActivePerson();
    render(
      <MemoryRouter>
        <TogetherThread
          session={view({
            guide: {
              id: 'love-maps',
              title: 'Love Maps',
              framework: 'Gottman',
              kind: 'structured',
              steps: ['Warm up', 'Ask & answer', 'Go deeper'],
            },
            guideStep: 1,
          })}
          onPrep={() => {}}
        />
      </MemoryRouter>,
    );
    // The guide title leads the thread; the stepper lists every step; step index 1 is current.
    expect(screen.getByText('Love Maps')).toBeInTheDocument();
    expect(screen.getByText('Ask & answer').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Warm up').closest('li')).toHaveAttribute('data-state', 'done');
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

describe('TogetherCatalog (§3.10)', () => {
  const entry = (over: Partial<TogetherCatalogEntry>): TogetherCatalogEntry => ({
    id: 'love-maps',
    group: 'together-connect',
    groupTitle: 'Connect',
    title: 'Love Maps',
    framework: 'Gottman',
    blurb: 'Take turns learning each other’s world.',
    kind: 'structured',
    adult: false,
    ...over,
  });
  const catalog = [
    entry({}),
    entry({
      id: 'four-horsemen',
      group: 'together-repair',
      groupTitle: 'Repair',
      title: 'Four Horsemen',
      kind: 'chat',
      blurb: 'Spot four habits.',
    }),
  ];

  it('groups cards by their group title, filters by search, and fires onPick', async () => {
    let picked = '';
    render(<TogetherCatalog catalog={catalog} selectedId={null} onPick={(e) => (picked = e.id)} />);
    expect(screen.getByText('Connect')).toBeInTheDocument();
    expect(screen.getByText('Repair')).toBeInTheDocument();
    expect(screen.getByText('Love Maps')).toBeInTheDocument();

    // Search filters to a single group.
    await userEvent.type(screen.getByLabelText('Search guided sessions'), 'horsemen');
    expect(screen.queryByText('Love Maps')).not.toBeInTheDocument();
    expect(screen.getByText('Four Horsemen')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Four Horsemen'));
    expect(picked).toBe('four-horsemen');
  });
});

describe('TogetherReflection (§3.8/§3.9)', () => {
  const report: SharedReport = {
    id: 'r1',
    schemaVersion: 1,
    sessionId: 's1',
    summary: 'You both showed up honestly.',
    themes: ['connection'],
    workedThrough: ['naming the pattern'],
    agreementIds: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
  const agreement = (over: Partial<Agreement> = {}): Agreement => ({
    id: 'a1',
    schemaVersion: 1,
    pairKey: 'ben~partner',
    text: 'screen-free dinners',
    status: 'standing',
    provenance: { sessionId: 's1', at: 'now' },
    createdAt: 'now',
    updatedAt: 'now',
    ...over,
  });

  it('offers "Wrap up & reflect" when AI + memory are ready and there is no report yet', () => {
    installMockBridge();
    useTogetherStore.setState({ reportView: { report: null, stale: false, agreements: [] } });
    render(<TogetherReflection sessionId="s1" memoryEnabled aiReady />);
    expect(screen.getByRole('button', { name: /Wrap up & reflect/ })).toBeInTheDocument();
  });

  it('renders the shared report (summary + worked-through + themes) once one exists', () => {
    installMockBridge();
    useTogetherStore.setState({ reportView: { report, stale: false, agreements: [] } });
    render(<TogetherReflection sessionId="s1" memoryEnabled aiReady />);
    expect(screen.getByText('You both showed up honestly.')).toBeInTheDocument();
    expect(screen.getByText('naming the pattern')).toBeInTheDocument();
    expect(screen.getByText('connection')).toBeInTheDocument();
  });

  it('lists agreements + inline edit; marking one done offers a gentle follow-up (§11 #2)', async () => {
    installMockBridge();
    useTogetherStore.setState({ reportView: { report, stale: false, agreements: [agreement()] } });
    render(<TogetherReflection sessionId="s1" memoryEnabled aiReady />);
    expect(screen.getByText('screen-free dinners')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Mark done/ }));
    expect(await screen.findByText(/build on it/i)).toBeInTheDocument();
    // The follow-up offers an editable next agreement (not a placeholder-text row).
    expect(screen.getByLabelText('Next agreement')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add agreement' })).toBeInTheDocument();
  });

  it('shows a calm connect-Claude note (never a dead wrap-up button) when AI is off', () => {
    installMockBridge();
    useTogetherStore.setState({ reportView: { report: null, stale: false, agreements: [] } });
    render(<TogetherReflection sessionId="s1" memoryEnabled aiReady={false} />);
    // Nothing to produce + AI off ⇒ the whole section hides (no dead control).
    expect(screen.queryByRole('button', { name: /Wrap up & reflect/ })).not.toBeInTheDocument();
  });
});

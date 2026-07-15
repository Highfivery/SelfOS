import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Person, TogetherSessionSummary, TogetherSessionView } from '@shared/schemas';
import { Together } from './Together';
import { InvitationCeremony } from './InvitationCeremony';
import { TogetherThread } from './TogetherThread';
import { TogetherReflection } from './TogetherReflection';
import { TogetherCatalog } from './TogetherCatalog';
import { TogetherIntimacy } from './TogetherIntimacy';
import { TogetherPulse } from './TogetherPulse';
import { TogetherJointChallenges } from './TogetherJointChallenges';
import { TogetherSuggestions } from './TogetherSuggestions';
import { sessionStatus, relativeTime, turnHint, TogetherSessionCard } from './TogetherSessionCard';
import { TogetherSessionsBoard } from './TogetherSessionsBoard';
import type {
  Agreement,
  SharedReport,
  TogetherCatalogEntry,
  TogetherTurnResult,
  TogetherYnmStatus,
} from '@shared/schemas';
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

  it('leads with the partner-scoped dashboard: a "Your sessions" board with rich, status-labelled cards', () => {
    installMockBridge();
    setActivePerson();
    useTogetherStore.setState({
      loaded: true,
      hasPartner: true,
      partners: [{ personId: PARTNER, displayName: 'Angel', eligible: true }],
      sessions: [summary({ topic: 'Feeling distant', status: 'invited' })],
    });
    render(
      <MemoryRouter>
        <Together />
      </MemoryRouter>,
    );
    // The hero names the partner; the sessions board leads (not buried at the bottom).
    expect(screen.getByText('with Angel')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your sessions' })).toBeInTheDocument();
    // The card carries the topic as its title + a clear status pill.
    expect(screen.getByText('Feeling distant')).toBeInTheDocument();
    expect(screen.getByText('Invited · waiting')).toBeInTheDocument(); // initiator sees invited/waiting
  });

  it('a guided session card shows the framework eyebrow + the guide blurb as its subject (§166)', () => {
    installMockBridge();
    setActivePerson();
    useTogetherStore.setState({
      loaded: true,
      hasPartner: true,
      partners: [{ personId: PARTNER, displayName: 'Angel', eligible: true }],
      sessions: [summary({ guideId: 'love-maps', status: 'active', yourTurn: true })],
      catalog: [
        {
          id: 'love-maps',
          group: 'together-connect',
          groupTitle: 'Connect',
          title: 'Love Maps',
          framework: 'Gottman',
          blurb: 'Take turns learning each other’s world.',
          kind: 'structured',
          stepCount: 4,
          adult: false,
        },
      ],
    });
    render(
      <MemoryRouter>
        <Together />
      </MemoryRouter>,
    );
    // Scope to the "Your turn" group (the catalog below repeats the guide's title/eyebrow/blurb, and the
    // group header also reads "Your turn"). The card resolves the guide meta for a clear title + subject.
    const region = screen.getByRole('region', { name: 'Your turn' });
    const card = within(region).getByText('Love Maps').closest('button')!;
    expect(within(card).getByText('Love Maps')).toBeInTheDocument();
    expect(within(card).getByText('Gottman · 4 steps')).toBeInTheDocument();
    expect(within(card).getByText('Take turns learning each other’s world.')).toBeInTheDocument();
  });

  it('the "New session" button opens the deliberate start MODAL (no auto-send); Cancel closes it (58 §3.3)', async () => {
    installMockBridge();
    setActivePerson();
    useTogetherStore.setState({
      loaded: true,
      hasPartner: true,
      partners: [{ personId: PARTNER, displayName: 'Angel', eligible: true }],
      sessions: [],
      // Neutralize the mount refetch so the awaited click doesn't race a graph re-resolve (tested elsewhere).
      load: async () => {},
      loadCatalog: async () => {},
    });
    render(
      <MemoryRouter>
        <Together />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getAllByRole('button', { name: /New session/ })[0]!);
    // A centered modal opens (not an inline bar that needs scrolling) — the start form + the optional topic box.
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Start an open session with Angel' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/What’s on your mind/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Send invitation' })).toBeInTheDocument();
    // Cancel closes it (a pure no-op).
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('session card status + relative time', () => {
  it('maps each viewer state to a labelled, toned status', () => {
    const base = summary();
    expect(sessionStatus({ ...base, status: 'active', yourTurn: true }, ME)).toEqual({
      label: 'Your turn',
      tone: 'accent',
    });
    expect(sessionStatus({ ...base, status: 'active', yourTurn: false }, ME).label).toBe(
      'Their turn',
    );
    // An incoming invitation (I'm NOT the initiator) is ball-in-your-court → accent.
    expect(sessionStatus({ ...base, status: 'invited', initiatorPersonId: PARTNER }, ME)).toEqual({
      label: 'Open invitation',
      tone: 'accent',
    });
    expect(sessionStatus({ ...base, status: 'invited', initiatorPersonId: ME }, ME).label).toBe(
      'Invited · waiting',
    );
    expect(sessionStatus({ ...base, status: 'complete' }, ME).tone).toBe('neutral');
  });

  it('formats a human relative time', () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 30_000).toISOString())).toBe('just now');
    expect(relativeTime(new Date(now - 2 * 3_600_000).toISOString())).toBe('2h ago');
    expect(relativeTime(new Date(now - 26 * 3_600_000).toISOString())).toBe('yesterday');
    expect(relativeTime(undefined)).toBe('');
  });
});

describe('TogetherSessionsBoard (§3.2)', () => {
  it('groups sessions by whose move it is + spells out the turn; wrapped-up is collapsed', () => {
    render(
      <MemoryRouter>
        <TogetherSessionsBoard
          sessions={[
            summary({ id: 'a', status: 'active', yourTurn: true }),
            summary({ id: 'b', status: 'active', yourTurn: false }),
            summary({ id: 'c', status: 'invited', initiatorPersonId: PARTNER }),
            summary({ id: 'd', status: 'invited', initiatorPersonId: ME }),
            summary({ id: 'e', status: 'complete' }),
          ]}
          myId={ME}
          partnerName="Angel"
          guideById={new Map()}
          onOpen={() => {}}
          onWithdraw={() => Promise.resolve(true)}
        />
      </MemoryRouter>,
    );
    // Group sections, labelled by whose move it is.
    expect(screen.getByRole('region', { name: 'Your turn' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Open invitation' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Waiting on Angel' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Invitations you sent' })).toBeInTheDocument();
    // The turn is spelled out in plain words on each active card.
    expect(screen.getByText('Angel is waiting on your reply.')).toBeInTheDocument();
    expect(screen.getByText(/it.s Angel.s move/)).toBeInTheDocument();
    // Past sessions live in a collapsed "Wrapped up" details.
    const wrapped = screen.getByText('Wrapped up').closest('details')!;
    expect(wrapped).not.toHaveAttribute('open');
  });

  it('turnHint spells out whose move it is for an active session only', () => {
    expect(turnHint(summary({ status: 'active', yourTurn: true }), 'Angel')).toBe(
      'Angel is waiting on your reply.',
    );
    expect(turnHint(summary({ status: 'active', yourTurn: false }), 'Angel')).toBe(
      "You replied — it's Angel's move.",
    );
    expect(turnHint(summary({ status: 'invited' }), 'Angel')).toBeNull();
  });
});

describe('Together chat send (05 §4.1)', () => {
  it("shows the author's message immediately, before the coach reply resolves", async () => {
    let resolveSend: (v: TogetherTurnResult) => void = () => {};
    installMockBridge({
      togetherSendMessage: () =>
        new Promise<TogetherTurnResult>((r) => {
          resolveSend = r;
        }),
    });
    setActivePerson();
    useTogetherStore.setState({ open: view({ messages: [] }) });
    const done = useTogetherStore.getState().sendMessage('are we okay?', false, []);
    // Before the bridge resolves, the optimistic user message is already in the thread + we're "sending".
    await waitFor(() => {
      const msgs = useTogetherStore.getState().open?.messages ?? [];
      expect(msgs.some((m) => m.role === 'user' && m.content === 'are we okay?')).toBe(true);
    });
    expect(useTogetherStore.getState().sending).toBe(true);
    resolveSend({ ok: true, view: view({ messages: [] }) });
    await done;
  });

  it('a thrown send resolves to an honest error (never stuck thinking); the message isn’t lost', async () => {
    installMockBridge({ togetherSendMessage: () => Promise.reject(new Error('boom')) });
    setActivePerson();
    useTogetherStore.setState({ open: view({ messages: [] }) });
    const result = await useTogetherStore.getState().sendMessage('hey', false, []);
    expect(result.ok).toBe(false);
    expect(useTogetherStore.getState().sending).toBe(false);
    expect(useTogetherStore.getState().error).toBeTruthy();
    // The optimistic bubble stays so the just-typed message isn't lost (retry via the Try again banner).
    expect(useTogetherStore.getState().open?.messages.some((m) => m.content === 'hey')).toBe(true);
  });
});

describe('TogetherSessionCard withdraw (§3.4)', () => {
  it('offers "Withdraw invitation" for the initiator’s pending invite; the inline confirm fires onWithdraw', async () => {
    let withdrawn = 0;
    render(
      <MemoryRouter>
        <TogetherSessionCard
          session={summary({ status: 'invited', initiatorPersonId: ME })}
          myId={ME}
          guide={undefined}
          onOpen={() => {}}
          onWithdraw={() => {
            withdrawn += 1;
            return Promise.resolve(true);
          }}
        />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Withdraw invitation/ }));
    // A deliberate inline confirm (never a one-click delete).
    expect(screen.getByText(/removed for both of you/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(withdrawn).toBe(1);
  });

  it('never offers withdraw when the viewer isn’t the initiator, or the invite was already accepted', () => {
    const { rerender } = render(
      <MemoryRouter>
        <TogetherSessionCard
          session={summary({ status: 'invited', initiatorPersonId: PARTNER })}
          myId={ME}
          guide={undefined}
          onOpen={() => {}}
          onWithdraw={() => Promise.resolve(true)}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /Withdraw invitation/ })).toBeNull();
    rerender(
      <MemoryRouter>
        <TogetherSessionCard
          session={summary({ status: 'active', initiatorPersonId: ME })}
          myId={ME}
          guide={undefined}
          onOpen={() => {}}
          onWithdraw={() => Promise.resolve(true)}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /Withdraw invitation/ })).toBeNull();
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
    // The audience toggle: "Shared with Angel" is active by default; choosing "Just the coach" arms private.
    const shared = screen.getByRole('button', { name: /Shared with Angel/ });
    const priv = screen.getByRole('button', { name: 'Just the coach' });
    expect(shared).toHaveAttribute('aria-pressed', 'true');
    expect(priv).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(priv);
    expect(priv).toHaveAttribute('aria-pressed', 'true');
    // Private mode is unmistakable: the lock banner + the "Send privately" action.
    expect(screen.getByText(/Only the coach sees this/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send privately/ })).toBeInTheDocument();
    // Turn pill carries text.
    expect(within(screen.getByText('Your turn')).getByText('Your turn')).toBeInTheDocument();
  });

  it('strips coach markers from the LIVE streaming bubble — a trailing SUGGEST never flashes (§5.6)', () => {
    installMockBridge();
    setActivePerson();
    useTogetherStore.setState({
      sending: true,
      streaming:
        'Here’s an idea. [[SELFOS:SUGGEST:{"kind":"guide","prompt":"Try Love Maps","guideId":"love-maps"}]]',
    });
    render(
      <MemoryRouter>
        <TogetherThread session={view({ messages: [] })} onPrep={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Here’s an idea.')).toBeInTheDocument();
    expect(screen.queryByText(/SELFOS:SUGGEST/)).toBeNull(); // the raw marker never shows mid-stream
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

  it('a wrapped-up session collapses the composer behind "Reopen to keep talking" (§3.8)', async () => {
    installMockBridge();
    setActivePerson();
    render(
      <MemoryRouter>
        <TogetherThread session={view({ status: 'complete' })} onPrep={() => {}} completed />
      </MemoryRouter>,
    );
    // The composer is hidden; a calm reopen affordance stands in, and the turn pill reads "Wrapped up".
    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(screen.getByText(/Sending a message reopens this session/i)).toBeInTheDocument();
    expect(screen.getByText('Wrapped up')).toBeInTheDocument();
    expect(screen.queryByText('Your turn')).toBeNull();
    // One tap reveals the composer (the next shared message reopens the session).
    await userEvent.click(screen.getByRole('button', { name: /Reopen to keep talking/ }));
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reopen to keep talking/ })).toBeNull();
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
    stepCount: 4,
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
      stepCount: 0,
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

describe('TogetherIntimacy (§3.10/§3.10b)', () => {
  const ynm = (over: Partial<TogetherYnmStatus>): TogetherYnmStatus => ({
    youAcked: false,
    eligible: false,
    youOptedIn: false,
    partnerOptedIn: false,
    ready: false,
    ...over,
  });

  it('offers the 18+ acknowledgement when the active person has not acked', async () => {
    let acked = 0;
    installMockBridge({
      togetherYnmStatus: () => Promise.resolve(ynm({ youAcked: false })),
      togetherAcknowledgeAdult: () => {
        acked += 1;
        return Promise.resolve(true);
      },
    });
    render(
      <MemoryRouter>
        <TogetherIntimacy
          partnerId="partner"
          partnerName="Angel"
          adultPractices={[]}
          selectedId={null}
          onPick={() => {}}
        />
      </MemoryRouter>,
    );
    const btn = await screen.findByRole('button', { name: /turn on adult content/i });
    await userEvent.click(btn);
    expect(acked).toBe(1);
  });

  it('shows the mutual overlap + a "Start Yes/No/Maybe together" action when ready; never a one-sided list', async () => {
    installMockBridge({
      togetherYnmStatus: () =>
        Promise.resolve(
          ynm({
            youAcked: true,
            eligible: true,
            youOptedIn: true,
            partnerOptedIn: true,
            ready: true,
          }),
        ),
      togetherYnmOverlap: () =>
        Promise.resolve({ ready: true, items: [{ key: 'k1', label: 'Something you both like' }] }),
    });
    render(
      <MemoryRouter>
        <TogetherIntimacy
          partnerId="partner"
          partnerName="Angel"
          adultPractices={[]}
          selectedId={null}
          onPick={() => {}}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Something you both like')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Yes/No/Maybe together' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
  });

  it('surfaces the adult guided practices alongside the YNM card once unlocked (§3.10)', async () => {
    let picked = '';
    installMockBridge({
      togetherYnmStatus: () =>
        Promise.resolve(ynm({ youAcked: true, eligible: true, youOptedIn: false })),
    });
    render(
      <MemoryRouter>
        <TogetherIntimacy
          partnerId="partner"
          partnerName="Angel"
          selectedId={null}
          onPick={(e) => (picked = e.id)}
          adultPractices={[
            {
              id: 'sensate-focus',
              group: 'together-desire',
              groupTitle: 'Desire & intimacy',
              title: 'Sensate Focus',
              framework: 'Masters & Johnson',
              blurb: 'A gentle, pressure-free program of touch.',
              kind: 'structured',
              stepCount: 5,
              adult: true,
            },
          ]}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Sensate Focus')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Sensate Focus'));
    expect(picked).toBe('sensate-focus');
  });

  it('waits for the partner to ack (no dead controls) when only the active person has acked', async () => {
    installMockBridge({
      togetherYnmStatus: () => Promise.resolve(ynm({ youAcked: true, eligible: false })),
    });
    render(
      <MemoryRouter>
        <TogetherIntimacy
          partnerId="partner"
          partnerName="Angel"
          adultPractices={[]}
          selectedId={null}
          onPick={() => {}}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Waiting for Angel to turn it on/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /turn on adult content/i }),
    ).not.toBeInTheDocument();
  });
});

describe('TogetherPulse (§3.10a)', () => {
  it('logs a check-in with the chosen levels and desire-share choice', async () => {
    let logged: { metrics: Record<string, number>; shareMetrics?: string[] } | null = null;
    installMockBridge({
      togetherPulse: () =>
        Promise.resolve({
          checkInSeries: [],
          sessionSeries: [],
          hasCheckIns: false,
          alignment: { ready: false },
        }),
      togetherPulseLog: (input) => {
        logged = {
          metrics: input.metrics,
          ...(input.shareMetrics ? { shareMetrics: input.shareMetrics } : {}),
        };
        return Promise.resolve({
          checkInSeries: [],
          sessionSeries: [],
          hasCheckIns: false,
          alignment: { ready: false },
        });
      },
    });
    render(
      <MemoryRouter>
        <TogetherPulse partnerId="partner" partnerName="Angel" />
      </MemoryRouter>,
    );
    // The taps are always visible (no "Log a check-in" reveal) — a one-motion check-in.
    const connGroup = await screen.findByRole('group', { name: 'Connection level' });
    await userEvent.click(within(connGroup).getByRole('button', { name: 'High' }));
    await userEvent.click(screen.getByRole('switch'));
    await userEvent.click(screen.getByRole('button', { name: 'Save check-in' }));
    expect(logged).not.toBeNull();
    expect(logged!.metrics['connection']).toBe(1);
    expect(logged!.metrics['satisfaction']).toBe(0.5); // untouched default (Steady)
    expect(logged!.shareMetrics).toEqual(['desire']);
  });

  it('renders the desire alignment as a you-vs-partner comparison only when ready', async () => {
    installMockBridge({
      togetherPulse: () =>
        Promise.resolve({
          checkInSeries: [
            {
              label: 'Connection',
              points: [
                { x: 1, y: 0.2 },
                { x: 2, y: 0.8 },
              ],
              direction: 'rising',
            },
          ],
          sessionSeries: [],
          hasCheckIns: true,
          alignment: { ready: true, yours: 0.8, theirs: 0.75, read: 'aligned' },
        }),
    });
    render(
      <MemoryRouter>
        <TogetherPulse partnerId="partner" partnerName="Angel" />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/desire levels are closely aligned/i)).toBeInTheDocument();
    // The comparison names both people (you + the partner), not a vague banner.
    expect(screen.getByText(/You & Angel · desire/)).toBeInTheDocument();
  });

  it('splits the two data sources: a "Your check-ins" chart (≥2 points) + a separate "From your sessions" group', async () => {
    installMockBridge({
      togetherPulse: () =>
        Promise.resolve({
          checkInSeries: [
            {
              label: 'Connection',
              points: [
                { x: 1, y: 0.4 },
                { x: 2, y: 0.6 },
              ],
              direction: 'rising',
            },
          ],
          sessionSeries: [{ label: 'Calm', points: [{ x: 1, y: 0.7 }], direction: 'flat' }],
          hasCheckIns: true,
          alignment: { ready: false },
        }),
    });
    render(
      <MemoryRouter>
        <TogetherPulse partnerId="partner" partnerName="Angel" />
      </MemoryRouter>,
    );
    // The check-ins group has ≥2 points → a real trend chart (its own labelled image).
    expect(
      await screen.findByRole('img', { name: /Your check-in trends with Angel/i }),
    ).toBeInTheDocument();
    // The session group is separate + labelled (no "Connection (sessions)" collision).
    expect(screen.getByText('From your sessions together')).toBeInTheDocument();
    expect(screen.getByText('Your check-ins')).toBeInTheDocument();
  });

  it('shows a current-value read (not a lone floating dot) when a group has only one reading', async () => {
    installMockBridge({
      togetherPulse: () =>
        Promise.resolve({
          checkInSeries: [
            { label: 'Connection', points: [{ x: 1, y: 0.9 }], direction: 'flat' },
            { label: 'Satisfaction', points: [{ x: 1, y: 0.2 }], direction: 'flat' },
          ],
          sessionSeries: [],
          hasCheckIns: true,
          alignment: { ready: false },
        }),
    });
    render(
      <MemoryRouter>
        <TogetherPulse partnerId="partner" partnerName="Angel" />
      </MemoryRouter>,
    );
    // A single check-in → no chart image; the current values read as words instead (scoped to the readout
    // so the check-in form's own Low/Steady/High buttons don't collide).
    await screen.findByText('Your check-ins');
    expect(screen.queryByRole('img', { name: /Your check-in trends/i })).not.toBeInTheDocument();
    const readout = screen.getByRole('list', { name: 'Your check-ins right now' });
    expect(within(readout).getByText('High')).toBeInTheDocument(); // Connection 0.9
    expect(within(readout).getByText('Low')).toBeInTheDocument(); // Satisfaction 0.2
    expect(screen.getByText(/Check in again to see how these trend/i)).toBeInTheDocument();
  });

  it('hides the desire alignment when not ready (dual consent unmet)', async () => {
    installMockBridge({
      togetherPulse: () =>
        Promise.resolve({
          checkInSeries: [],
          sessionSeries: [],
          hasCheckIns: false,
          alignment: { ready: false },
        }),
    });
    render(
      <MemoryRouter>
        <TogetherPulse partnerId="partner" partnerName="Angel" />
      </MemoryRouter>,
    );
    // The inviting nudge shows (no fabricated streak); no alignment read without dual consent.
    expect(await screen.findByText(/Takes 20 seconds/i)).toBeInTheDocument();
    expect(screen.queryByText(/desire levels/i)).not.toBeInTheDocument();
  });

  it('shows an honest "last check-in N days ago" nudge from the view timestamp', async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000).toISOString();
    installMockBridge({
      togetherPulse: () =>
        Promise.resolve({
          checkInSeries: [],
          sessionSeries: [],
          hasCheckIns: true,
          lastCheckInAt: fiveDaysAgo,
          alignment: { ready: false },
        }),
    });
    render(
      <MemoryRouter>
        <TogetherPulse partnerId="partner" partnerName="Angel" />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Last check-in 5 days ago/i)).toBeInTheDocument();
  });
});

describe('TogetherJointChallenges (§5.6)', () => {
  it('renders the pair’s open joint challenge with its cross-partner status', async () => {
    installMockBridge({
      togetherJointChallenges: () =>
        Promise.resolve([
          {
            groupId: 'g1',
            action: 'Share one appreciation a day',
            memberCount: 2,
            checkedInCount: 1,
            allCheckedIn: false,
            active: true,
            updatedAt: 'now',
          },
        ]),
    });
    render(
      <MemoryRouter>
        <TogetherJointChallenges partnerId="partner" />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Share one appreciation a day')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 checked in')).toBeInTheDocument();
  });

  it('self-hides when the pair has no joint challenge', async () => {
    installMockBridge({ togetherJointChallenges: () => Promise.resolve([]) });
    const { container } = render(
      <MemoryRouter>
        <TogetherJointChallenges partnerId="partner" />
      </MemoryRouter>,
    );
    // Nothing renders (the card returns null when there are no open joint challenges).
    await waitForNoJointCard(container);
  });
});

async function waitForNoJointCard(container: HTMLElement): Promise<void> {
  // Give the async fetch a tick, then assert the heading never appeared.
  await new Promise((r) => setTimeout(r, 0));
  expect(within(container).queryByText('Joint challenges')).toBeNull();
}

describe('TogetherSuggestions (§5.6)', () => {
  it('renders a guide suggestion with a Start action; a questionnaire suggestion with a check-in doorway', async () => {
    installMockBridge({
      togetherSuggestions: () =>
        Promise.resolve([
          {
            id: 's1',
            schemaVersion: 1,
            sessionId: 'sess',
            kind: 'guide' as const,
            prompt: 'Try Love Maps together',
            guideId: 'love-maps',
            createdAt: 'now',
          },
          {
            id: 's2',
            schemaVersion: 1,
            sessionId: 'sess',
            kind: 'questionnaire' as const,
            prompt: 'A check-in on chores',
            topic: 'chores',
            createdAt: 'now',
          },
        ]),
    });
    render(
      <MemoryRouter>
        <TogetherSuggestions sessionId="sess" partnerId="partner" />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Try Love Maps together')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start this exercise' })).toBeInTheDocument();
    expect(screen.getByText('A check-in on chores')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open a check-in' })).toBeInTheDocument();
  });

  it('a guide suggestion with no startable guideId is a plain prompt card — NO action button', async () => {
    installMockBridge({
      togetherSuggestions: () =>
        Promise.resolve([
          {
            id: 's1',
            schemaVersion: 1,
            sessionId: 'sess',
            kind: 'guide' as const, // adult/unknown guide → guideId dropped host-side
            prompt: 'A desire exercise',
            createdAt: 'now',
          },
        ]),
    });
    render(
      <MemoryRouter>
        <TogetherSuggestions sessionId="sess" partnerId="partner" />
      </MemoryRouter>,
    );
    expect(await screen.findByText('A desire exercise')).toBeInTheDocument();
    // No "Start this exercise" AND no wrong "Open a check-in" doorway on a degraded guide card.
    expect(screen.queryByRole('button', { name: 'Start this exercise' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open a check-in' })).toBeNull();
  });

  it('self-hides when there are no suggestions', async () => {
    installMockBridge({ togetherSuggestions: () => Promise.resolve([]) });
    const { container } = render(
      <MemoryRouter>
        <TogetherSuggestions sessionId="sess" partnerId="partner" />
      </MemoryRouter>,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(within(container).queryByText('Ideas from your coach')).toBeNull();
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

  it('offers BOTH a mid-session "Reflect & note action items" checkpoint and "Wrap up & reflect", each with a tooltip', () => {
    installMockBridge();
    useTogetherStore.setState({ reportView: { report: null, stale: false, agreements: [] } });
    render(<TogetherReflection sessionId="s1" memoryEnabled aiReady />);
    const reflect = screen.getByRole('button', { name: /Reflect & note action items/ });
    const wrap = screen.getByRole('button', { name: /Wrap up & reflect/ });
    expect(reflect).toBeInTheDocument();
    expect(wrap).toBeInTheDocument();
    // Tooltips make the two actions' difference clear.
    expect(reflect.getAttribute('title')).toMatch(/session stays open/i);
    expect(wrap.getAttribute('title')).toMatch(/mark this session done/i);
  });

  it('the checkpoint button analyzes with mode "reflect"; "Wrap up & reflect" with mode "wrapUp"', async () => {
    const calls: Array<{ sessionId: string; mode?: string }> = [];
    installMockBridge({
      togetherWrapUp: (input) => {
        calls.push(input);
        return Promise.resolve({ ok: true, report, stale: false });
      },
    });
    useTogetherStore.setState({ reportView: { report: null, stale: false, agreements: [] } });
    render(<TogetherReflection sessionId="s1" memoryEnabled aiReady />);
    await userEvent.click(screen.getByRole('button', { name: /Reflect & note action items/ }));
    await userEvent.click(screen.getByRole('button', { name: /Wrap up & reflect/ }));
    expect(calls).toEqual([
      { sessionId: 's1', mode: 'reflect' },
      { sessionId: 's1', mode: 'wrapUp' },
    ]);
  });

  it('once a report exists the checkpoint button re-analyzes ("Reflect again & note actions")', () => {
    installMockBridge();
    useTogetherStore.setState({ reportView: { report, stale: false, agreements: [] } });
    render(<TogetherReflection sessionId="s1" memoryEnabled aiReady />);
    expect(
      screen.getByRole('button', { name: /Reflect again & note actions/ }),
    ).toBeInTheDocument();
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
    // The icon-only row actions carry tooltips so their purpose is clear (not just an aria-label).
    expect(screen.getByRole('button', { name: 'Edit agreement' }).getAttribute('title')).toMatch(
      /edit/i,
    );
    expect(screen.getByRole('button', { name: 'Retire agreement' }).getAttribute('title')).toMatch(
      /remove it from your list/i,
    );
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

  it('once wrapped up, drops the terminal "Wrap up & reflect" but keeps "Reflect again" (§3.8)', () => {
    installMockBridge();
    useTogetherStore.setState({ reportView: { report, stale: false, agreements: [] } });
    render(<TogetherReflection sessionId="s1" memoryEnabled aiReady completed />);
    // The session is already done — no redundant terminal wrap-up button, but a refresh stays available.
    expect(screen.queryByRole('button', { name: /Wrap up & reflect/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Reflect again & note actions/ }),
    ).toBeInTheDocument();
    // The saved reflection (insights + themes) still renders — the close-out summary.
    expect(screen.getByText('You both showed up honestly.')).toBeInTheDocument();
  });
});

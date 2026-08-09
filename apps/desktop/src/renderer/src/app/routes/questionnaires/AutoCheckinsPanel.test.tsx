import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AutoCheckinConfig, AutoCheckinTarget, Person } from '@shared/schemas';
import type { SelfosBridge } from '@shared/channels';
import { DEFAULT_ROLES } from '@shared/capabilities';
import { AutoCheckinsPanel } from './AutoCheckinsPanel';
import { useSessionStore } from '../../../stores/sessionStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useAutoCheckinStore } from '../../../stores/autoCheckinStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

const ME: Person = {
  id: 'me',
  schemaVersion: 1,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

const selfTarget: AutoCheckinTarget = {
  id: 't-self',
  target: { kind: 'self' },
  enabled: true,
  includeIntimacy: true,
  explorationFocus: '',
  cadence: 'daily',
};

afterEach(() => {
  clearMockBridge();
  useAutoCheckinStore.getState().reset();
  usePeopleStore.setState({ people: [], relationships: [], loaded: false });
  useSessionStore.setState({ activePerson: null, access: null });
});

function signIn(roleId: 'owner' | 'member'): void {
  useSessionStore.setState({
    activePerson: ME,
    access: {
      roles: DEFAULT_ROLES,
      accounts: [{ personId: ME.id, roleId, hasPin: false }],
    },
  });
}

function mount(config: AutoCheckinConfig | null, overrides: Partial<SelfosBridge> = {}): void {
  installMockBridge({
    autoCheckinsGetConfig: () => Promise.resolve(config),
    autoCheckinsSetConfig: (input) =>
      Promise.resolve({ schemaVersion: 1, enabled: false, targets: [], ...input }),
    autoCheckinsRun: () =>
      Promise.resolve({
        ok: true,
        created: [
          {
            targetId: 't-self',
            intent: 'deepen',
            questionnaireId: 'q1',
            assignmentId: 'a1',
            recipientPersonId: 'me',
            title: 'A quick check-in',
            rationale: 'why',
          },
        ],
        skipped: [],
      }),
    ...overrides,
  });
  render(<AutoCheckinsPanel />);
}

describe('AutoCheckinsPanel', () => {
  it('renders the off state with a master toggle + explainer', async () => {
    signIn('member');
    mount({ schemaVersion: 1, enabled: false, targets: [] });
    expect(await screen.findByRole('heading', { name: 'Auto check-ins' })).toBeInTheDocument();
    expect(screen.getByLabelText('Turn auto check-ins on')).not.toBeChecked();
    expect(screen.getByText(/Turn this on to let SelfOS/)).toBeInTheDocument();
  });

  it('shows the self stream controls when enabled, and Run now surfaces a note', async () => {
    signIn('member');
    mount({ schemaVersion: 1, enabled: true, targets: [selfTarget] });
    expect(await screen.findByText('Yourself')).toBeInTheDocument();
    expect(screen.getByText('Include unfiltered intimacy check-ins')).toBeInTheDocument();
    expect(screen.getByLabelText('How often')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await waitFor(() =>
      expect(screen.getByText(/Added 1 new check-in to your inbox\./)).toBeInTheDocument(),
    );
  });

  it('offers "Add someone else" to an owner', async () => {
    signIn('owner');
    mount({ schemaVersion: 1, enabled: true, targets: [selfTarget] });
    expect(await screen.findByText('Add someone else')).toBeInTheDocument();
  });

  it('does NOT offer "Add someone else" to a member', async () => {
    signIn('member');
    mount({ schemaVersion: 1, enabled: true, targets: [selfTarget] });
    expect(await screen.findByText('Yourself')).toBeInTheDocument();
    expect(screen.queryByText('Add someone else')).not.toBeInTheDocument();
  });

  it('self-hides when the person lacks the capability AND no one targets them (null config, no incoming)', async () => {
    signIn('member');
    mount(null);
    // Nothing renders — no heading — once the (null) load settles.
    await waitFor(() => expect(useAutoCheckinStore.getState().loaded).toBe(true));
    expect(screen.queryByRole('heading', { name: 'Auto check-ins' })).not.toBeInTheDocument();
  });

  it('shows "Questions others send you" (even with no own config) and turning a sender off stops it (§3.3a)', async () => {
    signIn('member');
    const setBlock = vi.fn(() =>
      Promise.resolve({ schemaVersion: 1 as const, blockedSenders: ['angel'] }),
    );
    // A person TARGETED by an owner but WITHOUT their own config still sees + controls it.
    mount(null, {
      autoCheckinsIncomingStreams: () =>
        Promise.resolve([
          {
            senderPersonId: 'angel',
            senderName: 'Angel',
            relationshipLabel: 'partner',
            active: true,
            cadence: 'weekly',
            includeIntimacy: true,
            blocked: false,
          },
        ]),
      autoCheckinsSetBlock: setBlock,
    });
    expect(
      await screen.findByRole('heading', { name: 'Questions others send you' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Angel')).toBeInTheDocument();
    expect(
      screen.getByText(/Your partner · Weekly · includes intimacy check-ins/),
    ).toBeInTheDocument();
    // Turning the "Receiving" switch off calls setBlock(blocked: true).
    await userEvent.click(screen.getByLabelText('Receive questions from Angel'));
    expect(setBlock).toHaveBeenCalledWith({ senderPersonId: 'angel', blocked: true });
  });

  it('lets you pre-empt someone who could send but hasn’t — reads "Nothing scheduled", still toggles (66)', async () => {
    signIn('member');
    const setBlock = vi.fn(() =>
      Promise.resolve({ schemaVersion: 1 as const, blockedSenders: ['ben'] }),
    );
    mount(null, {
      autoCheckinsIncomingStreams: () =>
        Promise.resolve([
          {
            senderPersonId: 'ben',
            senderName: 'Ben',
            relationshipLabel: 'partner',
            active: false, // could send, but nothing is configured yet
            blocked: false,
          },
        ]),
      autoCheckinsSetBlock: setBlock,
    });
    expect(await screen.findByText('Ben')).toBeInTheDocument();
    // No cadence to report — the off-switch is reachable BEFORE anything is sent, which is the point.
    expect(screen.getByText(/Your partner · Nothing scheduled/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Receive questions from Ben'));
    expect(setBlock).toHaveBeenCalledWith({ senderPersonId: 'ben', blocked: true });
  });

  it('shows the per-stream compact read of the owner’s own sent activity (spec 69 §13)', async () => {
    signIn('owner');
    usePeopleStore.setState({
      people: [ME, { ...ME, id: 'partner', displayName: 'Pat' }],
      relationships: [],
      loaded: true,
    });
    const personTarget: AutoCheckinTarget = {
      id: 't-partner',
      target: { kind: 'person', personId: 'partner' },
      enabled: true,
      includeIntimacy: false,
      explorationFocus: '',
      cadence: 'weekly',
    };
    mount(
      { schemaVersion: 1, enabled: true, targets: [personTarget] },
      {
        autoCheckinsSentActivity: () =>
          Promise.resolve({ partner: { sentCount: 3, latestAt: '2026-08-05T00:00:00.000Z' } }),
      },
    );
    expect(await screen.findByText('Pat')).toBeInTheDocument();
    expect(screen.getByText(/You’ve sent 3 check-ins · latest/)).toBeInTheDocument();
  });

  it('shows a “none yet” per-stream read when the owner hasn’t sent to a target', async () => {
    signIn('owner');
    usePeopleStore.setState({
      people: [ME, { ...ME, id: 'partner', displayName: 'Pat' }],
      relationships: [],
      loaded: true,
    });
    const personTarget: AutoCheckinTarget = {
      id: 't-partner',
      target: { kind: 'person', personId: 'partner' },
      enabled: true,
      includeIntimacy: false,
      explorationFocus: '',
      cadence: 'weekly',
    };
    mount({ schemaVersion: 1, enabled: true, targets: [personTarget] });
    expect(await screen.findByText('Pat')).toBeInTheDocument();
    expect(screen.getByText(/haven’t sent any check-ins yet/)).toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
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

  it('self-hides when the person lacks the capability (null config)', async () => {
    signIn('member');
    mount(null);
    // Nothing renders — no heading — once the (null) load settles.
    await waitFor(() => expect(useAutoCheckinStore.getState().loaded).toBe(true));
    expect(screen.queryByRole('heading', { name: 'Auto check-ins' })).not.toBeInTheDocument();
  });
});

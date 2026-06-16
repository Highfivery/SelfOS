import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IntimacyTopicsView } from '@shared/channels';
import { DEFAULT_ROLES } from '@shared/capabilities';
import { IntimacyTopicsControl } from './IntimacyTopicsControl';
import { useSessionStore } from '../stores/sessionStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ activePerson: null, access: null });
});

/** Sign in as the Owner (has `people.manage`) so the add/remove affordances render. */
function asOwner(): void {
  useSessionStore.setState({
    activePerson: {
      id: 'owner-1',
      schemaVersion: 1,
      displayName: 'Ben',
      isSubject: true,
      tags: [],
      createdAt: 'now',
      updatedAt: 'now',
    },
    access: {
      roles: DEFAULT_ROLES,
      accounts: [{ personId: 'owner-1', roleId: 'owner', hasPin: false }],
    },
  });
}

const view = (custom: IntimacyTopicsView['custom']): IntimacyTopicsView => ({
  builtIn: { activities: ['Oral (giving)', 'Bondage'], fantasies: ['Voyeurism'] },
  custom,
});

describe('IntimacyTopicsControl (§16.5a)', () => {
  it('shows custom topics removable, the built-in count, and the 18+ note', async () => {
    asOwner();
    installMockBridge({
      questionnairesIntimacyTopics: () =>
        Promise.resolve(view({ activities: ['Wax play'], fantasies: [] })),
    });
    render(<IntimacyTopicsControl />);

    expect(await screen.findByText('Wax play')).toBeInTheDocument();
    expect(screen.getByText(/18\+ only/i)).toBeInTheDocument();
    expect(screen.getByText(/1 built-in topics are always included/i)).toBeInTheDocument();
  });

  it('adds a topic from the textarea via the IPC', async () => {
    asOwner();
    const add = vi.fn(() => Promise.resolve(view({ activities: ['Wax play'], fantasies: [] })));
    installMockBridge({
      questionnairesIntimacyTopics: () => Promise.resolve(view({ activities: [], fantasies: [] })),
      questionnairesAddIntimacyTopic: add,
    });
    render(<IntimacyTopicsControl />);

    await userEvent.type(await screen.findByLabelText('Add an activity'), 'Wax play');
    await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[0] as HTMLElement);
    await waitFor(() => {
      expect(add).toHaveBeenCalledWith({ kind: 'activities', name: 'Wax play' });
    });
  });

  it('removes a custom topic via the IPC', async () => {
    asOwner();
    const remove = vi.fn(() => Promise.resolve(view({ activities: [], fantasies: [] })));
    installMockBridge({
      questionnairesIntimacyTopics: () =>
        Promise.resolve(view({ activities: ['Wax play'], fantasies: [] })),
      questionnairesRemoveIntimacyTopic: remove,
    });
    render(<IntimacyTopicsControl />);

    await userEvent.click(await screen.findByRole('button', { name: 'Remove Wax play' }));
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({ kind: 'activities', name: 'Wax play' }),
    );
  });

  it('is read-only for a non-owner (no add fields, no remove buttons, an owner-only note)', async () => {
    // No owner session → can('people.manage') is false.
    installMockBridge({
      questionnairesIntimacyTopics: () =>
        Promise.resolve(view({ activities: ['Wax play'], fantasies: [] })),
    });
    render(<IntimacyTopicsControl />);

    expect(
      await screen.findByText(/Only the household owner can add or remove/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Wax play')).toBeInTheDocument(); // still shown, just not removable
    expect(screen.queryByRole('button', { name: 'Remove Wax play' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Add activities/i)).not.toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switcher } from './Switcher';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';
import { useSessionStore } from '../stores/sessionStore';
import { usePeopleStore } from '../stores/peopleStore';
import { DEFAULT_ROLES } from '@shared/capabilities';
import type { Person } from '@shared/channels';

const people: Person[] = [
  {
    id: 'owner-1',
    schemaVersion: 1,
    displayName: 'Alex',
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
  },
  {
    id: 'p2',
    schemaVersion: 1,
    displayName: 'Sam',
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
  },
];

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({
    status: null,
    activePerson: null,
    access: null,
    loaded: false,
    locked: false,
  });
  usePeopleStore.setState({ people: [], relationships: [], loaded: false });
});

describe('Switcher', () => {
  it('switches to a person without a PIN', async () => {
    installMockBridge({ peopleList: () => Promise.resolve(people) });
    useSessionStore.setState({
      access: {
        roles: DEFAULT_ROLES,
        accounts: [
          { personId: 'owner-1', roleId: 'owner', hasPin: false },
          { personId: 'p2', roleId: 'member', hasPin: false },
        ],
      },
    });
    let closed = false;
    render(
      <Switcher
        onClose={() => {
          closed = true;
        }}
      />,
    );
    await userEvent.click(await screen.findByText('Sam'));
    expect(closed).toBe(true);
  });

  it('asks for a PIN when one is set', async () => {
    installMockBridge({ peopleList: () => Promise.resolve(people) });
    useSessionStore.setState({
      access: {
        roles: DEFAULT_ROLES,
        accounts: [{ personId: 'p2', roleId: 'member', hasPin: true }],
      },
    });
    render(<Switcher onClose={() => {}} />);
    await userEvent.click(await screen.findByText('Sam'));
    expect(screen.getByLabelText('PIN for Sam')).toBeInTheDocument();
  });

  it('lets the Owner switch to a PIN-protected person with no prompt', async () => {
    installMockBridge({ peopleList: () => Promise.resolve(people) });
    useSessionStore.setState({
      activePerson: people.find((p) => p.id === 'owner-1') ?? null, // Alex, the owner, is active
      access: {
        roles: DEFAULT_ROLES,
        accounts: [
          { personId: 'owner-1', roleId: 'owner', hasPin: true },
          { personId: 'p2', roleId: 'member', hasPin: true },
        ],
      },
    });
    let closed = false;
    render(
      <Switcher
        onClose={() => {
          closed = true;
        }}
      />,
    );
    await userEvent.click(await screen.findByText('Sam'));
    // No PIN prompt — the Owner switches straight through (the bridge skips PIN when leaving the Owner).
    expect(screen.queryByLabelText('PIN for Sam')).not.toBeInTheDocument();
    expect(closed).toBe(true);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LockScreen } from './LockScreen';
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
];

const accountsAccess = {
  roles: DEFAULT_ROLES,
  accounts: [{ personId: 'owner-1', roleId: 'owner', hasPin: false }],
};

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ access: null, activePerson: null, locked: false });
  usePeopleStore.setState({ people: [], relationships: [], loaded: false });
});

describe('LockScreen', () => {
  it('shows the brand, a welcome, and the person picker', async () => {
    installMockBridge({ peopleList: () => Promise.resolve(people) });
    useSessionStore.setState({ access: accountsAccess, locked: true });
    render(<LockScreen />);

    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(await screen.findByText('Alex')).toBeInTheDocument();
  });

  it('resuming as a PIN-less person clears the locked state', async () => {
    installMockBridge({ peopleList: () => Promise.resolve(people) });
    useSessionStore.setState({ access: accountsAccess, locked: true });
    render(<LockScreen />);

    await userEvent.click(await screen.findByText('Alex'));
    expect(useSessionStore.getState().locked).toBe(false);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RequireCapability } from './RequireCapability';
import { useSessionStore } from '../stores/sessionStore';
import { DEFAULT_ROLES } from '@shared/capabilities';
import type { AccessView, Person } from '@shared/channels';

const owner: Person = {
  id: 'owner-1',
  schemaVersion: 1,
  displayName: 'Alex',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};
const member: Person = { ...owner, id: 'p2', displayName: 'Sam' };

const access: AccessView = {
  roles: DEFAULT_ROLES,
  accounts: [
    { personId: 'owner-1', roleId: 'owner', hasPin: false },
    { personId: 'p2', roleId: 'member', hasPin: false },
  ],
};

function signIn(person: Person): void {
  useSessionStore.setState({ activePerson: person, access, loaded: true });
}

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>Home screen</div>} />
        <Route
          path="/roles"
          element={
            <RequireCapability capability="roles.manage">
              <div>Roles screen</div>
            </RequireCapability>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  useSessionStore.setState({
    status: null,
    activePerson: null,
    access: null,
    loaded: false,
    locked: false,
  });
});

describe('RequireCapability', () => {
  it('renders the guarded screen when the active person has the capability', () => {
    signIn(owner); // Owner = full access
    renderAt('/roles');
    expect(screen.getByText('Roles screen')).toBeInTheDocument();
  });

  it('redirects to Home when the active person lacks the capability (typed hash)', () => {
    signIn(member); // a Member lacks roles.manage
    renderAt('/roles');
    expect(screen.queryByText('Roles screen')).not.toBeInTheDocument();
    expect(screen.getByText('Home screen')).toBeInTheDocument();
  });

  it('redirects when the active person switches to one without the capability while on the route', () => {
    signIn(owner);
    renderAt('/roles');
    expect(screen.getByText('Roles screen')).toBeInTheDocument();

    // The switcher reloads access/activePerson — the reactive `can` selector re-renders the guard.
    act(() => signIn(member));
    expect(screen.queryByText('Roles screen')).not.toBeInTheDocument();
    expect(screen.getByText('Home screen')).toBeInTheDocument();
  });
});

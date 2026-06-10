import { afterEach, describe, expect, it } from 'vitest';
import { useSessionStore } from './sessionStore';
import { DEFAULT_ROLES } from '@shared/capabilities';
import type { Person } from '@shared/channels';

const owner: Person = {
  id: 'owner-1',
  schemaVersion: 1,
  displayName: 'Alex',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

afterEach(() =>
  useSessionStore.setState({
    status: null,
    activePerson: null,
    access: null,
    loaded: false,
    superAdmin: false,
  }),
);

describe('sessionStore.can', () => {
  it('denies when there is no active person', () => {
    expect(useSessionStore.getState().can('people.manage')).toBe(false);
  });

  it('grants the owner full capabilities', () => {
    useSessionStore.setState({
      activePerson: owner,
      access: {
        roles: DEFAULT_ROLES,
        accounts: [{ personId: 'owner-1', roleId: 'owner', hasPin: false }],
      },
    });
    expect(useSessionStore.getState().can('people.manage')).toBe(true);
  });

  it('grants a guest no capabilities (an empty default role until one is specced)', () => {
    useSessionStore.setState({
      activePerson: owner,
      access: {
        roles: DEFAULT_ROLES,
        accounts: [{ personId: 'owner-1', roleId: 'guest', hasPin: false }],
      },
    });
    expect(useSessionStore.getState().can('people.manage')).toBe(false);
    expect(useSessionStore.getState().can('sessions.own')).toBe(false);
    expect(useSessionStore.getState().can('relationships.manage')).toBe(false);
  });

  it('super-admin bypasses all capability checks', () => {
    useSessionStore.setState({ superAdmin: true });
    expect(useSessionStore.getState().can('people.manage')).toBe(true);
    expect(useSessionStore.getState().can('roles.manage')).toBe(true);
  });
});

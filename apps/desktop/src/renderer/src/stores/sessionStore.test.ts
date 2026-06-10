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
  useSessionStore.setState({ status: null, activePerson: null, access: null, loaded: false }),
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

  it('denies a guest the manage capability but allows answering questionnaires', () => {
    useSessionStore.setState({
      activePerson: owner,
      access: {
        roles: DEFAULT_ROLES,
        accounts: [{ personId: 'owner-1', roleId: 'guest', hasPin: false }],
      },
    });
    expect(useSessionStore.getState().can('people.manage')).toBe(false);
    expect(useSessionStore.getState().can('questionnaires.answer')).toBe(true);
  });
});

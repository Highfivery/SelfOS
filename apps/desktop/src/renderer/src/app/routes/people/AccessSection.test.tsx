import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccessSection } from './AccessSection';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import { useSessionStore } from '../../../stores/sessionStore';
import { DEFAULT_ROLES } from '@shared/capabilities';
import type { Person } from '@shared/channels';

const sam: Person = {
  id: 'p2',
  schemaVersion: 1,
  displayName: 'Sam',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ status: null, activePerson: null, access: null, loaded: false });
});

describe('AccessSection', () => {
  it('grants a person access via the bridge', async () => {
    const accessSetAccount = vi.fn(() => Promise.resolve({ roles: DEFAULT_ROLES, accounts: [] }));
    installMockBridge({ accessSetAccount });
    useSessionStore.setState({ access: { roles: DEFAULT_ROLES, accounts: [] } });
    render(<AccessSection person={sam} />);
    await userEvent.click(screen.getByRole('button', { name: /grant access/i }));
    expect(accessSetAccount).toHaveBeenCalledWith(expect.objectContaining({ personId: 'p2' }));
  });
});

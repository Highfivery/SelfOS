import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Roles } from './Roles';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import { useSessionStore } from '../../../stores/sessionStore';
import { DEFAULT_ROLES } from '@shared/capabilities';

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ status: null, activePerson: null, access: null, loaded: false });
});

describe('Roles', () => {
  it('locks the owner column and toggles a member capability', async () => {
    const accessSaveRole = vi.fn(() => Promise.resolve({ roles: DEFAULT_ROLES, accounts: [] }));
    installMockBridge({
      accessSaveRole,
      accessGet: () => Promise.resolve({ roles: DEFAULT_ROLES, accounts: [] }),
    });
    useSessionStore.setState({ access: { roles: DEFAULT_ROLES, accounts: [] } });
    render(<Roles />);

    expect(screen.getByRole('switch', { name: 'Owner: Manage people' })).toBeDisabled();

    const memberManage = screen.getByRole('switch', { name: 'Member: Manage people' });
    expect(memberManage).not.toBeChecked();
    await userEvent.click(memberManage);
    expect(accessSaveRole).toHaveBeenCalled();
  });
});

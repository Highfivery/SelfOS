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

    expect(screen.getByText('Admin only')).toBeInTheDocument(); // the Roles screen is admin-only
    // Per-role cards: the owner card is locked all-on and marked "Full access".
    expect(screen.getByRole('heading', { name: 'Owner' })).toBeInTheDocument();
    expect(screen.getByText('Full access')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Owner: Manage people' })).toBeDisabled();

    const memberManage = screen.getByRole('switch', { name: 'Member: Manage people' });
    expect(memberManage).not.toBeChecked();
    await userEvent.click(memberManage);
    expect(accessSaveRole).toHaveBeenCalled();
  });

  it('leaves the owner toggleable for the break-glass readRaw capability (it ships OFF)', async () => {
    const accessSaveRole = vi.fn(() => Promise.resolve({ roles: DEFAULT_ROLES, accounts: [] }));
    installMockBridge({
      accessSaveRole,
      accessGet: () => Promise.resolve({ roles: DEFAULT_ROLES, accounts: [] }),
    });
    useSessionStore.setState({ access: { roles: DEFAULT_ROLES, accounts: [] } });
    render(<Roles />);

    const ownerReadRaw = screen.getByRole('switch', {
      name: 'Owner: Reveal raw private answers (break-glass)',
    });
    expect(ownerReadRaw).not.toBeChecked(); // ships OFF even for the owner
    expect(ownerReadRaw).not.toBeDisabled(); // …but it's togglable on the owner row
    await userEvent.click(ownerReadRaw);
    expect(accessSaveRole).toHaveBeenCalled();
  });

  it('shows the owner column all-on even when a capability is missing from a stale stored map', () => {
    // A vault persisted before `budgets.manage` existed: the stored owner map lacks it.
    const staleRoles = [
      { id: 'owner', name: 'Owner', builtin: true, capabilities: { 'people.manage': true } },
      { id: 'member', name: 'Member', builtin: true, capabilities: { 'sessions.own': true } },
    ];
    installMockBridge({ accessGet: () => Promise.resolve({ roles: staleRoles, accounts: [] }) });
    useSessionStore.setState({ access: { roles: staleRoles, accounts: [] } });
    render(<Roles />);

    const ownerBudgets = screen.getByRole('switch', { name: 'Owner: Manage budgets & view cost' });
    expect(ownerBudgets).toBeChecked();
    expect(ownerBudgets).toBeDisabled();
    // Non-owner roles still reflect their stored map.
    expect(
      screen.getByRole('switch', { name: 'Member: Manage budgets & view cost' }),
    ).not.toBeChecked();
  });
});

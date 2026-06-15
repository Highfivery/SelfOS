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

  it('locks the owner all-on, including the break-glass readRaw (the Owner is the full-access role)', () => {
    installMockBridge({
      accessGet: () => Promise.resolve({ roles: DEFAULT_ROLES, accounts: [] }),
    });
    useSessionStore.setState({ access: { roles: DEFAULT_ROLES, accounts: [] } });
    render(<Roles />);

    const ownerReadRaw = screen.getByRole('switch', {
      name: 'Owner: Reveal raw private answers (break-glass)',
    });
    expect(ownerReadRaw).toBeChecked(); // the Owner has everything now
    expect(ownerReadRaw).toBeDisabled(); // …and the owner column is locked all-on

    // A non-owner (member) keeps readRaw OFF + togglable.
    const memberReadRaw = screen.getByRole('switch', {
      name: 'Member: Reveal raw private answers (break-glass)',
    });
    expect(memberReadRaw).not.toBeChecked();
    expect(memberReadRaw).not.toBeDisabled();
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

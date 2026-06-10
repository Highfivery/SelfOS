import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountMenu } from './AccountMenu';
import { useSessionStore } from '../stores/sessionStore';
import type { Person } from '@shared/channels';

const alex: Person = {
  id: 'owner-1',
  schemaVersion: 1,
  displayName: 'Alex',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

afterEach(() => useSessionStore.setState({ activePerson: null, superAdmin: false, locked: false }));

describe('AccountMenu', () => {
  it('shows the active person and opens the session menu', async () => {
    useSessionStore.setState({ activePerson: alex });
    render(<AccountMenu onSwitch={() => {}} />);

    const trigger = screen.getByRole('button', { name: 'Signed in as Alex' });
    expect(trigger).toBeInTheDocument();
    await userEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Switch person' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Lock' })).toBeInTheDocument();
  });

  it('Switch person calls onSwitch; Lock locks the app', async () => {
    useSessionStore.setState({ activePerson: alex, locked: false });
    const onSwitch = vi.fn();
    render(<AccountMenu onSwitch={onSwitch} />);

    await userEvent.click(screen.getByRole('button', { name: 'Signed in as Alex' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Switch person' }));
    expect(onSwitch).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Signed in as Alex' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Lock' }));
    expect(useSessionStore.getState().locked).toBe(true);
  });

  it('only marks + offers inspect-lock when the super-admin is elevated', async () => {
    useSessionStore.setState({ activePerson: alex, superAdmin: false });
    const { rerender } = render(<AccountMenu onSwitch={() => {}} />);
    expect(screen.queryByText('Super-admin')).not.toBeInTheDocument();

    useSessionStore.setState({ superAdmin: true });
    rerender(<AccountMenu onSwitch={() => {}} />);
    expect(screen.getByText('Super-admin')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Signed in as Alex' }));
    expect(screen.getByRole('menuitem', { name: 'Lock inspect mode' })).toBeInTheDocument();
  });
});

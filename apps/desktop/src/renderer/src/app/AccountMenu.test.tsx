import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountMenu } from './AccountMenu';
import { useSessionStore } from '../stores/sessionStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';
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

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ activePerson: null, locked: false });
});

describe('AccountMenu', () => {
  it('opens the vault folder from the menu (the moved sync affordance)', async () => {
    const revealVault = vi.fn(() => Promise.resolve());
    installMockBridge({ revealVault });
    useSessionStore.setState({ activePerson: alex });
    render(<AccountMenu onSwitch={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Signed in as Alex' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open vault folder' }));
    expect(revealVault).toHaveBeenCalledTimes(1);
  });

  it('surfaces a sync conflict on the trigger and as a resolve item', async () => {
    installMockBridge();
    useSessionStore.setState({ activePerson: alex });
    render(<AccountMenu onSwitch={() => {}} conflicts={['/vault/x.enc.conflict']} />);
    const trigger = screen.getByRole('button', { name: 'Signed in as Alex — 1 sync conflict' });
    await userEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Resolve 1 sync conflict' })).toBeInTheDocument();
  });

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
});

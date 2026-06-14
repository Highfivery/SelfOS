import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppHeader } from './AppHeader';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';
import { useSessionStore } from '../stores/sessionStore';
import { useBudgetStore } from '../stores/budgetStore';
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

function renderHeader(overrides: Partial<Parameters<typeof AppHeader>[0]> = {}): {
  onOpenNav: ReturnType<typeof vi.fn>;
} {
  const onOpenNav = vi.fn();
  render(
    <MemoryRouter>
      <AppHeader
        conflicts={[]}
        onSwitchPerson={vi.fn()}
        onOpenNav={onOpenNav}
        navOpen={false}
        hamburgerRef={createRef<HTMLButtonElement>()}
        {...overrides}
      />
    </MemoryRouter>,
  );
  return { onOpenNav };
}

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ activePerson: null, superAdmin: false, access: null, locked: false });
  useBudgetStore.setState({ status: null });
});

describe('AppHeader', () => {
  it('renders the brand link and the full titlebar control set', async () => {
    installMockBridge({
      budgetStatus: () =>
        Promise.resolve({
          person: { state: 'ok', spentUsd: 2, limitUsd: 10, period: 'week' },
          app: { state: 'none', spentUsd: 0, limitUsd: null, period: null },
        }),
    });
    useSessionStore.setState({ activePerson: alex });
    renderHeader();

    // Brand → Home.
    const brand = screen.getByRole('link', { name: 'SelfOS' });
    expect(brand).toHaveAttribute('href', '/');

    // The curated right cluster: sync chip · usage ring · appearance · account.
    expect(
      screen.getByRole('button', { name: 'Vault: all synced — open the vault folder' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /AI usage/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Appearance:/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Signed in as Alex' })).toBeInTheDocument();
  });

  it('the mobile hamburger reflects nav state and opens the drawer', async () => {
    installMockBridge();
    useSessionStore.setState({ activePerson: alex });
    const { onOpenNav } = renderHeader({ navOpen: false });
    const hamburger = screen.getByRole('button', { name: 'Open navigation' });
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(hamburger);
    expect(onOpenNav).toHaveBeenCalledOnce();
  });

  it('shows the sync conflict state in the chip', () => {
    installMockBridge();
    useSessionStore.setState({ activePerson: alex });
    renderHeader({ conflicts: ['/vault/x.enc.conflict'] });
    expect(
      screen.getByRole('button', { name: '1 sync conflict — open the vault folder to resolve' }),
    ).toBeInTheDocument();
  });
});

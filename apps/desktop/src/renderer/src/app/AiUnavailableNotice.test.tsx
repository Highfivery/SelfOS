import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DEFAULT_ROLES } from '@shared/capabilities';
import type { Person } from '@shared/schemas';
import { AiUnavailableNotice, aiUnavailableMessage } from './AiUnavailableNotice';
import { useSessionStore } from '../stores/sessionStore';

const ME: Person = {
  id: 'me-1',
  schemaVersion: 1,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

function signIn(roleId: 'owner' | 'member'): void {
  useSessionStore.setState({
    activePerson: ME,
    access: { roles: DEFAULT_ROLES, accounts: [{ personId: ME.id, roleId, hasPin: false }] },
  });
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

function renderNotice(variant: 'banner' | 'inline' = 'banner'): void {
  render(
    <MemoryRouter initialEntries={['/sessions']}>
      <Routes>
        <Route path="/sessions" element={<AiUnavailableNotice variant={variant} />} />
        <Route path="/settings" element={<div>Settings screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AiUnavailableNotice', () => {
  beforeEach(() => {
    setOnline(true);
    useSessionStore.getState().reset();
  });
  afterEach(() => {
    setOnline(true);
    useSessionStore.getState().reset();
  });

  it('shows the owner a Settings → AI set-up link', () => {
    signIn('owner');
    renderNotice();
    expect(screen.getByText(/AI isn’t set up yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Set up Claude in Settings → AI/i }),
    ).toBeInTheDocument();
  });

  it('navigates to Settings when the owner activates the link', async () => {
    signIn('owner');
    renderNotice();
    await userEvent.click(screen.getByRole('button', { name: /Set up Claude in Settings → AI/i }));
    expect(screen.getByText('Settings screen')).toBeInTheDocument();
  });

  it('tells a member to ask the owner — with no Settings link and no key wording', () => {
    signIn('member');
    renderNotice();
    expect(
      screen.getByText(/ask the person who set up this household to turn it on/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Settings/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/key/i)).not.toBeInTheDocument();
  });

  it('falls to the safer member copy when the role is unknown (mid person-switch)', () => {
    // No access/role set on the store.
    renderNotice();
    expect(
      screen.getByText(/ask the person who set up this household to turn it on/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Settings/i })).not.toBeInTheDocument();
  });

  it('shows offline copy for an owner, with no Settings link', () => {
    signIn('owner');
    setOnline(false);
    renderNotice();
    expect(screen.getByText(/You appear to be offline/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Settings/i })).not.toBeInTheDocument();
  });

  it('shows offline copy for a member too', () => {
    signIn('member');
    setOnline(false);
    renderNotice();
    expect(screen.getByText(/You appear to be offline/i)).toBeInTheDocument();
  });

  it('renders the inline variant as a quiet line (no banner role) for the owner', () => {
    signIn('owner');
    renderNotice('inline');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Set up Claude in Settings → AI/i }),
    ).toBeInTheDocument();
  });
});

describe('aiUnavailableMessage', () => {
  it('returns the owner sentence (as plain text) when they can manage AI', () => {
    expect(aiUnavailableMessage({ canManageAi: true, offline: false })).toMatch(
      /AI isn’t set up yet\. Set up Claude in Settings → AI\./,
    );
  });
  it('returns the member ask-the-owner sentence with no key wording', () => {
    const msg = aiUnavailableMessage({ canManageAi: false, offline: false });
    expect(msg).toMatch(/ask the person who set up this household to turn it on/i);
    expect(msg).not.toMatch(/key/i);
    expect(msg).not.toMatch(/Settings/i);
  });
  it('returns offline copy for both roles when offline', () => {
    expect(aiUnavailableMessage({ canManageAi: true, offline: true })).toMatch(/offline/i);
    expect(aiUnavailableMessage({ canManageAi: false, offline: true })).toMatch(/offline/i);
  });
});

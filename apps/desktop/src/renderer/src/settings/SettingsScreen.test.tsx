import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import './builtins';
import { SettingsScreen } from './SettingsScreen';
import { useSettingsStore } from './settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';
import { DEFAULT_ROLES } from '@shared/capabilities';

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ activePerson: null, access: null });
  useSettingsStore.setState({
    values: {
      'appearance.theme': 'system',
      'appearance.density': 'comfortable',
      'appearance.textScale': 1,
      'appearance.reduceMotion': false,
    },
    loaded: false,
  });
});

/** Sign in as an admin (owner) so `can('settings.manage')` is true. */
function asAdmin(): void {
  useSessionStore.setState({
    activePerson: {
      id: 'owner-1',
      schemaVersion: 1,
      displayName: 'Ben',
      isSubject: true,
      tags: [],
      createdAt: 'now',
      updatedAt: 'now',
    },
    access: {
      roles: DEFAULT_ROLES,
      accounts: [{ personId: 'owner-1', roleId: 'owner', hasPin: false }],
    },
  });
}

describe('SettingsScreen', () => {
  it('renders the appearance section with the theme control', () => {
    installMockBridge();
    render(<SettingsScreen />);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Theme')).toBeInTheDocument();
  });

  it('persists a theme change via the bridge', async () => {
    const setSetting = vi.fn(() => Promise.resolve());
    installMockBridge({ setSetting });
    render(<SettingsScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(setSetting).toHaveBeenCalledWith({
      key: 'appearance.theme',
      value: 'dark',
      scope: 'vault',
    });
    expect(useSettingsStore.getState().values['appearance.theme']).toBe('dark');
  });

  it('hides the owner-only sections from non-admins and shows them to admins', async () => {
    installMockBridge();
    const { rerender } = render(<SettingsScreen />);
    // Non-admin: the household-wide sections are absent entirely; only Appearance/Vault/About show.
    for (const name of ['AI', 'Sessions', 'Questionnaires', 'Dreams', 'Relay', 'Devices']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vault' })).toBeInTheDocument();

    // Admin: the sections appear; Relay carries the "Admin only" marker on its Cloudflare control.
    asAdmin();
    rerender(<SettingsScreen />);
    for (const name of ['AI', 'Sessions', 'Questionnaires', 'Dreams', 'Relay', 'Devices']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('button', { name: 'Relay' }));
    expect(screen.getByText('Cloudflare relay')).toBeInTheDocument();
    expect(screen.getAllByText('Admin only').length).toBeGreaterThan(0);
  });

  it('filters settings by search query', async () => {
    installMockBridge();
    render(<SettingsScreen />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Search settings' }), 'density');
    expect(screen.getByText('Density')).toBeInTheDocument();
    expect(screen.queryByText('Theme')).not.toBeInTheDocument();
  });

  it('reveals the AI model only once AI is enabled (visibleWhen)', async () => {
    installMockBridge();
    asAdmin(); // the AI section is owner-only
    useSettingsStore.setState((state) => ({ values: { ...state.values, 'ai.enabled': false } }));
    render(<SettingsScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'AI' }));
    expect(screen.queryByText('Model')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('switch', { name: 'Enable AI' }));
    expect(screen.getByText('Model')).toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import './builtins';
import { SettingsScreen } from './SettingsScreen';
import { useSettingsStore } from './settingsStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
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

  it('filters settings by search query', async () => {
    installMockBridge();
    render(<SettingsScreen />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Search settings' }), 'density');
    expect(screen.getByText('Density')).toBeInTheDocument();
    expect(screen.queryByText('Theme')).not.toBeInTheDocument();
  });

  it('reveals the AI model only once AI is enabled (visibleWhen)', async () => {
    installMockBridge();
    useSettingsStore.setState((state) => ({ values: { ...state.values, 'ai.enabled': false } }));
    render(<SettingsScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'AI' }));
    expect(screen.queryByText('Model')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('switch', { name: 'Enable AI' }));
    expect(screen.getByText('Model')).toBeInTheDocument();
  });
});

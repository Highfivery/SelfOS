import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceMenu } from './AppearanceMenu';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';
import { useSettingsStore } from '../settings/settingsStore';
import '../settings/builtins'; // register the appearance.theme setting definition

beforeEach(() => {
  installMockBridge();
  useSettingsStore.setState((s) => ({ values: { ...s.values, 'appearance.theme': 'system' } }));
});

afterEach(() => clearMockBridge());

describe('AppearanceMenu', () => {
  it('shows the active theme and switches it via the popover', async () => {
    render(<AppearanceMenu />);
    expect(screen.getByRole('button', { name: 'Appearance: System' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Appearance/ }));
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
    expect(useSettingsStore.getState().values['appearance.theme']).toBe('dark');
    expect(screen.getByRole('button', { name: 'Appearance: Dark' })).toBeInTheDocument();
  });
});

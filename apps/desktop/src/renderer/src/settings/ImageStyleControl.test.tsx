import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImageStyleControl } from './ImageStyleControl';
import { useSettingsStore } from './settingsStore';
import { __resetRegistry } from './registry';
import { __resetBuiltins, registerBuiltinSettings } from './builtins';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

// The control edits `dreams.imageStyle`, so the built-in definitions must be registered for
// `useSetting` to resolve it (registry-backed schema + scope), and the store holds the value.
beforeEach(() => {
  __resetRegistry();
  __resetBuiltins();
  registerBuiltinSettings();
  installMockBridge({});
});

afterEach(() => {
  clearMockBridge();
  useSettingsStore.setState({ values: { 'dreams.imageStyle': 'dreamlike' } });
});

describe('ImageStyleControl (§3.8 — the single global image style)', () => {
  it('offers family-grouped presets plus a Custom… option', () => {
    useSettingsStore.setState({ values: { 'dreams.imageStyle': 'dreamlike' } });
    render(<ImageStyleControl />);
    const select = screen.getByRole('combobox', { name: 'Image style' });
    const groups = [...select.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toEqual(['Painted', 'Drawn', 'Stylized', 'Photographic-ish', 'Your own']);
    expect(screen.getByRole('option', { name: 'Custom…' })).toBeInTheDocument();
  });

  it('persists a chosen preset', async () => {
    useSettingsStore.setState({ values: { 'dreams.imageStyle': 'dreamlike' } });
    render(<ImageStyleControl />);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Image style' }),
      'watercolor',
    );
    expect(useSettingsStore.getState().values['dreams.imageStyle']).toBe('watercolor');
  });

  it('reveals a text field for Custom and persists the typed style', async () => {
    useSettingsStore.setState({ values: { 'dreams.imageStyle': 'dreamlike' } });
    render(<ImageStyleControl />);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Image style' }),
      '__custom__',
    );
    const input = screen.getByRole('textbox');
    await userEvent.type(input, 'soft storybook watercolor');
    expect(useSettingsStore.getState().values['dreams.imageStyle']).toBe(
      'soft storybook watercolor',
    );
  });

  it('starts in Custom mode for a stored value that is not a known preset (§15.4)', () => {
    useSettingsStore.setState({ values: { 'dreams.imageStyle': 'daguerreotype' } });
    render(<ImageStyleControl />);
    // The custom text box shows the stored value; the select sits on Custom…
    expect(screen.getByRole('textbox')).toHaveValue('daguerreotype');
    expect(screen.getByRole('combobox', { name: 'Image style' })).toHaveValue('__custom__');
  });
});

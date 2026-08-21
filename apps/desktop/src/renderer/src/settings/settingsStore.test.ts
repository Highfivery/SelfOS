import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Info } from 'lucide-react';
import { __resetRegistry, registerSection, registerSettings } from './registry';
import { defineSetting } from './types';
import { useSettingsStore } from './settingsStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

beforeEach(() => {
  __resetRegistry();
  registerSection({ id: 'general', title: 'General', icon: Info, order: 1 });
  registerSettings([
    defineSetting({
      key: 'general.flag',
      section: 'general',
      label: 'Flag',
      schema: z.boolean(),
      default: false,
      control: { type: 'switch' },
    }),
  ]);
  useSettingsStore.setState({ values: { 'general.flag': false }, loaded: false });
});

afterEach(() => clearMockBridge());

describe('settingsStore', () => {
  it('load merges persisted values over defaults', async () => {
    installMockBridge({
      getSettings: () => Promise.resolve({ vault: { 'general.flag': true }, device: {} }),
    });
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().values['general.flag']).toBe(true);
    expect(useSettingsStore.getState().loaded).toBe(true);
  });

  it('load falls back to the default for an invalid persisted value', async () => {
    installMockBridge({
      getSettings: () => Promise.resolve({ vault: { 'general.flag': 'nope' }, device: {} }),
    });
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().values['general.flag']).toBe(false);
  });

  it('set validates, updates, and persists via the bridge', async () => {
    const setSetting = vi.fn(() => Promise.resolve());
    installMockBridge({ setSetting });
    await useSettingsStore.getState().set('general.flag', true);
    expect(useSettingsStore.getState().values['general.flag']).toBe(true);
    expect(setSetting).toHaveBeenCalledWith({ key: 'general.flag', value: true, scope: 'vault' });
  });

  it('set ignores a value that fails validation', async () => {
    const setSetting = vi.fn(() => Promise.resolve());
    installMockBridge({ setSetting });
    await useSettingsStore.getState().set('general.flag', 'not-a-bool');
    expect(useSettingsStore.getState().values['general.flag']).toBe(false);
    expect(setSetting).not.toHaveBeenCalled();
  });

  // The bridge is the trust boundary and REFUSES a write the caller isn't permitted to make (30 §5).
  // Every caller invokes `set` as `void set(...)`, so before this the rejection was unhandled AND the
  // control kept showing a value that was never stored, silently reverting on the next load.
  it('rolls the optimistic value back when the bridge refuses the write', async () => {
    const setSetting = vi.fn(() => Promise.reject(new Error('Not permitted')));
    installMockBridge({ setSetting });

    await useSettingsStore.getState().set('general.flag', true);

    expect(setSetting).toHaveBeenCalled();
    expect(useSettingsStore.getState().values['general.flag']).toBe(false);
  });

  it('rolls a refused reset back too', async () => {
    installMockBridge({ setSetting: vi.fn(() => Promise.resolve()) });
    await useSettingsStore.getState().set('general.flag', true);

    installMockBridge({ resetSetting: vi.fn(() => Promise.reject(new Error('Not permitted'))) });
    await useSettingsStore.getState().reset('general.flag');

    expect(useSettingsStore.getState().values['general.flag']).toBe(true);
  });
});

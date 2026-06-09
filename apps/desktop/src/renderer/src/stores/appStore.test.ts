import { afterEach, describe, expect, it } from 'vitest';
import { useAppStore } from './appStore';
import type { BootState } from '@shared/schemas';

const ONBOARDING: BootState = { phase: 'onboarding', vaultPath: null, hasSettings: false };
const READY: BootState = { phase: 'ready', vaultPath: '/v', hasSettings: true };

function bridge(overrides: Partial<NonNullable<typeof window.selfos>>): void {
  window.selfos = {
    getBootState: () => Promise.resolve(ONBOARDING),
    selectVaultFolder: () => Promise.resolve(null),
    useVault: () => Promise.resolve(READY),
    refreshBootState: () => Promise.resolve(ONBOARDING),
    getConflicts: () => Promise.resolve([]),
    onVaultChanged: () => () => {},
    ...overrides,
  };
}

afterEach(() => {
  delete window.selfos;
  useAppStore.setState({ phase: 'starting', vaultPath: null, busy: false });
});

describe('appStore', () => {
  it('init sets the phase from the bridge', async () => {
    bridge({ getBootState: () => Promise.resolve(ONBOARDING) });
    await useAppStore.getState().init();
    expect(useAppStore.getState().phase).toBe('onboarding');
  });

  it('chooseVault transitions to ready after a folder is selected', async () => {
    bridge({
      selectVaultFolder: () => Promise.resolve('/v'),
      useVault: () => Promise.resolve(READY),
    });
    await useAppStore.getState().chooseVault();
    expect(useAppStore.getState().phase).toBe('ready');
    expect(useAppStore.getState().vaultPath).toBe('/v');
    expect(useAppStore.getState().busy).toBe(false);
  });

  it('chooseVault stays put when the picker is cancelled', async () => {
    useAppStore.setState({ phase: 'onboarding' });
    bridge({
      selectVaultFolder: () => Promise.resolve(null),
      useVault: () => Promise.reject(new Error('should not be called')),
    });
    await useAppStore.getState().chooseVault();
    expect(useAppStore.getState().phase).toBe('onboarding');
  });
});
